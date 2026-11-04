"""Workspace-scoped credentials with optional encrypted SQLite persistence.

Persistent mode requires an operator-supplied Fernet key. There is deliberately
no plaintext fallback: without a key the vault remains process-local.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from ..errors import Conflict, NotFound, ValidationFailed

MIN_SECRET_LEN = 8
MAX_SECRET_LEN = 4096


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def mask_secret(secret: str) -> str:
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
        """Internal-only accessor used by provider adapters."""
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
    """Per-workspace credential store keyed by (connector_id, label).

    Supply both db_path and encryption_key to enable durable encrypted storage.
    The key must be a valid URL-safe Fernet key and must be backed up by the
    operator; losing it makes stored credentials unrecoverable.
    """

    def __init__(self, db_path: str | Path | None = None, encryption_key: str | None = None) -> None:
        if bool(db_path) != bool(encryption_key):
            raise ValueError("db_path and encryption_key must be configured together")
        self._store: dict[str, dict[tuple[str, str], StoredCredential]] = {}
        self._db_path = Path(db_path) if db_path else None
        self._fernet = None
        if self._db_path is not None:
            try:
                from cryptography.fernet import Fernet
                self._fernet = Fernet(encryption_key.encode("ascii"))
                self._db_path.parent.mkdir(parents=True, exist_ok=True)
                with self._connect() as db:
                    db.execute("""
                        CREATE TABLE IF NOT EXISTS credentials (
                            workspace_id TEXT NOT NULL,
                            connector_id TEXT NOT NULL,
                            label TEXT NOT NULL,
                            plan TEXT NOT NULL,
                            secret BLOB NOT NULL,
                            fingerprint TEXT NOT NULL,
                            created_at TEXT NOT NULL,
                            uses INTEGER NOT NULL DEFAULT 0,
                            last_used_at TEXT,
                            PRIMARY KEY (workspace_id, connector_id, label)
                        )
                    """)
            except Exception as exc:
                raise ValueError("credential encryption configuration is invalid") from exc

    @property
    def persistent(self) -> bool:
        return self._db_path is not None

    def _connect(self):
        if self._db_path is None:
            raise RuntimeError("persistent credential storage is not configured")
        db = sqlite3.connect(self._db_path, timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=10000")
        return db

    def _bucket(self, workspace_id: str) -> dict[tuple[str, str], StoredCredential]:
        return self._store.setdefault(workspace_id, {})

    def _load(self, workspace_id: str, connector_id: str, label: str) -> StoredCredential | None:
        if not self.persistent:
            return None
        with self._connect() as db:
            row = db.execute(
                """SELECT plan, secret, fingerprint, created_at, uses, last_used_at
                   FROM credentials WHERE workspace_id=? AND connector_id=? AND label=?""",
                (workspace_id, connector_id, label),
            ).fetchone()
        if row is None:
            return None
        try:
            secret = self._fernet.decrypt(row[1]).decode("utf-8")
        except Exception as exc:
            raise RuntimeError("stored credential cannot be decrypted; check encryption key") from exc
        cred = StoredCredential(
            connector_id=connector_id, label=label, plan=row[0], _secret=secret,
            fingerprint=row[2], created_at=datetime.fromisoformat(row[3]),
            uses=row[4], last_used_at=datetime.fromisoformat(row[5]) if row[5] else None,
        )
        self._bucket(workspace_id)[(connector_id, label)] = cred
        return cred

    def _persist(self, workspace_id: str, cred: StoredCredential) -> None:
        if not self.persistent:
            return
        encrypted = self._fernet.encrypt(cred.reveal().encode("utf-8"))
        with self._connect() as db:
            db.execute(
                """INSERT INTO credentials
                   (workspace_id, connector_id, label, plan, secret, fingerprint, created_at, uses, last_used_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(workspace_id, connector_id, label) DO UPDATE SET
                     plan=excluded.plan, secret=excluded.secret, fingerprint=excluded.fingerprint,
                     created_at=excluded.created_at, uses=excluded.uses, last_used_at=excluded.last_used_at""",
                (workspace_id, cred.connector_id, cred.label, cred.plan, encrypted,
                 cred.fingerprint, cred.created_at.isoformat(), cred.uses,
                 cred.last_used_at.isoformat() if cred.last_used_at else None),
            )

    def put(self, workspace_id: str, connector_id: str, api_key: str, *,
            plan: str = "free", label: str = "default") -> StoredCredential:
        key = (api_key or "").strip()
        if len(key) < MIN_SECRET_LEN:
            raise ValidationFailed("api_key is too short", details={"min_length": MIN_SECRET_LEN})
        if len(key) > MAX_SECRET_LEN:
            raise ValidationFailed("api_key is too long", details={"max_length": MAX_SECRET_LEN})
        if plan not in {"free", "paid"}:
            raise ValidationFailed("plan must be free or paid", details={"plan": plan})
        if not label.strip():
            raise ValidationFailed("label must not be empty")
        existing = self.get(workspace_id, connector_id, label) if self.has(workspace_id, connector_id, label) else None
        if existing and hmac.compare_digest(existing.fingerprint, fingerprint(key)):
            raise Conflict("identical credential already stored",
                           details={"connector_id": connector_id, "label": label})
        cred = StoredCredential(connector_id, label, plan, key, fingerprint(key))
        self._bucket(workspace_id)[(connector_id, label)] = cred
        self._persist(workspace_id, cred)
        return cred

    def get(self, workspace_id: str, connector_id: str, label: str = "default") -> StoredCredential:
        cred = self._store.get(workspace_id, {}).get((connector_id, label))
        if cred is None:
            cred = self._load(workspace_id, connector_id, label)
        if cred is None:
            raise NotFound("no credential stored for connector",
                           details={"connector_id": connector_id, "label": label})
        return cred

    def has(self, workspace_id: str, connector_id: str, label: str = "default") -> bool:
        if (connector_id, label) in self._store.get(workspace_id, {}):
            return True
        if not self.persistent:
            return False
        with self._connect() as db:
            row = db.execute(
                "SELECT 1 FROM credentials WHERE workspace_id=? AND connector_id=? AND label=?",
                (workspace_id, connector_id, label),
            ).fetchone()
        return row is not None

    def list(self, workspace_id: str) -> list[StoredCredential]:
        if self.persistent:
            with self._connect() as db:
                rows = db.execute(
                    "SELECT connector_id, label FROM credentials WHERE workspace_id=? ORDER BY connector_id, label",
                    (workspace_id,),
                ).fetchall()
            for connector_id, label in rows:
                self.get(workspace_id, connector_id, label)
        return sorted(self._store.get(workspace_id, {}).values(),
                      key=lambda c: (c.connector_id, c.label))

    def revoke(self, workspace_id: str, connector_id: str, label: str = "default") -> None:
        if not self.has(workspace_id, connector_id, label):
            raise NotFound("no credential stored for connector",
                           details={"connector_id": connector_id, "label": label})
        self._store.get(workspace_id, {}).pop((connector_id, label), None)
        if self.persistent:
            with self._connect() as db:
                db.execute("DELETE FROM credentials WHERE workspace_id=? AND connector_id=? AND label=?",
                           (workspace_id, connector_id, label))

    def rotate(self, workspace_id: str, connector_id: str, new_key: str, *,
               label: str = "default") -> StoredCredential:
        existing = self.get(workspace_id, connector_id, label)
        return self.put(workspace_id, connector_id, new_key, plan=existing.plan, label=label)

    def count(self, workspace_id: str) -> int:
        if self.persistent:
            with self._connect() as db:
                row = db.execute("SELECT COUNT(*) FROM credentials WHERE workspace_id=?",
                                 (workspace_id,)).fetchone()
            return int(row[0])
        return len(self._store.get(workspace_id, {}))

    def wipe(self, workspace_id: str) -> int:
        count = self.count(workspace_id)
        self._store.pop(workspace_id, None)
        if self.persistent:
            with self._connect() as db:
                db.execute("DELETE FROM credentials WHERE workspace_id=?", (workspace_id,))
        return count


def new_workspace_token() -> str:
    return f"ult_{secrets.token_urlsafe(24)}"
