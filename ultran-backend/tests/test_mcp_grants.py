"""Capability grants and the approval gate."""

from __future__ import annotations

from datetime import timedelta

import pytest

from ultran_backend.errors import NotFound, ValidationFailed
from ultran_backend.mcp.errors import ApprovalPending, GrantRequired
from ultran_backend.mcp.grants import MAX_TTL_S, ApprovalGate, GrantStore
from ultran_backend.mcp.protocol import utcnow


@pytest.fixture()
def store() -> GrantStore:
    return GrantStore()


# ---------------------------------------------------------------- issuing


def test_issue_returns_a_signed_grant(store):
    g = store.issue("ws", "fs.read_file", ["read"])
    assert g.id.startswith("grt_")
    assert g.signature
    assert g.capabilities == {"read"}
    assert g.is_live()


def test_issue_requires_a_workspace(store):
    with pytest.raises(ValidationFailed, match="workspace"):
        store.issue("", "fs.read_file", ["read"])


def test_issue_requires_a_tool(store):
    with pytest.raises(ValidationFailed, match="tool"):
        store.issue("ws", "", ["read"])


def test_issue_requires_at_least_one_capability(store):
    with pytest.raises(ValidationFailed, match="capability"):
        store.issue("ws", "fs.read_file", [])


def test_issue_rejects_an_unknown_capability(store):
    with pytest.raises(ValueError, match="unknown"):
        store.issue("ws", "fs.read_file", ["telepathy"])


def test_issue_rejects_a_ttl_beyond_the_maximum(store):
    with pytest.raises(ValidationFailed, match="maximum"):
        store.issue("ws", "fs.read_file", ["read"], ttl_s=MAX_TTL_S + 1)


def test_issue_rejects_a_non_positive_ttl(store):
    with pytest.raises(ValidationFailed, match="positive"):
        store.issue("ws", "fs.read_file", ["read"], ttl_s=0)


# ---------------------------------------------------------------- verifying


def test_verify_accepts_a_covering_grant(store):
    g = store.issue("ws", "fs.read_file", ["read"])
    assert store.verify(g, workspace_id="ws", tool_id="fs.read_file", required=["read"]).id == g.id


def test_verify_accepts_a_grant_id_string(store):
    g = store.issue("ws", "fs.read_file", ["read"])
    assert store.verify(g.id, workspace_id="ws", tool_id="fs.read_file", required=["read"])


def test_no_grant_is_denied(store):
    with pytest.raises(GrantRequired, match="needs a capability grant"):
        store.verify(None, workspace_id="ws", tool_id="fs.read_file", required=["read"])


def test_grant_for_another_tool_is_denied(store):
    g = store.issue("ws", "fs.read_file", ["read"])
    with pytest.raises(GrantRequired, match="does not cover"):
        store.verify(g, workspace_id="ws", tool_id="fs.write_file", required=["write"])


def test_grant_with_insufficient_capabilities_is_denied(store):
    g = store.issue("ws", "fs.write_file", ["read"])
    with pytest.raises(GrantRequired, match="does not cover"):
        store.verify(g, workspace_id="ws", tool_id="fs.write_file", required=["write"])


def test_grant_for_another_workspace_is_denied(store):
    g = store.issue("ws-a", "fs.read_file", ["read"])
    with pytest.raises(GrantRequired, match="different workspace"):
        store.verify(g, workspace_id="ws-b", tool_id="fs.read_file", required=["read"])


def test_expired_grant_is_denied():
    """Expiry is part of the signed payload, so time must move - not the grant."""
    now = utcnow()
    store = GrantStore(clock=lambda: now)
    g = store.issue("ws", "fs.read_file", ["read"], ttl_s=60)
    later = GrantStore(clock=lambda: now + timedelta(seconds=61))
    later._grants = store._grants
    later._key = store._key
    with pytest.raises(GrantRequired, match="expired"):
        later.verify(g, workspace_id="ws", tool_id="fs.read_file", required=["read"])


def test_expiry_is_checked_on_read_not_by_a_sweeper():
    """A grant that expired a second ago is invalid even if nothing has run."""
    now = utcnow()
    store = GrantStore(clock=lambda: now)
    g = store.issue("ws", "fs.read_file", ["read"], ttl_s=60)
    assert g.is_live(now)
    assert not g.is_live(now + timedelta(seconds=61))


def test_revoked_grant_is_denied(store):
    g = store.issue("ws", "fs.read_file", ["read"])
    store.revoke(g.id)
    with pytest.raises(GrantRequired, match="revoked"):
        store.verify(g, workspace_id="ws", tool_id="fs.read_file", required=["read"])


def test_tampered_grant_is_denied(store):
    """Widening a grant in the store must invalidate its signature."""
    g = store.issue("ws", "fs.read_file", ["read"])
    g.capabilities = frozenset({"read", "write", "delete"})
    with pytest.raises(GrantRequired, match="signature"):
        store.verify(g, workspace_id="ws", tool_id="fs.read_file", required=["read"])


def test_repointed_grant_is_denied(store):
    g = store.issue("ws", "fs.read_file", ["read"])
    g.tool_id = "fs.delete_path"
    with pytest.raises(GrantRequired, match="signature"):
        store.verify(g, workspace_id="ws", tool_id="fs.delete_path", required=["read"])


def test_re_dated_grant_is_denied(store):
    g = store.issue("ws", "fs.read_file", ["read"], ttl_s=60)
    g.expires_at = utcnow() + timedelta(days=365)
    with pytest.raises(GrantRequired, match="signature"):
        store.verify(g, workspace_id="ws", tool_id="fs.read_file", required=["read"])


def test_single_use_grant_is_spent_after_one_call(store):
    g = store.issue("ws", "fs.read_file", ["read"], single_use=True)
    store.verify(g, workspace_id="ws", tool_id="fs.read_file", required=["read"])
    store.consume(g)
    with pytest.raises(GrantRequired, match="already spent"):
        store.verify(g, workspace_id="ws", tool_id="fs.read_file", required=["read"])


def test_wildcard_grant_covers_every_tool(store):
    g = store.issue("ws", "*", ["read"])
    assert store.verify(g, workspace_id="ws", tool_id="anything.at_all", required=["read"])


def test_unknown_grant_id_raises_not_found(store):
    with pytest.raises(NotFound):
        store.verify("grt_missing", workspace_id="ws", tool_id="t", required=["read"])


# ---------------------------------------------------------------- listing


def test_list_filters_by_workspace(store):
    store.issue("ws-a", "t", ["read"])
    store.issue("ws-b", "t", ["read"])
    assert len(store.list("ws-a")) == 1
    assert len(store.list()) == 2


def test_list_live_only_excludes_dead_grants(store):
    live = store.issue("ws", "t", ["read"])
    dead = store.issue("ws", "t", ["read"])
    store.revoke(dead.id)
    assert [g.id for g in store.list("ws", live_only=True)] == [live.id]


def test_prune_removes_dead_grants(store):
    store.issue("ws", "t", ["read"])
    dead = store.issue("ws", "t", ["read"])
    store.revoke(dead.id)
    assert store.prune() == 1
    assert len(store.list()) == 1


def test_grant_as_dict_hides_the_full_signature(store):
    g = store.issue("ws", "t", ["read"])
    payload = g.as_dict()
    assert len(payload["signature"]) == 16
    assert payload["live"] is True


# ---------------------------------------------------------------- approvals


@pytest.fixture()
def gate() -> ApprovalGate:
    return ApprovalGate(ttl_s=60)


def test_request_creates_a_pending_approval(gate):
    a = gate.request("ws", "fs.delete_path", "abc123")
    assert a.state == "pending"
    assert a.id.startswith("apr_")
    assert gate.pending("ws") == [a]


def test_approval_must_be_decided_before_use(gate):
    a = gate.request("ws", "fs.delete_path", "abc")
    with pytest.raises(ApprovalPending, match="pending"):
        gate.require(a, workspace_id="ws", tool_id="fs.delete_path")


def test_approved_approval_passes(gate):
    a = gate.request("ws", "fs.delete_path", "abc")
    gate.decide(a.id, approved=True, decided_by="luokai")
    assert gate.require(a, workspace_id="ws", tool_id="fs.delete_path").state == "approved"


def test_denied_approval_fails(gate):
    a = gate.request("ws", "fs.delete_path", "abc")
    gate.decide(a.id, approved=False)
    with pytest.raises(ApprovalPending, match="denied"):
        gate.require(a, workspace_id="ws", tool_id="fs.delete_path")


def test_missing_approval_raises_pending(gate):
    with pytest.raises(ApprovalPending, match="needs explicit approval"):
        gate.require(None, workspace_id="ws", tool_id="fs.delete_path")


def test_approval_for_another_tool_does_not_match(gate):
    a = gate.request("ws", "fs.delete_path", "abc")
    gate.decide(a.id, approved=True)
    with pytest.raises(ApprovalPending, match="does not match"):
        gate.require(a, workspace_id="ws", tool_id="fs.write_file")


def test_approval_cannot_be_decided_twice(gate):
    a = gate.request("ws", "t", "abc")
    gate.decide(a.id, approved=True)
    with pytest.raises(ValidationFailed, match="already been decided"):
        gate.decide(a.id, approved=False)


def test_expired_approval_cannot_be_decided(gate):
    a = gate.request("ws", "t", "abc")
    a.expires_at = utcnow() - timedelta(seconds=1)
    with pytest.raises(ValidationFailed, match="expired"):
        gate.decide(a.id, approved=True)


def test_expired_approval_does_not_pass_require(gate):
    a = gate.request("ws", "t", "abc")
    gate.decide(a.id, approved=True)
    a.expires_at = utcnow() - timedelta(seconds=1)
    with pytest.raises(ApprovalPending, match="expired"):
        gate.require(a, workspace_id="ws", tool_id="t")


def test_pending_excludes_decided_and_expired(gate):
    a = gate.request("ws", "t", "1")
    b = gate.request("ws", "t", "2")
    gate.decide(a.id, approved=True)
    b.expires_at = utcnow() - timedelta(seconds=1)
    assert gate.pending("ws") == []


def test_unknown_approval_raises_not_found(gate):
    with pytest.raises(NotFound):
        gate.get("apr_missing")
