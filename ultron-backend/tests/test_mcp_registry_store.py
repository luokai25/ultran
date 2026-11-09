"""Durable MCP server registry: restart, encryption and fail-closed behavior."""
from __future__ import annotations

import sqlite3

import pytest
from cryptography.fernet import Fernet

from ultron_backend.errors import ValidationFailed
from ultron_backend.mcp.registry_store import McpServerStore
from ultron_backend.mcp.transports import ServerSpec


def test_public_server_definition_survives_store_restart(tmp_path):
    path = tmp_path / "mcp_servers.sqlite3"
    first = McpServerStore(path)
    first.save(ServerSpec(id="docs", transport="http", url="https://mcp.example.com/mcp"))
    restored = McpServerStore(path).list()
    assert len(restored) == 1
    assert restored[0].id == "docs"
    assert restored[0].url == "https://mcp.example.com/mcp"


def test_secret_bearing_server_requires_encryption(tmp_path):
    store = McpServerStore(tmp_path / "mcp.sqlite3")
    spec = ServerSpec(id="private", transport="http", url="https://mcp.example.com/mcp",
                      headers={"Authorization": "Bearer never-store-me"})
    with pytest.raises(ValidationFailed, match="CREDENTIAL_ENCRYPTION_KEY"):
        store.save(spec)


def test_secret_bearing_server_is_encrypted_at_rest(tmp_path):
    path = tmp_path / "mcp.sqlite3"
    key = Fernet.generate_key().decode("ascii")
    spec = ServerSpec(id="private", transport="http", url="https://mcp.example.com/mcp",
                      headers={"Authorization": "Bearer never-store-me"})
    McpServerStore(path, encryption_key=key).save(spec)
    with sqlite3.connect(path) as db:
        config_json, encrypted = db.execute(
            "SELECT config_json, encrypted_config FROM mcp_servers WHERE id='private'"
        ).fetchone()
    assert config_json is None
    assert encrypted is not None
    assert b"never-store-me" not in bytes(encrypted)
    restored = McpServerStore(path, encryption_key=key).list()
    assert restored[0].headers["Authorization"] == "Bearer never-store-me"


def test_encrypted_server_fails_closed_without_key(tmp_path):
    path = tmp_path / "mcp.sqlite3"
    key = Fernet.generate_key().decode("ascii")
    McpServerStore(path, encryption_key=key).save(
        ServerSpec(id="private", transport="http", url="https://mcp.example.com/mcp",
                   headers={"Authorization": "Bearer secret"})
    )
    with pytest.raises(RuntimeError, match="CREDENTIAL_ENCRYPTION_KEY"):
        McpServerStore(path).list()


def test_tampered_encrypted_server_fails_closed(tmp_path):
    path = tmp_path / "mcp.sqlite3"
    key = Fernet.generate_key().decode("ascii")
    McpServerStore(path, encryption_key=key).save(
        ServerSpec(id="private", transport="http", url="https://mcp.example.com/mcp",
                   headers={"Authorization": "Bearer secret"})
    )
    with sqlite3.connect(path) as db:
        db.execute("UPDATE mcp_servers SET encrypted_config = ? WHERE id='private'", (b"tampered",))
    with pytest.raises(RuntimeError, match="cannot be decrypted"):
        McpServerStore(path, encryption_key=key).list()


def test_delete_removes_server_definition(tmp_path):
    store = McpServerStore(tmp_path / "mcp.sqlite3")
    store.save(ServerSpec(id="docs", transport="http", url="https://mcp.example.com/mcp"))
    assert store.delete("docs") is True
    assert store.delete("docs") is False
    assert store.list() == []
