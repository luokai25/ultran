"""MCP gateway audit history persists across process restarts."""
from __future__ import annotations

from datetime import datetime, timezone

from ultron_backend.mcp.gateway import GatewayAuditEntry, ToolGateway


class EmptyPool:
    def list_tools(self, *_args, **_kwargs):
        return []


def test_gateway_audit_is_restored_and_retained(tmp_path):
    path = str(tmp_path / "mcp_audit.sqlite3")
    gateway = ToolGateway(EmptyPool(), require_grants=False, audit_db_path=path, audit_limit=100)
    entry = GatewayAuditEntry(
        workspace_id="workspace", tool="docs.search", server_id="docs",
        ok=False, reason="grant_required", latency_ms=4, args_hash="args-hash",
        result_hash="", sensitive=False, capabilities=("read",),
        at=datetime.now(timezone.utc),
    )
    gateway._record(entry)
    restarted = ToolGateway(EmptyPool(), require_grants=False, audit_db_path=path, audit_limit=100)
    rows = restarted.recent()
    assert len(rows) == 1
    assert rows[0]["workspace_id"] == "workspace"
    assert rows[0]["tool"] == "docs.search"
    assert rows[0]["reason"] == "grant_required"
    assert rows[0]["args_hash"] == "args-hash"


def test_gateway_audit_is_bounded(tmp_path):
    path = str(tmp_path / "mcp_audit.sqlite3")
    gateway = ToolGateway(EmptyPool(), require_grants=False, audit_db_path=path, audit_limit=100)
    for i in range(105):
        gateway._record(GatewayAuditEntry(
            workspace_id="workspace", tool=f"tool.{i}", server_id="server",
            ok=True, reason="ok",
        ))
    restarted = ToolGateway(EmptyPool(), require_grants=False, audit_db_path=path, audit_limit=100)
    assert len(restarted.recent(200)) == 100
    assert restarted.recent(1)[0]["tool"] == "tool.104"
