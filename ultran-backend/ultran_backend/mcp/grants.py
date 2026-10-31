"""Capability grants and the approval gate.

The spec's invariant for the tool gateway is one sentence: *a tool is never
invoked without a valid grant*. A grant is a signed, expiring, capability-scoped
permission slip for one tool:

    signature over (workspace, tool_spec, capabilities, expiry)

Three properties matter and each is a test:

* **Deny by default** - no grant, or a grant that does not cover the tool's
  capabilities, is a ``grant_required`` error, not a warning.
* **Expiry is checked on read, not by a sweeper** - a grant that expired one
  second ago is invalid even if nothing has run since.
* **Single use** - a grant issued for one call cannot be replayed by a second.

Signing is HMAC-SHA256 with a per-workspace key. That is not a defence against a
local attacker who can read the key file - nothing on the same machine is - but
it does stop a grant from being *edited* (widened, re-dated, re-pointed at
another tool) by anything that can write to the store, which is the realistic
threat when a model can call tools that write files.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from ..errors import NotFound, ValidationFailed
from .annotations import CAPABILITIES, capability_filter
from .errors import ApprovalPending, GrantRequired
from .protocol import canonical_json, utcnow

DEFAULT_TTL_S = 900
MAX_TTL_S = 24 * 3600


def _sign(key: bytes, payload: Mapping[str, Any]) -> str:
    return hmac.new(key, canonical_json(payload).encode("utf-8"), hashlib.sha256).hexdigest()


@dataclass
class Grant:
    """A signed permission slip for one tool in one workspace."""

    id: str
    workspace_id: str
    tool_id: str
    capabilities: frozenset[str] = frozenset({"read"})
    issued_at: datetime = field(default_factory=utcnow)
    expires_at: datetime | None = None
    single_use: bool = False
    used: int = 0
    revoked_at: datetime | None = None
    signature: str = ""
    issued_by: str = "system"

    # ------------------------------------------------------------------ #
    def is_expired(self, now: datetime | None = None) -> bool:
        if self.expires_at is None:
            return False
        return (now or utcnow()) >= self.expires_at

    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    def is_exhausted(self) -> bool:
        return self.single_use and self.used >= 1

    def is_live(self, now: datetime | None = None) -> bool:
        return not (self.is_expired(now) or self.is_revoked() or self.is_exhausted())

    def covers(self, tool_id: str, required: Iterable[str]) -> bool:
        if self.tool_id not in {tool_id, "*"}:
            return False
        return set(required).issubset(self.capabilities)

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "workspace_id": self.workspace_id,
            "tool_id": self.tool_id,
            "capabilities": sorted(self.capabilities),
            "issued_at": self.issued_at.isoformat(),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "single_use": self.single_use,
            "issued_by": self.issued_by,
        }

    def as_dict(self) -> dict[str, Any]:
        return {
            **self.payload(),
            "used": self.used,
            "revoked_at": self.revoked_at.isoformat() if self.revoked_at else None,
            "live": self.is_live(),
            "signature": self.signature[:16],
        }


class GrantStore:
    """Issues, verifies, expires and revokes grants."""

    def __init__(
        self,
        *,
        key: bytes | None = None,
        default_ttl_s: int = DEFAULT_TTL_S,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._key = key or secrets.token_bytes(32)
        self.default_ttl_s = max(1, min(int(default_ttl_s), MAX_TTL_S))
        self._grants: dict[str, Grant] = {}
        # Injectable so expiry can be tested without sleeping.
        self._clock: Callable[[], datetime] = clock or utcnow

    # ------------------------------------------------------------------ #
    def issue(
        self,
        workspace_id: str,
        tool_id: str,
        capabilities: Iterable[str] = ("read",),
        *,
        ttl_s: int | None = None,
        single_use: bool = False,
        issued_by: str = "system",
    ) -> Grant:
        if not workspace_id:
            raise ValidationFailed("workspace_id is required to issue a grant")
        if not tool_id:
            raise ValidationFailed("tool_id is required to issue a grant")
        caps = capability_filter(capabilities)
        if caps is None or not caps:
            raise ValidationFailed("a grant must carry at least one capability")
        unknown = caps - CAPABILITIES
        if unknown:  # pragma: no cover - capability_filter already rejects these
            raise ValidationFailed("unknown capabilities", details={"unknown": sorted(unknown)})

        ttl = self.default_ttl_s if ttl_s is None else int(ttl_s)
        if ttl <= 0:
            raise ValidationFailed("ttl_s must be positive")
        if ttl > MAX_TTL_S:
            raise ValidationFailed(
                "ttl_s exceeds the maximum grant lifetime",
                details={"ttl_s": ttl, "max_ttl_s": MAX_TTL_S},
            )

        now = self._clock()
        grant = Grant(
            id=f"grt_{secrets.token_hex(8)}",
            workspace_id=workspace_id,
            tool_id=tool_id,
            capabilities=frozenset(caps),
            issued_at=now,
            expires_at=now + timedelta(seconds=ttl),
            single_use=single_use,
            issued_by=issued_by,
        )
        grant.signature = _sign(self._key, grant.payload())
        self._grants[grant.id] = grant
        return grant

    def get(self, grant_id: str) -> Grant:
        try:
            return self._grants[grant_id]
        except KeyError:
            raise NotFound("grant not found", details={"grant_id": grant_id}) from None

    def verify(self, grant: Grant | str | None, *, workspace_id: str, tool_id: str, required: Iterable[str]) -> Grant:
        """Return the grant if it authorises this call, else raise."""
        if grant is None:
            raise GrantRequired(
                "this tool needs a capability grant",
                details={"tool": tool_id, "required": sorted(required)},
            )
        resolved = self.get(grant) if isinstance(grant, str) else grant

        if not hmac.compare_digest(resolved.signature, _sign(self._key, resolved.payload())):
            raise GrantRequired(
                "grant signature is invalid (it was modified after issue)",
                details={"grant_id": resolved.id},
            )
        if resolved.workspace_id != workspace_id:
            raise GrantRequired(
                "grant belongs to a different workspace",
                details={"grant_id": resolved.id, "workspace": workspace_id},
            )
        if resolved.is_revoked():
            raise GrantRequired("grant has been revoked", details={"grant_id": resolved.id})
        if resolved.is_expired(self._clock()):
            raise GrantRequired(
                "grant has expired",
                details={"grant_id": resolved.id, "expires_at": resolved.expires_at.isoformat()},
            )
        if resolved.is_exhausted():
            raise GrantRequired("single-use grant was already spent", details={"grant_id": resolved.id})
        if not resolved.covers(tool_id, required):
            raise GrantRequired(
                "grant does not cover this tool's capabilities",
                details={
                    "grant_id": resolved.id,
                    "tool": tool_id,
                    "granted": sorted(resolved.capabilities),
                    "required": sorted(required),
                },
            )
        return resolved

    def consume(self, grant: Grant) -> None:
        grant.used += 1

    def revoke(self, grant_id: str) -> Grant:
        grant = self.get(grant_id)
        grant.revoked_at = self._clock()
        return grant

    def list(self, workspace_id: str | None = None, *, live_only: bool = False) -> list[Grant]:
        now = self._clock()
        rows = [
            g
            for g in self._grants.values()
            if (workspace_id is None or g.workspace_id == workspace_id)
            and (not live_only or g.is_live(now))
        ]
        rows.sort(key=lambda g: g.issued_at, reverse=True)
        return rows

    def prune(self) -> int:
        """Drop grants that can never be used again. Returns how many went."""
        now = self._clock()
        dead = [gid for gid, g in self._grants.items() if not g.is_live(now)]
        for gid in dead:
            del self._grants[gid]
        return len(dead)


# --------------------------------------------------------------------------- #
# approvals
# --------------------------------------------------------------------------- #

APPROVAL_STATES = ("pending", "approved", "denied", "expired")


@dataclass
class Approval:
    id: str
    workspace_id: str
    tool_id: str
    arguments_hash: str
    reason: str = ""
    state: str = "pending"
    created_at: datetime = field(default_factory=utcnow)
    expires_at: datetime | None = None
    decided_by: str = ""
    decided_at: datetime | None = None

    def is_expired(self, now: datetime | None = None) -> bool:
        return self.expires_at is not None and (now or utcnow()) >= self.expires_at

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "workspace_id": self.workspace_id,
            "tool_id": self.tool_id,
            "arguments_hash": self.arguments_hash,
            "reason": self.reason,
            "state": self.state,
            "created_at": self.created_at.isoformat(),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "decided_by": self.decided_by,
            "decided_at": self.decided_at.isoformat() if self.decided_at else None,
        }


class ApprovalGate:
    """Suspends sensitive calls until a human decides.

    The spec's layer 3: *sensitive actions suspend the run and require a human*.
    A pending approval is not an error the model can retry around - it is a
    ``409 approval_pending`` that the orchestrator turns into a paused run.
    """

    def __init__(self, *, ttl_s: int = 300, db_path: str | None = None) -> None:
        self.ttl_s = max(1, int(ttl_s))
        self._approvals: dict[str, Approval] = {}
        self._lock = threading.RLock()
        self._db_path = db_path
        if self._db_path:
            from pathlib import Path
            path = Path(self._db_path)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            self._init_db()
            try:
                path.chmod(0o600)
            except OSError:
                pass

    def _connect(self):
        connection = sqlite3.connect(self._db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def _init_db(self) -> None:
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS approvals (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, tool_id TEXT NOT NULL,
                arguments_hash TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL,
                created_at TEXT NOT NULL, expires_at TEXT, decided_by TEXT NOT NULL,
                decided_at TEXT
            )""")
            rows = db.execute("SELECT * FROM approvals").fetchall()
        for row in rows:
            approval = Approval(
                id=row["id"], workspace_id=row["workspace_id"], tool_id=row["tool_id"],
                arguments_hash=row["arguments_hash"], reason=row["reason"], state=row["state"],
                created_at=datetime.fromisoformat(row["created_at"]),
                expires_at=datetime.fromisoformat(row["expires_at"]) if row["expires_at"] else None,
                decided_by=row["decided_by"],
                decided_at=datetime.fromisoformat(row["decided_at"]) if row["decided_at"] else None,
            )
            self._approvals[approval.id] = approval

    def _save(self, approval: Approval) -> None:
        if not self._db_path:
            return
        with self._connect() as db:
            db.execute("""INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,
                tool_id=excluded.tool_id, arguments_hash=excluded.arguments_hash,
                reason=excluded.reason, state=excluded.state, expires_at=excluded.expires_at,
                decided_by=excluded.decided_by, decided_at=excluded.decided_at""", (
                approval.id, approval.workspace_id, approval.tool_id, approval.arguments_hash,
                approval.reason, approval.state, approval.created_at.isoformat(),
                approval.expires_at.isoformat() if approval.expires_at else None,
                approval.decided_by, approval.decided_at.isoformat() if approval.decided_at else None,
            ))

    def request(
        self,
        workspace_id: str,
        tool_id: str,
        arguments_hash: str,
        *,
        reason: str = "",
    ) -> Approval:
        approval = Approval(
            id=f"apr_{secrets.token_hex(8)}",
            workspace_id=workspace_id,
            tool_id=tool_id,
            arguments_hash=arguments_hash,
            reason=reason or "sensitive action requires confirmation",
            expires_at=utcnow() + timedelta(seconds=self.ttl_s),
        )
        with self._lock:
            self._approvals[approval.id] = approval
            self._save(approval)
        return approval

    def get(self, approval_id: str) -> Approval:
        with self._lock:
            try:
                return self._approvals[approval_id]
            except KeyError:
                raise NotFound("approval not found", details={"approval_id": approval_id}) from None

    def decide(self, approval_id: str, *, approved: bool, decided_by: str = "user") -> Approval:
        with self._lock:
            approval = self.get(approval_id)
            if approval.state != "pending":
                raise ValidationFailed(
                    "approval has already been decided",
                    details={"approval_id": approval_id, "state": approval.state},
                )
            if approval.is_expired():
                approval.state = "expired"
                self._save(approval)
                raise ValidationFailed("approval has expired", details={"approval_id": approval_id})
            approval.state = "approved" if approved else "denied"
            approval.decided_by = decided_by
            approval.decided_at = utcnow()
            self._save(approval)
            return approval

    def pending(self, workspace_id: str | None = None) -> list[Approval]:
        with self._lock:
            rows = [
                a for a in self._approvals.values()
                if a.state == "pending" and not a.is_expired()
                and (workspace_id is None or a.workspace_id == workspace_id)
            ]
        rows.sort(key=lambda a: a.created_at, reverse=True)
        return rows

    def require(self, approval: Approval | str | None, *, workspace_id: str, tool_id: str) -> Approval:
        if approval is None:
            raise ApprovalPending(
                "this tool is sensitive and needs explicit approval",
                details={"tool": tool_id},
            )
        resolved = self.get(approval) if isinstance(approval, str) else approval
        if resolved.workspace_id != workspace_id or resolved.tool_id != tool_id:
            raise ApprovalPending(
                "approval does not match this call",
                details={"approval_id": resolved.id, "tool": tool_id},
            )
        if resolved.state != "approved":
            raise ApprovalPending(
                f"approval is {resolved.state}",
                details={"approval_id": resolved.id, "state": resolved.state},
            )
        if resolved.is_expired():
            raise ApprovalPending(
                "approval has expired", details={"approval_id": resolved.id}
            )
        return resolved


__all__ = [
    "APPROVAL_STATES",
    "DEFAULT_TTL_S",
    "MAX_TTL_S",
    "Approval",
    "ApprovalGate",
    "Grant",
    "GrantStore",
]
