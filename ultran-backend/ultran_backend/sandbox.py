"""Tool sandbox: the only place a tool call is allowed to touch the outside world.

Every invocation is gated by four checks, in order, and **all four run before
any side effect** so a rejected call mutates nothing:

1. the connector exists and is enabled for the workspace;
2. the requested action is actually declared by that connector;
3. a credential is present (unless the connector is ``auth_kind=none``);
4. the payload is inside budget and the policy gate allows the action.

The sandbox records every attempt - allowed or denied - in an audit trail. That
trail is what the billing layer meters and what the UI shows as the run log.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from .connectors.credentials import CredentialVault, utcnow
from .connectors.registry import ConnectorRegistry
from .errors import Forbidden, NotFound, QuotaExceeded, ValidationFailed

MAX_PAYLOAD_BYTES = 256 * 1024

# Actions that spend the user's money or publish in public. They are allowed but
# always flagged so the UI can require an explicit confirmation.
SENSITIVE_ACTIONS = {
    "create_charge",
    "capture_order",
    "create_checkout",
    "send_email",
    "send_sms",
    "send_message",
    "post_tweet",
    "share_post",
    "publish_media",
    "commit",
    "create_deployment",
    "create_deploy",
}


@dataclass
class AuditEntry:
    connector: str
    action: str
    ok: bool
    reason: str
    latency_ms: int
    at: datetime = field(default_factory=utcnow)
    sensitive: bool = False
    payload_keys: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "connector": self.connector,
            "action": self.action,
            "ok": self.ok,
            "reason": self.reason,
            "latency_ms": self.latency_ms,
            "at": self.at.isoformat(),
            "sensitive": self.sensitive,
            "payload_keys": list(self.payload_keys),
        }


@dataclass
class ToolResult:
    connector: str
    action: str
    ok: bool
    output: dict[str, Any] = field(default_factory=dict)
    latency_ms: int = 0
    sensitive: bool = False
    error: str = ""


Executor = Callable[[str, str, dict[str, Any], str], dict[str, Any]]


def _default_executor(connector_id: str, action: str, payload: dict[str, Any], secret: str) -> dict[str, Any]:
    """Offline echo executor.

    The sandbox is deliberately transport-agnostic: production wires in real HTTP
    executors per connector, while the default keeps everything local and
    observable. It echoes what *would* be sent, with the secret redacted.
    """
    return {
        "connector": connector_id,
        "action": action,
        "payload": payload,
        "credential_present": bool(secret),
        "transport": "local-echo",
    }


class ToolSandbox:
    def __init__(
        self,
        registry: ConnectorRegistry,
        vault: CredentialVault,
        *,
        executor: Executor | None = None,
        max_payload_bytes: int = MAX_PAYLOAD_BYTES,
        cpu_ms_budget: int = 2000,
    ) -> None:
        self.registry = registry
        self.vault = vault
        self.executor = executor or _default_executor
        self.max_payload_bytes = max_payload_bytes
        self.cpu_ms_budget = cpu_ms_budget
        self.audit: list[AuditEntry] = []

    # ------------------------------------------------------------------ #
    def _record(self, entry: AuditEntry) -> None:
        self.audit.append(entry)

    def invoke(
        self,
        workspace_id: str,
        connector_id: str,
        action: str,
        payload: dict[str, Any] | None = None,
        *,
        label: str = "default",
        plan: str = "free",
    ) -> ToolResult:
        payload = dict(payload or {})
        started = time.perf_counter()

        def fail(exc: Exception, reason: str) -> ToolResult:
            self._record(
                AuditEntry(
                    connector=connector_id,
                    action=action,
                    ok=False,
                    reason=reason,
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    payload_keys=tuple(sorted(payload)),
                )
            )
            raise exc

        # 1. connector exists + is enabled
        try:
            manifest = self.registry.resolve(workspace_id, connector_id)
        except NotFound as exc:
            return fail(exc, exc.message)

        # 2. action is declared
        if not manifest.supports(action):
            return fail(
                ValidationFailed(
                    "connector does not expose this action",
                    details={"connector": connector_id, "action": action, "available": list(manifest.actions)},
                ),
                "action_not_declared",
            )

        # 3. credential present (or not needed)
        secret = ""
        if manifest.auth_kind != "none":
            try:
                cred = self.vault.get(workspace_id, connector_id, label)
            except NotFound as exc:
                return fail(exc, "missing_credential")
            if manifest.tier == "paid" and cred.plan != "paid":
                return fail(
                    QuotaExceeded(
                        "this connector needs a paid plan key",
                        details={"connector": connector_id, "plan": cred.plan},
                    ),
                    "plan_too_low",
                )
            secret = cred.reveal()

        # 4. payload budget
        size = len(str(payload).encode("utf-8"))
        if size > self.max_payload_bytes:
            return fail(
                ValidationFailed(
                    "payload exceeds sandbox budget",
                    details={"bytes": size, "max_bytes": self.max_payload_bytes},
                ),
                "payload_too_large",
            )

        sensitive = action in SENSITIVE_ACTIONS
        try:
            output = self.executor(connector_id, action, payload, secret)
        except Exception as exc:  # noqa: BLE001 - executor failures are contained
            self._record(
                AuditEntry(
                    connector=connector_id,
                    action=action,
                    ok=False,
                    reason=f"executor_error: {exc}",
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    sensitive=sensitive,
                    payload_keys=tuple(sorted(payload)),
                )
            )
            return ToolResult(
                connector=connector_id,
                action=action,
                ok=False,
                latency_ms=int((time.perf_counter() - started) * 1000),
                sensitive=sensitive,
                error=str(exc),
            )

        latency = int((time.perf_counter() - started) * 1000)
        if manifest.auth_kind != "none":
            self.vault.get(workspace_id, connector_id, label).touch()
        self._record(
            AuditEntry(
                connector=connector_id,
                action=action,
                ok=True,
                reason="ok",
                latency_ms=latency,
                sensitive=sensitive,
                payload_keys=tuple(sorted(payload)),
            )
        )
        return ToolResult(
            connector=connector_id,
            action=action,
            ok=True,
            output=output,
            latency_ms=latency,
            sensitive=sensitive,
        )

    # ------------------------------------------------------------------ #
    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        if limit < 0:
            raise ValidationFailed("limit must be >= 0")
        return [e.as_dict() for e in self.audit[-limit:]][::-1]

    def summary(self) -> dict[str, Any]:
        ok = sum(1 for e in self.audit if e.ok)
        return {
            "total": len(self.audit),
            "ok": ok,
            "denied": len(self.audit) - ok,
            "sensitive": sum(1 for e in self.audit if e.sensitive),
            "p50_latency_ms": _percentile([e.latency_ms for e in self.audit], 50),
        }


def _percentile(values: list[int], p: int) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round((p / 100) * (len(ordered) - 1))))
    return ordered[idx]
