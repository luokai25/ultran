"""Persistent MCP capability grant store."""
from __future__ import annotations

import sqlite3
from datetime import timedelta

import pytest
from cryptography.fernet import Fernet

from ultron_backend.mcp.errors import GrantRequired
from ultron_backend.mcp.grants import GrantStore
from ultron_backend.mcp.protocol import utcnow


def test_grants_and_signing_key_survive_restart(tmp_path):
    path = str(tmp_path / "grants.sqlite3")
    first = GrantStore(db_path=path)
    issued = first.issue("workspace", "docs.read", ["read"], single_use=True)
    restarted = GrantStore(db_path=path)
    restored = restarted.verify(issued.id, workspace_id="workspace", tool_id="docs.read", required=["read"])
    assert restored.signature == issued.signature
    restarted.consume(restored)
    after_use = GrantStore(db_path=path)
    with pytest.raises(GrantRequired, match="already spent"):
        after_use.verify(issued.id, workspace_id="workspace", tool_id="docs.read", required=["read"])


def test_grant_revocation_survives_restart(tmp_path):
    path = str(tmp_path / "grants.sqlite3")
    store = GrantStore(db_path=path)
    grant = store.issue("workspace", "docs.read", ["read"])
    store.revoke(grant.id)
    restarted = GrantStore(db_path=path)
    with pytest.raises(GrantRequired, match="revoked"):
        restarted.verify(grant.id, workspace_id="workspace", tool_id="docs.read", required=["read"])


def test_signing_key_is_encrypted_when_credential_key_is_configured(tmp_path):
    path = tmp_path / "grants.sqlite3"
    encryption_key = Fernet.generate_key().decode("ascii")
    GrantStore(db_path=str(path), encryption_key=encryption_key)
    with sqlite3.connect(path) as db:
        value = bytes(db.execute("SELECT value FROM grant_meta WHERE key='signing_key'").fetchone()[0])
    assert len(value) != 32
    assert Fernet(encryption_key.encode("ascii")).decrypt(value)


def test_persistent_grants_reject_wrong_encryption_key(tmp_path):
    path = str(tmp_path / "grants.sqlite3")
    first = Fernet.generate_key().decode("ascii")
    second = Fernet.generate_key().decode("ascii")
    store = GrantStore(db_path=path, encryption_key=first)
    store.issue("workspace", "docs.read", ["read"])
    with pytest.raises(RuntimeError, match="cannot be decrypted"):
        GrantStore(db_path=path, encryption_key=second)


def test_persistent_grant_prune_removes_database_rows(tmp_path):
    path = str(tmp_path / "grants.sqlite3")
    store = GrantStore(db_path=path)
    expired = store.issue("workspace", "docs.read", ["read"], ttl_s=1)
    expired.expires_at = utcnow() - timedelta(seconds=1)
    store._save(expired)
    assert store.prune() == 1
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM grants").fetchone()[0] == 0
