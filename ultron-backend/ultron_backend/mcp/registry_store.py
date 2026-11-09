"""Durable, encrypted registry for dynamically registered MCP servers.

Server metadata may be stored as JSON when it contains no credentials. Any
server environment values or HTTP headers are encrypted with the existing
ULTRON credential-encryption key; secret-bearing registrations fail closed if
that key is unavailable. This prevents the registry from becoming a plaintext
credential dump on disk.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any

from ..errors import ValidationFailed
from .transports import ServerSpec


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class McpServerStore:
    """SQLite-backed MCP server definitions with optional Fernet encryption."""

    def __init__(self, db_path: str | Path, *, encryption_key: str | None = None) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._lock = RLock()
        self._fernet: Any = None
        if encryption_key:
            try:
                from cryptography.fernet import Fernet
                self._fernet = Fernet(encryption_key.encode("ascii"))
            except Exception as exc:
                raise ValueError("MCP registry encryption key is invalid") from exc
        with self._connect() as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS mcp_servers (
                    id TEXT PRIMARY KEY,
                    config_json TEXT,
                    encrypted_config BLOB,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    CHECK ((config_json IS NOT NULL) <> (encrypted_config IS NOT NULL))
                )
                """
            )
        try:
            self._path.chmod(0o600)
        except OSError:
            pass

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self._path, timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=10000")
        return db

    @staticmethod
    def _payload(spec: ServerSpec) -> dict[str, Any]:
        return asdict(spec)

    def save(self, spec: ServerSpec) -> None:
        payload = self._payload(spec)
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        secret_bearing = bool(spec.env or spec.headers)
        if secret_bearing and self._fernet is None:
            raise ValidationFailed(
                "This MCP server includes environment values or HTTP headers. "
                "Set ULTRON_CREDENTIAL_ENCRYPTION_KEY before saving it so credentials "
                "can be encrypted at rest."
            )
        encrypted = self._fernet.encrypt(raw.encode("utf-8")) if self._fernet else None
        config_json = None if encrypted else raw
        now = _utcnow()
        with self._lock, self._connect() as db:
            db.execute(
                """
                INSERT INTO mcp_servers (id, config_json, encrypted_config, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    config_json=excluded.config_json,
                    encrypted_config=excluded.encrypted_config,
                    updated_at=excluded.updated_at
                """,
                (spec.id, config_json, encrypted, now, now),
            )

    def list(self) -> list[ServerSpec]:
        with self._lock, self._connect() as db:
            rows = db.execute(
                "SELECT id, config_json, encrypted_config FROM mcp_servers ORDER BY id"
            ).fetchall()
        specs: list[ServerSpec] = []
        for server_id, config_json, encrypted_config in rows:
            if encrypted_config is not None:
                if self._fernet is None:
                    raise RuntimeError(
                        f"MCP server '{server_id}' is encrypted; configure "
                        "ULTRON_CREDENTIAL_ENCRYPTION_KEY to restore it."
                    )
                try:
                    raw = self._fernet.decrypt(bytes(encrypted_config)).decode("utf-8")
                except Exception as exc:
                    raise RuntimeError(
                        f"MCP server '{server_id}' cannot be decrypted; check "
                        "ULTRON_CREDENTIAL_ENCRYPTION_KEY."
                    ) from exc
            else:
                raw = str(config_json or "")
            try:
                payload = json.loads(raw)
                specs.append(ServerSpec.from_dict(payload))
            except Exception as exc:
                raise RuntimeError(f"MCP server '{server_id}' has an invalid stored definition.") from exc
        return specs

    def delete(self, server_id: str) -> bool:
        with self._lock, self._connect() as db:
            cursor = db.execute("DELETE FROM mcp_servers WHERE id = ?", (server_id,))
            return cursor.rowcount > 0
