"""Tool sandbox tests: every gate, ordering, audit trail, no-side-effect-on-deny."""

from __future__ import annotations

import pytest

from ultran_backend.connectors import ConnectorManifest, ConnectorRegistry, CredentialVault
from ultran_backend.errors import NotFound, QuotaExceeded, ValidationFailed
from ultran_backend.sandbox import MAX_PAYLOAD_BYTES, ToolSandbox

KEY = "sk-test-abcdefgh-1234"


def make(
    *, tier: str = "free", auth_kind: str = "api_key", actions=("do_thing", "spend_money")
) -> ConnectorManifest:
    return ConnectorManifest(
        id="demo", name="Demo", category="test", auth_kind=auth_kind, tier=tier, actions=actions
    )


def build(*, executor=None, registry=None, manifest=None, max_payload=MAX_PAYLOAD_BYTES):
    reg = registry or ConnectorRegistry([manifest or make()])
    vault = CredentialVault()
    return ToolSandbox(reg, vault, executor=executor, max_payload_bytes=max_payload), reg, vault


# -------------------------------------------------------------- happy path


def test_invoke_succeeds_when_fully_configured():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    out = sb.invoke("ws", "demo", "do_thing", {"a": 1})
    assert out.ok is True
    assert out.output["credential_present"] is True
    assert out.output["payload"] == {"a": 1}


def test_invoke_records_a_successful_audit_entry():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "do_thing")
    assert len(sb.audit) == 1
    assert sb.audit[0].ok is True
    assert sb.audit[0].reason == "ok"


def test_invoke_bumps_credential_usage():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "do_thing")
    assert vault.get("ws", "demo").uses == 1


def test_invoke_works_without_a_credential_when_auth_is_none():
    sb, reg, vault = build(manifest=make(auth_kind="none"))
    reg.enable("ws", "demo")
    out = sb.invoke("ws", "demo", "do_thing")
    assert out.ok is True
    assert out.output["credential_present"] is False


def test_invoke_never_touches_a_credential_for_keyless_connectors():
    sb, reg, _ = build(manifest=make(auth_kind="none"))
    reg.enable("ws", "demo")
    sb.invoke("ws", "demo", "do_thing")
    assert sb.summary()["ok"] == 1


# ---------------------------------------------------------------- gating


def test_disabled_connector_is_rejected_before_the_executor_runs():
    calls: list[str] = []
    sb, reg, vault = build(executor=lambda *a: calls.append("ran") or {})
    vault.put("ws", "demo", KEY)
    with pytest.raises(NotFound, match="not enabled"):
        sb.invoke("ws", "demo", "do_thing")
    assert calls == []


def test_unknown_connector_is_rejected():
    sb, _, _ = build()
    with pytest.raises(NotFound, match="not found"):
        sb.invoke("ws", "ghost", "do_thing")


def test_undeclared_action_is_rejected_with_the_available_list():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    with pytest.raises(ValidationFailed) as exc:
        sb.invoke("ws", "demo", "launch_missiles")
    assert "available" in exc.value.details


def test_undeclared_action_does_not_run_the_executor():
    calls: list[str] = []
    sb, reg, vault = build(executor=lambda *a: calls.append("ran") or {})
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    with pytest.raises(ValidationFailed):
        sb.invoke("ws", "demo", "nope")
    assert calls == []


def test_missing_credential_is_rejected():
    sb, reg, _ = build()
    reg.enable("ws", "demo")
    with pytest.raises(NotFound):
        sb.invoke("ws", "demo", "do_thing")


def test_paid_connector_requires_a_paid_plan_key():
    sb, reg, vault = build(manifest=make(tier="paid"))
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY, plan="free")
    with pytest.raises(QuotaExceeded, match="paid plan"):
        sb.invoke("ws", "demo", "do_thing")


def test_paid_connector_accepts_a_paid_plan_key():
    sb, reg, vault = build(manifest=make(tier="paid"))
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY, plan="paid")
    assert sb.invoke("ws", "demo", "do_thing").ok is True


def test_oversized_payload_is_rejected():
    sb, reg, vault = build(max_payload=64)
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    with pytest.raises(ValidationFailed, match="budget"):
        sb.invoke("ws", "demo", "do_thing", {"blob": "x" * 500})


def test_oversized_payload_does_not_run_the_executor():
    calls: list[str] = []
    sb, reg, vault = build(max_payload=16, executor=lambda *a: calls.append("ran") or {})
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    with pytest.raises(ValidationFailed):
        sb.invoke("ws", "demo", "do_thing", {"blob": "x" * 200})
    assert calls == []


def test_denied_calls_are_still_audited():
    sb, reg, vault = build()
    vault.put("ws", "demo", KEY)
    with pytest.raises(NotFound):
        sb.invoke("ws", "demo", "do_thing")
    assert len(sb.audit) == 1
    assert sb.audit[0].ok is False
    assert sb.audit[0].reason


def test_every_denial_reason_is_distinct():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    with pytest.raises(ValidationFailed):
        sb.invoke("ws", "demo", "nope")
    with pytest.raises(NotFound):
        sb.invoke("ws", "other-ws", "do_thing")
    reasons = {e.reason for e in sb.audit}
    assert "action_not_declared" in reasons


# ----------------------------------------------------------- containment


def test_executor_failure_is_contained():
    def boom(*_):
        raise RuntimeError("upstream exploded")

    sb, reg, vault = build(executor=boom)
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    out = sb.invoke("ws", "demo", "do_thing")
    assert out.ok is False
    assert "upstream exploded" in out.error


def test_executor_failure_is_audited_as_an_error():
    sb, reg, vault = build(executor=lambda *_: (_ for _ in ()).throw(ValueError("bad")))
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "do_thing")
    assert sb.audit[-1].ok is False
    assert "executor_error" in sb.audit[-1].reason


def test_a_failed_call_does_not_bump_usage():
    sb, reg, vault = build(executor=lambda *_: (_ for _ in ()).throw(ValueError("bad")))
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "do_thing")
    assert vault.get("ws", "demo").uses == 0


def test_the_executor_receives_the_revealed_secret():
    seen: dict[str, str] = {}

    def capture(cid, action, payload, secret):
        seen["secret"] = secret
        return {"ok": True}

    sb, reg, vault = build(executor=capture)
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "do_thing")
    assert seen["secret"] == KEY


def test_the_default_executor_redacts_the_secret():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    out = sb.invoke("ws", "demo", "do_thing")
    assert KEY not in str(out.output)


# ------------------------------------------------------- sensitive gating


def test_sensitive_actions_are_flagged():
    sb, reg, vault = build(manifest=make(actions=("create_charge", "do_thing")))
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    out = sb.invoke("ws", "demo", "create_charge")
    assert out.sensitive is True


def test_non_sensitive_actions_are_not_flagged():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    assert sb.invoke("ws", "demo", "do_thing").sensitive is False


def test_sensitive_flag_persists_in_the_audit_trail():
    sb, reg, vault = build(manifest=make(actions=("send_email",)))
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "send_email")
    assert sb.audit[-1].as_dict()["sensitive"] is True


# ---------------------------------------------------------------- reporting


def test_recent_returns_newest_first():
    sb, reg, vault = build(manifest=make(actions=("a1", "a2")))
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "a1")
    sb.invoke("ws", "demo", "a2")
    recent = sb.recent()
    assert recent[0]["action"] == "a2"


def test_recent_respects_the_limit():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    for _ in range(5):
        sb.invoke("ws", "demo", "do_thing")
    assert len(sb.recent(limit=2)) == 2


def test_recent_rejects_negative_limits():
    sb, _, _ = build()
    with pytest.raises(ValidationFailed):
        sb.recent(limit=-1)


def test_summary_counts_outcomes():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "do_thing")
    with pytest.raises(ValidationFailed):
        sb.invoke("ws", "demo", "nope")
    summary = sb.summary()
    assert summary["total"] == 2
    assert summary["ok"] == 1
    assert summary["denied"] == 1


def test_summary_of_an_empty_sandbox_is_zeroed():
    sb, _, _ = build()
    assert sb.summary() == {"total": 0, "ok": 0, "denied": 0, "sensitive": 0, "p50_latency_ms": 0}


def test_audit_entries_expose_no_secret_material():
    sb, reg, vault = build()
    reg.enable("ws", "demo")
    vault.put("ws", "demo", KEY)
    sb.invoke("ws", "demo", "do_thing")
    assert KEY not in str(sb.recent())
