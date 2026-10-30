"""Ultran *as* an MCP server: read-only, for Claude Desktop and friends.

The spec's rule is that an MCP host "must not be able to issue grants". These
tests assert that structurally - the exposed surface has no mutating tool - and
behaviourally, over the JSON-RPC loop a host actually speaks.
"""

from __future__ import annotations

import io
import json

import pytest

from ultran_backend.mcp.server import (
    PROTOCOL_VERSION,
    UltranMcpServer,
    build_server,
    build_tools,
)


@pytest.fixture()
def server(container) -> UltranMcpServer:
    return build_server(container)


# ---------------------------------------------------------------- surface


def test_server_exposes_tools(server):
    assert len(server.tool_names()) >= 5


def test_every_exposed_tool_is_read_only(server):
    for tool in server.list_tools():
        assert tool["annotations"]["readOnlyHint"] is True, tool["name"]
        assert tool["annotations"]["destructiveHint"] is False, tool["name"]


def test_no_mutating_tool_is_exposed(server):
    """The whole point: a host cannot act, only look."""
    forbidden = {
        "invoke_tool",
        "call_tool",
        "issue_grant",
        "revoke_grant",
        "register_server",
        "unregister_server",
        "delete_connector",
        "approve",
    }
    assert not (set(server.tool_names()) & forbidden)


def test_tools_have_descriptions_and_schemas(server):
    for tool in server.list_tools():
        assert tool["description"], tool["name"]
        assert tool["inputSchema"]["type"] == "object"


def test_tool_names_are_verb_noun(server):
    for name in server.tool_names():
        assert "_" in name, name


# ---------------------------------------------------------------- protocol


def test_initialize_returns_protocol_and_server_info(server):
    response = server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    result = response["result"]
    assert result["protocolVersion"] == PROTOCOL_VERSION
    assert result["serverInfo"]["name"] == "ultran"
    assert "tools" in result["capabilities"]


def test_initialize_instructions_state_read_only(server):
    response = server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert "read-only" in response["result"]["instructions"].lower()


def test_tools_list_returns_the_wire_shape(server):
    response = server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    tools = response["result"]["tools"]
    assert tools
    assert {"name", "description", "inputSchema", "annotations"} <= set(tools[0])


def test_tools_call_runs_a_read_tool(server):
    response = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "list_connectors", "arguments": {"limit": 3}},
        }
    )
    result = response["result"]
    assert result["isError"] is False
    payload = json.loads(result["content"][0]["text"])
    assert len(payload) == 3


def test_tools_call_unknown_tool_is_an_error_result(server):
    response = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "nope", "arguments": {}},
        }
    )
    assert response["result"]["isError"] is True


def test_tools_call_handler_failure_is_contained(server):
    """A tool error must be data, never a crashed server."""
    response = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {"name": "list_mcp_tools", "arguments": {"limit": "not-an-int"}},
        }
    )
    assert response["result"]["isError"] is True


def test_unknown_method_returns_jsonrpc_error(server):
    response = server.handle({"jsonrpc": "2.0", "id": 6, "method": "resources/list"})
    assert response["error"]["code"] == -32601


def test_notification_returns_nothing(server):
    assert server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None


def test_ping_is_answered(server):
    assert server.handle({"jsonrpc": "2.0", "id": 7, "method": "ping"})["result"] == {}


# ---------------------------------------------------------------- stdio loop


def test_stdio_loop_answers_a_full_session(server):
    """Drive the real line-delimited loop a host would use."""
    requests = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "workspace_stats", "arguments": {}},
        },
    ]
    stdin = io.StringIO("\n".join(json.dumps(r) for r in requests) + "\n")
    stdout = io.StringIO()
    server.serve_stdio(stdin=stdin, stdout=stdout)

    lines = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
    assert len(lines) == 3  # the notification produced no response
    assert lines[0]["result"]["serverInfo"]["name"] == "ultran"
    assert lines[1]["result"]["tools"]
    assert lines[2]["result"]["isError"] is False


def test_stdio_loop_survives_a_parse_error(server):
    stdin = io.StringIO("{not json\n" + json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}) + "\n")
    stdout = io.StringIO()
    server.serve_stdio(stdin=stdin, stdout=stdout)
    lines = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
    assert lines[0]["error"]["code"] == -32700
    assert lines[1]["result"] == {}


# ---------------------------------------------------------------- handlers


def test_list_mcp_servers_reports_state(server):
    response = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "list_mcp_servers", "arguments": {}},
        }
    )
    payload = json.loads(response["result"]["content"][0]["text"])
    assert isinstance(payload, list)


def test_list_mcp_tools_respects_the_capability_filter(server):
    response = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "list_mcp_tools", "arguments": {"capabilities": ["read"]}},
        }
    )
    payload = json.loads(response["result"]["content"][0]["text"])
    assert isinstance(payload, list)


def test_recent_tool_calls_is_readable(server):
    response = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "recent_tool_calls", "arguments": {"limit": 5}},
        }
    )
    assert response["result"]["isError"] is False


def test_build_tools_returns_exposed_tool_objects(container):
    tools = build_tools(container)
    assert all(tool.read_only for tool in tools)
    assert all(callable(tool.handler) for tool in tools)
