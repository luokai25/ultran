"""Streamable HTTP transport, against a real HTTP MCP server.

The server is started in-process on an ephemeral port by the fixture, so this
test proves the HTTP path without depending on an external service. It is the
counterpart to ``test_mcp_runtime.py``, which covers stdio.
"""

from __future__ import annotations

import socket
import threading
import time

import pytest

from ultran_backend.mcp import McpClientPool, ServerSpec, ToolGateway
from ultran_backend.mcp.transports import sdk_available

pytestmark = pytest.mark.skipif(not sdk_available(), reason="MCP SDK not installed")

uvicorn = pytest.importorskip("uvicorn")


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def http_server():
    """A real Streamable HTTP MCP server on a free port."""
    from mcp.server.mcpserver import MCPServer
    from mcp.types import ToolAnnotations

    server = MCPServer("http-fixture")

    @server.tool(
        name="read_file",
        description="Read a file over HTTP.",
        annotations=ToolAnnotations(readOnlyHint=True),
    )
    def read_file(path: str) -> str:
        return f"http contents of {path}"

    @server.tool(name="write_file", description="Write a file over HTTP.")
    def write_file(path: str, content: str) -> str:
        return f"http wrote {len(content)} bytes to {path}"

    port = _free_port()
    app = server.streamable_http_app(stateless_http=True)
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    instance = uvicorn.Server(config)
    thread = threading.Thread(target=instance.run, daemon=True)
    thread.start()

    deadline = time.time() + 20
    while time.time() < deadline and not instance.started:
        time.sleep(0.05)
    if not instance.started:  # pragma: no cover - environment failure
        pytest.skip("HTTP MCP server did not start")

    yield f"http://127.0.0.1:{port}/mcp"

    instance.should_exit = True
    thread.join(timeout=10)


@pytest.fixture(scope="module")
def http_pool(http_server):
    pool = McpClientPool()
    pool.register(
        ServerSpec(
            id="httpdemo",
            transport="http",
            url=http_server,
            trust_level="local",
            timeout_s=20.0,
            connect_timeout_s=20.0,
        )
    )
    pool.connect("httpdemo")
    yield pool
    pool.close()


def test_http_pool_connects(http_pool):
    conn = http_pool.connection("httpdemo")
    assert conn.state == "ready", conn.last_error
    assert conn.spec.transport == "http"


def test_http_handshake_lists_tools(http_pool):
    names = {t.name for t in http_pool.connection("httpdemo").tools}
    assert {"read_file", "write_file"} <= names


def test_http_annotations_survive(http_pool):
    by_name = {t.name: t for t in http_pool.connection("httpdemo").tools}
    assert by_name["read_file"].capabilities == {"read"}
    assert by_name["write_file"].capabilities == {"write"}


def test_http_call_returns_text(http_pool):
    result = http_pool.call_tool("httpdemo.read_file", {"path": "/x"})
    assert result.ok
    assert "http contents of /x" in result.text


def test_http_gateway_enforces_grants(http_pool):
    gateway = ToolGateway(http_pool)
    grant = gateway.issue_grant("ws", "httpdemo.read_file")
    outcome = gateway.invoke(
        "httpdemo.read_file", {"path": "/x"}, workspace_id="ws", grant=grant
    )
    assert outcome.ok


def test_http_stats_report_the_transport(http_pool):
    assert "http" in http_pool.stats()["transports"]


def test_http_headers_are_sent(http_server):
    """A header-carrying client must still connect (the SDK takes a client)."""
    pool = McpClientPool()
    pool.register(
        ServerSpec(
            id="hdr",
            transport="http",
            url=http_server,
            headers={"X-Ultran-Test": "1"},
            trust_level="local",
            timeout_s=20.0,
            connect_timeout_s=20.0,
        )
    )
    conn = pool.connect("hdr", raise_on_error=False)
    assert conn.state == "ready", conn.last_error
    pool.close()
