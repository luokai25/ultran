"""Credential storage with masking, fingerprinting and a strict no-echo rule.

The vault never returns a stored secret. Reads hand back a masked preview plus a
short SHA-256 fingerprint so the UI can show *which* key is installed without
keeping the key itself anywhere near the wire.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..errors import Conflict, NotFound, ValidationFailed

MIN_SECRET_LEN = 8
MAX_SECRET_LEN = 4096


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def mask_secret(secret: str) -> str:
    """Return a preview that never discloses more than 4 trailing characters."""
    if len(secret) <= 8:
        return "*" * max(len(secret), 4)
    return f"{secret[:4]}{'*' * 8}{secret[-4:]}"


def fingerprint(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:16]


@dataclass
class StoredCredential:
    connector_id: str
    label: str
    plan: str
    _secret: str
    fingerprint: str
    created_at: datetime = field(default_factory=utcnow)
    last_used_at: datetime | None = None
    uses: int = 0

    @property
    def masked_key(self) -> str:
        return mask_secret(self._secret)

    def reveal(self) -> str:
        """Internal-only accessor used by the tool sandbox."""
        return self._secret

    def touch(self) -> None:
        self.uses += 1
        self.last_used_at = utcnow()

    def public(self) -> dict[str, object]:
        return {
            "connector_id": self.connector_id,
            "label": self.label,
            "plan": self.plan,
            "masked_key": self.masked_key,
            "fingerprint": self.fingerprint,
            "created_at": self.created_at,
            "uses": self.uses,
            "last_used_at": self.last_used_at,
        }


class CredentialVault:
    """Per-workspace credential store keyed by ``(connector_id, label)``."""

    def __init__(self) -> None:
        self._store: dict[str, dict[tuple[str, str], StoredCredential]] = {}

    def _bucket(self, workspace_id: str) -> dict[tuple[str, str], StoredCredential]:
        return self._store.setdefault(workspace_id, {})

    # ------------------------------------------------------------------ #
    def put(
        self,
        workspace_id: str,
        connector_id: str,
        api_key: str,
        *,
        plan: str = "free",
        label: str = "default",
    ) -> StoredCredential:
        key = (api_key or "").strip()
        if len(key) < MIN_SECRET_LEN:
            raise ValidationFailed(
                "api_key is too short", details={"min_length": MIN_SECRET_LEN}
            )
        if len(key) > MAX_SECRET_LEN:
            raise ValidationFailed(
                "api_key is too long", details={"max_length": MAX_SECRET_LEN}
            )
        if plan not in {"free", "paid"}:
            raise ValidationFailed("plan must be free or paid", details={"plan": plan})
        if not label.strip():
            raise ValidationFailed("label must not be empty")

        bucket = self._bucket(workspace_id)
        slot = (connector_id, label)
        if slot in bucket and hmac.compare_digest(bucket[slot].fingerprint, fingerprint(key)):
            raise Conflict(
                "identical credential already stored",
                details={"connector_id": connector_id, "label": label},
            )
        cred = StoredCredential(
            connector_id=connector_id,
            label=label,
            plan=plan,
            _secret=key,
            fingerprint=fingerprint(key),
        )
        bucket[slot] = cred
        return cred

    def get(self, workspace_id: str, connector_id: str, label: str = "default") -> StoredCredential:
        bucket = self._store.get(workspace_id, {})
        try:
            return bucket[(connector_id, label)]
        except KeyError:
            raise NotFound(
                "no credential stored for connector",
                details={"connector_id": connector_id, "label": label},
            ) from None

    def has(self, workspace_id: str, connector_id: str, label: str = "default") -> bool:
        return (connector_id, label) in self._store.get(workspace_id, {})

    def list(self, workspace_id: str) -> list[StoredCredential]:
        return sorted(
            self._store.get(workspace_id, {}).values(),
            key=lambda c: (c.connector_id, c.label),
        )

    def revoke(self, workspace_id: str, connector_id: str, label: str = "default") -> None:
        bucket = self._store.get(workspace_id)
        if not bucket or (connector_id, label) not in bucket:
            raise NotFound(
                "no credential stored for connector",
                details={"connector_id": connector_id, "label": label},
            )
        del bucket[(connector_id, label)]

    def rotate(
        self, workspace_id: str, connector_id: str, new_key: str, *, label: str = "default"
    ) -> StoredCredential:
        existing = self.get(workspace_id, connector_id, label)
        self.put(workspace_id, connector_id, new_key, plan=existing.plan, label=label)
        return self.get(workspace_id, connector_id, label)

    def count(self, workspace_id: str) -> int:
        return len(self._store.get(workspace_id, {}))

    def wipe(self, workspace_id: str) -> int:
        return len(self._store.pop(workspace_id, {}))


def new_workspace_token() -> str:
    """Generate a workspace-scoped bearer token for the local API."""
    return f"ult_{secrets.token_urlsafe(24)}"
