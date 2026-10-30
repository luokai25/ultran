"""The tool sandbox - the only path from intent to a side effect.

Four gates run *in order, before anything is mutated*:

1. the connector exists and is enabled for this workspace;
2. the action is actually declared by that connector;
3. a credential is present (and a paid key if the connector is ``paid``);
4. the payload fits the size budget.

A denied call changes nothing and is still recorded in the audit trail, so the
UI can explain why an action did not run instead of silently doing nothing.

The sandbox deliberately does **not** dispatch real network calls. It is the
policy and audit layer; transport adapters are plugged in behind it, so a
connector cannot bypass validation by talking to a provider directly.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .connectors import ConnectorRegistry, CredentialVault
from .errors import Forbidden, NotFound, ValidationFailed

MAX_PAYLOAD_BYTES = 256 * 1024


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class AuditEntry:
    workspace_id: str
    connector_id: str
    action: str
    ok: bool
    gate: str
    reason: str
    payload_bytes: int
    duration_ms: float
    at: datetime = field(default_factory=utcnow)

    def public(self) -> dict[str, Any]:
        return {
            "workspace": self.workspace_id,
            "connector": self.connector_id,
            "action": self.action,
            "ok": self.ok,
            "gate": self.gate,
            "reason": self.reason,
            "payload_bytes": self.payload_bytes,
            "duration_ms": round(self.duration_ms, 3),
            "at": self.at.isoformat(),
        }


@dataclass
class Invocation:
    connector_id: str
    action: str
    payload: dict[str, Any]
    workspace_id: str


class ToolSandbox:
    """Policy engine + audit trail for connector invocations."""

    def __init__(
        self,
        registry: ConnectorRegistry,
        vault: CredentialVault,
        *,
        max_payload_bytes: int = MAX_PAYLOAD_BYTES,
    ) -> None:
        self.registry = registry
        self.vault = vault
        self.max_payload_bytes = max_payload_bytes
        self._audit: list[AuditEntry] = []
        self._max_audit = 5000

    # ------------------------------------------------------------------ #
    def audit(self, workspace_id: str | None = None, limit: int = 100) -> list[AuditEntry]:
        rows = [e for e in self._audit if workspace_id is None or e.workspace_id == workspace_id]
        return list(reversed(rows))[: max(1, limit)]

    def audit_summary(self, workspace_id: str | None = None) -> dict[str, Any]:
        rows = [e for e in self._audit if workspace_id is None or e.workspace_id == workspace_id]
        return {
            "total": len(rows),
            "ok": sum(1 for e in rows if e.ok),
            "denied": sum(1 for e in rows if not e.ok),
            "by_gate": __import__("collections").Counter(e.gate for e in rows if not e.ok),
        }

    def _record(self, entry: AuditEntry) -> None:
        self._audit.append(entry)
        if len(self._audit) > self._max_audit:
            del self._audit[: len(self._audit) - self._max_audit]

    def _deny(self, inv: Invocation, gate: str, reason: str, size: int, started: float) -> None:
        self._record(
            AuditEntry(
                workspace_id=inv.workspace_id,
                connector_id=inv.connector_id,
                action=inv.action,
                ok=False,
                gate=gate,
                reason=reason,
                payload_bytes=size,
                duration_ms=(time.perf_counter() - started) * 1000,
            )
        )

    # ------------------------------------------------------------------ #
    def invoke(self, inv: Invocation) -> dict[str, Any]:
        started = time.perf_counter()
        raw = json.dumps(inv.payload or {}, default=str)
        size = len(raw.encode("utf-8"))

        # Gate 1: the connector must exist and be enabled for this workspace.
        try:
            manifest = self.registry.resolve(inv.workspace_id, inv.connector_id)
        except NotFound as exc:
            self._deny(inv, "enablement", exc.message, size, started)
            raise

        # Gate 2: the action must be declared by that connector.
        if not manifest.supports(inv.action):
            msg = f"action {inv.action!r} is not declared by {manifest.id!r}"
            self._deny(inv, "action", msg, size, started)
            raise ValidationFailed(msg, details={"allowed": list(manifest.actions)})

        # Gate 3: a credential must be present, and paid connectors need a paid key.
        if manifest.auth_kind != "none":
            if not self.vault.has(inv.workspace_id, manifest.id):
                msg = "no credential stored for this connector"
                self._deny(inv, "credential", msg, size, started)
                raise NotFound(msg, details={"connector_id": manifest.id})
            cred = self.vault.get(inv.workspace_id, manifest.id)
            if manifest.tier == "paid" and cred.plan != "paid":
                msg = "this connector requires a paid key"
                self._deny(inv, "credential", msg, size, started)
                raise Forbidden(msg, details={"connector_id": manifest.id, "plan": cred.plan})

        # Gate 4: the payload must fit the size budget.
        if size > self.max_payload_bytes:
            msg = f"payload of {size} bytes exceeds the {self.max_payload_bytes} byte budget"
            self._deny(inv, "payload", msg, size, started)
            raise ValidationFailed(msg, details={"max_bytes": self.max_payload_bytes})

        if manifest.auth_kind != "none" and self.vault.has(inv.workspace_id, manifest.id):
            self.vault.get(inv.workspace_id, manifest.id).touch()

        duration = (time.perf_counter() - started) * 1000
        self._record(
            AuditEntry(
                workspace_id=inv.workspace_id,
                connector_id=inv.connector_id,
                action=inv.action,
                ok=True,
                gate="pass",
                reason="all gates passed",
                payload_bytes=size,
                duration_ms=duration,
            )
        )
        return {
            "ok": True,
            "connector_id": manifest.id,
            "action": inv.action,
            "transport": "policy-only",
            "payload_bytes": size,
            "duration_ms": round(duration, 3),
            "message": (
                f"{manifest.name}:{inv.action} accepted by the sandbox. "
                "No network adapter is bound in this build, so nothing was sent."
            ),
        }
