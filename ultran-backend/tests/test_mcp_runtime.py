"""End-to-end: a real MCP server over stdio, through the pool and the gateway.

These tests spawn an actual MCP server process (``tests/fixtures/mcp_fixture_server.py``)
and drive it with the real SDK client. Nothing here is mocked, which is the only
way to prove the transport, handshake, tool index and invocation actually work.
"""

from __future__ import annotations

import sys

import pytest

from ultran_backend.errors import NotFound, ValidationFailed
from ultran_backend.mcp import (
    McpClientPool,
    ServerSpec,
    manifest_hash,
)
from ultran_backend.mcp.errors import (
    ApprovalPending,
    EgressDenied,
    GrantRequired,
    McpUnavailable,
    TrustViolation,
)
from ultran_backend.mcp.transports import child_env, sdk_available

pytestmark = pytest.mark.skipif(not sdk_available(), reason="MCP SDK not installed")


# ---------------------------------------------------------------- handshake


def test_pool_connects_and_lists_tools(live_pool):
    conn = live_pool.connection("fixture")
    assert conn.state == "ready"
    assert conn.ready
    names = {t.name for t in conn.tools}
    assert {"read_file", "write_file", "delete_path", "fetch_url", "echo"} <= names


def test_handshake_records_server_info(live_pool):
    conn = live_pool.connection("fixture")
    assert conn.info.name == "fixture"
    assert conn.info.protocol_version


def test_manifest_hash_is_recorded(live_pool):
    conn = live_pool.connection("fixture")
    assert conn.manifest_hash == manifest_hash(conn.tools)
    assert len(conn.manifest_hash) == 64


def test_annotations_survive_the_wire(live_pool):
    """The server's readOnlyHint must reach us as a capability."""
    conn = live_pool.connection("fixture")
    by_name = {t.name: t for t in conn.tools}
    assert by_name["read_file"].capabilities == {"read"}
    assert by_name["read_file"].annotations.read_only
    assert "delete" in by_name["delete_path"].capabilities
    assert by_name["delete_path"].requires_approval


def test_unannotated_tool_falls_back_to_name_inference(live_pool):
    conn = live_pool.connection("fixture")
    by_name = {t.name: t for t in conn.tools}
    assert by_name["write_file"].capabilities == {"write"}
    assert by_name["echo"].capabilities == {"write"}


def test_tool_schemas_are_captured(live_pool):
    conn = live_pool.connection("fixture")
    by_name = {t.name: t for t in conn.tools}
    assert "path" in by_name["read_file"].required
    assert by_name["read_file"].input_schema["type"] == "object"


def test_stats_report_the_connection(live_pool):
    stats = live_pool.stats()
    assert stats["servers"] == 1
    assert stats["connected"] == 1
    assert stats["tools"] >= 5
    assert stats["transports"] == ["stdio"]


def test_health_is_ok_when_everything_is_up(live_pool):
    health = live_pool.health()
    assert health["ok"] is True
    assert health["servers"][0]["state"] == "ready"


# ---------------------------------------------------------------- tool index


def test_capability_filter_returns_only_read_tools(live_pool):
    rows = live_pool.list_tools(["read"])
    assert rows
    assert all(t.capabilities == {"read"} for t in rows)
    assert "fixture.read_file" in {t.id for t in rows}
    assert "fixture.write_file" not in {t.id for t in rows}


def test_no_filter_returns_everything(live_pool):
    assert len(live_pool.list_tools(None)) >= 5


def test_empty_capability_set_returns_nothing(live_pool):
    assert live_pool.list_tools([]) == []


def test_find_tool_by_qualified_id(live_pool):
    assert live_pool.find_tool("fixture.read_file").name == "read_file"


def test_find_tool_by_bare_name(live_pool):
    assert live_pool.find_tool("read_file").id == "fixture.read_file"


def test_find_unknown_tool_raises(live_pool):
    with pytest.raises(NotFound):
        live_pool.find_tool("fixture.nope")


def test_ambiguous_bare_name_is_rejected():
    """Two servers exposing ``search`` must not silently resolve to one."""
    pool = McpClientPool()
    pool.register(ServerSpec(id="a", command=sys.executable, args=("-c", "pass")))
    pool.register(ServerSpec(id="b", command=sys.executable, args=("-c", "pass")))
    # Inject fake ready connections with a colliding tool name.
    from ultran_backend.mcp.protocol import ToolSpec

    for sid in ("a", "b"):
        conn = pool.connection(sid)
        conn.state = "ready"
        conn.tools = [ToolSpec.from_wire(sid, {"name": "search", "inputSchema": {}})]
    with pytest.raises(ValidationFailed, match="ambiguous"):
        pool.find_tool("search")


# ---------------------------------------------------------------- invocation


def test_call_tool_returns_normalised_text(live_pool):
    result = live_pool.call_tool("fixture.read_file", {"path": "/tmp/x"})
    assert result.ok
    assert "contents of /tmp/x" in result.text
    assert result.latency_ms >= 0
    assert result.args_hash


def test_call_tool_records_the_tier(live_pool):
    assert live_pool.call_tool("fixture.echo", {"text": "hi"}).tier == "remote-mcp"


def test_tool_error_is_data_not_an_exception(live_pool):
    result = live_pool.call_tool("fixture.boom", {})
    assert not result.ok
    assert result.is_error


def test_unknown_tool_call_raises(live_pool):
    with pytest.raises(NotFound):
        live_pool.call_tool("fixture.nope", {})


# ---------------------------------------------------------------- gateway


def test_gateway_requires_a_grant(gateway):
    with pytest.raises(GrantRequired):
        gateway.invoke("fixture.read_file", {"path": "/x"}, workspace_id="ws")


def test_gateway_invokes_with_a_grant(gateway):
    grant = gateway.issue_grant("ws", "fixture.read_file")
    outcome = gateway.invoke(
        "fixture.read_file", {"path": "/x"}, workspace_id="ws", grant=grant
    )
    assert outcome.ok
    assert outcome.grant_id == grant.id
    assert "contents of /x" in outcome.result.text


def test_gateway_issues_a_grant_scoped_to_the_tool(gateway):
    grant = gateway.issue_grant("ws", "fixture.read_file")
    assert grant.capabilities == {"read"}
    assert grant.tool_id == "fixture.read_file"


def test_gateway_rejects_a_grant_for_another_tool(gateway):
    grant = gateway.issue_grant("ws", "fixture.read_file")
    with pytest.raises(GrantRequired):
        gateway.invoke("fixture.write_file", {"path": "/x", "content": "y"}, workspace_id="ws", grant=grant)


def test_gateway_rejects_a_read_grant_for_a_write_tool(gateway):
    grant = gateway.grants.issue("ws", "fixture.write_file", ["read"])
    with pytest.raises(GrantRequired, match="does not cover"):
        gateway.invoke(
            "fixture.write_file", {"path": "/x", "content": "y"}, workspace_id="ws", grant=grant
        )


def test_gateway_validates_arguments_before_calling(gateway):
    grant = gateway.issue_grant("ws", "fixture.read_file")
    with pytest.raises(Exception) as exc:
        gateway.invoke("fixture.read_file", {}, workspace_id="ws", grant=grant)
    assert exc.value.code == "schema_invalid"


def test_gateway_suspends_a_destructive_tool_for_approval(gateway):
    grant = gateway.issue_grant("ws", "fixture.delete_path")
    with pytest.raises(ApprovalPending) as exc:
        gateway.invoke("fixture.delete_path", {"path": "/x"}, workspace_id="ws", grant=grant)
    assert exc.value.details["approval_id"].startswith("apr_")


def test_gateway_runs_a_destructive_tool_once_approved(gateway):
    grant = gateway.issue_grant("ws", "fixture.delete_path")
    with pytest.raises(ApprovalPending) as exc:
        gateway.invoke("fixture.delete_path", {"path": "/x"}, workspace_id="ws", grant=grant)
    approval_id = exc.value.details["approval_id"]
    gateway.approvals.decide(approval_id, approved=True, decided_by="luokai")
    outcome = gateway.invoke(
        "fixture.delete_path",
        {"path": "/x"},
        workspace_id="ws",
        grant=grant,
        approval=approval_id,
    )
    assert outcome.ok
    assert outcome.approval_id == approval_id


def test_gateway_blocks_egress_to_an_unlisted_host(gateway):
    grant = gateway.issue_grant("ws", "fixture.fetch_url")
    with pytest.raises(EgressDenied):
        gateway.invoke(
            "fixture.fetch_url", {"url": "https://evil.com/steal"}, workspace_id="ws", grant=grant
        )


def test_gateway_allows_egress_to_a_listed_host(gateway):
    grant = gateway.issue_grant("ws", "fixture.fetch_url")
    outcome = gateway.invoke(
        "fixture.fetch_url", {"url": "https://api.github.com/repos"}, workspace_id="ws", grant=grant
    )
    assert outcome.ok
    assert outcome.egress["checked"][0]["host"] == "api.github.com"


def test_gateway_rejects_an_oversized_payload(gateway):
    grant = gateway.issue_grant("ws", "fixture.write_file")
    with pytest.raises(ValidationFailed, match="budget"):
        gateway.invoke(
            "fixture.write_file",
            {"path": "/x", "content": "y" * 300_000},
            workspace_id="ws",
            grant=grant,
        )


def test_gateway_audits_every_attempt(gateway):
    grant = gateway.issue_grant("ws", "fixture.read_file")
    gateway.invoke("fixture.read_file", {"path": "/x"}, workspace_id="ws", grant=grant)
    with pytest.raises(GrantRequired):
        gateway.invoke("fixture.read_file", {"path": "/x"}, workspace_id="ws")
    entries = gateway.recent(10)
    assert len(entries) == 2
    assert {e["ok"] for e in entries} == {True, False}
    assert entries[0]["reason"] == "grant_required"


def test_gateway_audit_carries_hashes(gateway):
    grant = gateway.issue_grant("ws", "fixture.read_file")
    gateway.invoke("fixture.read_file", {"path": "/x"}, workspace_id="ws", grant=grant)
    entry = gateway.recent(1)[0]
    assert len(entry["args_hash"]) == 64
    assert len(entry["result_hash"]) == 64


def test_gateway_summary_counts_denials(gateway):
    grant = gateway.issue_grant("ws", "fixture.read_file")
    gateway.invoke("fixture.read_file", {"path": "/x"}, workspace_id="ws", grant=grant)
    with pytest.raises(GrantRequired):
        gateway.invoke("fixture.read_file", {"path": "/x"}, workspace_id="ws")
    summary = gateway.summary()
    assert summary["total"] == 2
    assert summary["ok"] == 1
    assert summary["denied"] == 1


def test_gateway_search_ranks_by_relevance(gateway):
    rows = gateway.search_tools("read file", capabilities=["read"])
    assert rows
    assert rows[0].name == "read_file"


def test_gateway_search_respects_the_capability_ceiling(gateway):
    rows = gateway.search_tools("write", capabilities=["read"])
    assert all(t.capabilities == {"read"} for t in rows)


def test_gateway_describe_returns_the_spec(gateway):
    payload = gateway.describe("fixture.read_file")
    assert payload["id"] == "fixture.read_file"
    assert payload["annotations"]["read_only"] is True


def test_gateway_without_grants_still_validates(open_gateway):
    with pytest.raises(Exception) as exc:
        open_gateway.invoke("fixture.read_file", {}, workspace_id="ws")
    assert exc.value.code == "schema_invalid"


def test_gateway_without_grants_invokes(open_gateway):
    outcome = open_gateway.invoke("fixture.read_file", {"path": "/x"}, workspace_id="ws")
    assert outcome.ok


# ---------------------------------------------------------------- trust


def test_pinned_hash_mismatch_quarantines_the_server():
    pool = McpClientPool()
    pool.register(
        ServerSpec(
            id="pinned",
            command=sys.executable,
            args=(str(_fixture_path()),),
            pinned_hash="0" * 64,
            trust_level="third_party",
        )
    )
    with pytest.raises(TrustViolation):
        pool.connect("pinned")
    conn = pool.connection("pinned")
    assert conn.state == "quarantined"
    assert conn.tools == []
    pool.close()


def test_matching_pin_is_accepted():
    pool = McpClientPool()
    pool.register(ServerSpec(id="p", command=sys.executable, args=(str(_fixture_path()),)))
    pool.connect("p")
    actual = pool.connection("p").manifest_hash
    pool.close()

    pool2 = McpClientPool()
    pool2.register(
        ServerSpec(
            id="p",
            command=sys.executable,
            args=(str(_fixture_path()),),
            pinned_hash=actual,
        )
    )
    assert pool2.connect("p").state == "ready"
    pool2.close()


def test_short_pin_prefix_is_accepted():
    pool = McpClientPool()
    pool.register(ServerSpec(id="p", command=sys.executable, args=(str(_fixture_path()),)))
    pool.connect("p")
    actual = pool.connection("p").manifest_hash
    pool.close()

    pool2 = McpClientPool()
    pool2.register(
        ServerSpec(
            id="p",
            command=sys.executable,
            args=(str(_fixture_path()),),
            pinned_hash=actual[:16],
        )
    )
    assert pool2.connect("p").state == "ready"
    pool2.close()


# ---------------------------------------------------------------- failures


def test_missing_command_fails_cleanly():
    pool = McpClientPool()
    pool.register(ServerSpec(id="ghost", command="/nonexistent/binary-xyz"))
    with pytest.raises(McpUnavailable):
        pool.connect("ghost")
    conn = pool.connection("ghost")
    assert conn.state == "failed"
    assert conn.last_error
    pool.close()


def test_failed_connect_does_not_raise_when_asked_not_to():
    pool = McpClientPool()
    pool.register(ServerSpec(id="ghost", command="/nonexistent/binary-xyz"))
    conn = pool.connect("ghost", raise_on_error=False)
    assert conn.state == "failed"
    pool.close()


def test_a_failed_server_contributes_no_tools():
    pool = McpClientPool()
    pool.register(ServerSpec(id="ghost", command="/nonexistent/binary-xyz"))
    pool.connect("ghost", raise_on_error=False)
    assert pool.list_tools(None) == []
    pool.close()


def test_duplicate_registration_is_rejected():
    pool = McpClientPool()
    pool.register(ServerSpec(id="x", command="true"))
    with pytest.raises(ValidationFailed, match="already registered"):
        pool.register(ServerSpec(id="x", command="true"))
    pool.register(ServerSpec(id="x", command="true"), replace=True)


def test_unregister_removes_the_server(live_pool):
    pool = McpClientPool()
    pool.register(ServerSpec(id="tmp", command=sys.executable, args=(str(_fixture_path()),)))
    pool.connect("tmp")
    pool.unregister("tmp")
    assert "tmp" not in pool
    with pytest.raises(NotFound):
        pool.get("tmp")
    pool.close()


def test_probe_refreshes_the_tool_list(live_pool):
    status = live_pool.probe("fixture")
    assert status["state"] == "ready"
    assert status["tools"]


# ---------------------------------------------------------------- env hygiene


def test_child_env_drops_ambient_secrets():
    """No ambient credentials: only the allow-list plus the server's own vars."""
    spec = ServerSpec(id="x", command="true", env={"MY_TOKEN": "abc"})
    env = child_env(spec, base={"PATH": "/bin", "AWS_SECRET_ACCESS_KEY": "leak", "HOME": "/root"})
    assert env["PATH"] == "/bin"
    assert env["HOME"] == "/root"
    assert env["MY_TOKEN"] == "abc"
    assert "AWS_SECRET_ACCESS_KEY" not in env


def test_server_spec_redacts_secrets():
    spec = ServerSpec(
        id="x",
        command="true",
        env={"API_KEY": "super-secret"},
        headers={"Authorization": "Bearer super-secret"},
    )
    payload = spec.redacted()
    assert "super-secret" not in str(payload)
    assert payload["env_keys"] == ["API_KEY"]
    assert payload["header_keys"] == ["Authorization"]


def test_server_spec_requires_a_command_for_stdio():
    with pytest.raises(ValueError, match="command"):
        ServerSpec(id="x", transport="stdio")


def test_server_spec_requires_a_url_for_http():
    with pytest.raises(ValueError, match="url"):
        ServerSpec(id="x", transport="http")


def test_server_spec_rejects_an_unknown_transport():
    with pytest.raises(ValueError, match="transport"):
        ServerSpec(id="x", transport="carrier-pigeon")


def _fixture_path():
    from pathlib import Path

    return Path(__file__).parent / "fixtures" / "mcp_fixture_server.py"
