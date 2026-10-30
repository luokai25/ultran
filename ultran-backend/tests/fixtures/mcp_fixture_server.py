"""A real MCP server, used as a test fixture.

This is not a mock: it is an actual MCP server process speaking JSON-RPC over
stdio, built on the official SDK. Tests spawn it, handshake it, list its tools
and call them, which is the only way to prove the transport layer works.

It deliberately exposes a spread of shapes so the annotation and schema layers
are exercised for real:

* ``read_file``   - ``readOnlyHint``, one required string
* ``write_file``  - no hints, so capabilities come from the name
* ``delete_path`` - destructive, must trip the approval gate
* ``fetch_url``   - takes a URL, so the egress allow-list applies
* ``echo``        - no annotations at all, the "server said nothing" case
* ``slow``        - sleeps, for the timeout path
* ``boom``        - always raises, for the error path
"""

from __future__ import annotations

import asyncio
import sys
import time

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

server = MCPServer("fixture")


@server.tool(
    name="read_file",
    description="Read a text file from the sandbox filesystem.",
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
def read_file(path: str) -> str:
    """Read a file and return its contents."""
    return f"contents of {path}"


@server.tool(name="write_file", description="Write text to a file.")
def write_file(path: str, content: str) -> str:
    """Write content to a path."""
    return f"wrote {len(content)} bytes to {path}"


@server.tool(
    name="delete_path",
    description="Delete a file or directory.",
    annotations=ToolAnnotations(destructiveHint=True),
)
def delete_path(path: str) -> str:
    """Delete a path."""
    return f"deleted {path}"


@server.tool(
    name="fetch_url",
    description="Fetch a URL and return the body.",
    annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True),
)
def fetch_url(url: str) -> str:
    """Fetch a URL."""
    return f"fetched {url}"


@server.tool(name="echo", description="Echo the input back.")
def echo(text: str) -> str:
    """Echo text."""
    return text


@server.tool(name="slow", description="Sleep for a while, then answer.")
def slow(seconds: float = 5.0) -> str:
    """Sleep."""
    time.sleep(float(seconds))
    return "done"


@server.tool(name="boom", description="Always fails.")
def boom() -> str:
    """Raise."""
    raise RuntimeError("intentional failure")


if __name__ == "__main__":
    asyncio.run(server.run_stdio_async())
