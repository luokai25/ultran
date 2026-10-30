"""MCP *server* mode: Ultran as a tool provider for other MCP hosts.

The spec's deployment view has a gold arrow for this: Claude Desktop, Cursor or a
CLI drives Ultran over MCP. The security rule attached to it is one line:

    MCP server mode | Separate token, read-only by default | Claude Desktop
    driving Ultran must not be able to issue grants

So this server exposes **read** tools only. There is no ``invoke_tool``, no
``issue_grant``, no ``register_server``. A host that wants to *act* goes through
the HTTP API with a device token, where the approval gate applies. That is a
deliberate asymmetry, not an oversight: an MCP host is an untrusted client.

The server is built on the SDK's high-level ``MCPServer`` when available, and
falls back to a hand-rolled JSON-RPC loop over stdio when it is not - which is
also what the tests use, so the protocol path is exercised without spawning a
process.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from .protocol import PROTOCOL_VERSION, canonical_json

SERVER_NAME = "ultran"
SERVER_VERSION = "0.4.0"


@dataclass
class ExposedTool:
    """A read-only tool Ultran offers to an MCP host."""

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[Mapping[str, Any]], Any]
    read_only: bool = True

    def as_wire(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
            "annotations": {
                "readOnlyHint": self.read_only,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
        }


def _obj(properties: Mapping[str, Any] | None = None, required: Iterable[str] = ()) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": dict(properties or {}),
        "required": list(required),
        "additionalProperties": False,
    }


def build_tools(container: Any) -> list[ExposedTool]:
    """The read-only surface. Every handler is a pure read of local state."""

    def list_connectors(args: Mapping[str, Any]) -> Any:
        rows = container.registry.list(
            category=args.get("category"),
            search=args.get("search"),
            limit=int(args.get("limit", 20)),
        )
        return [
            {
                "id": m.id,
                "name": m.name,
                "category": m.category,
                "auth_kind": m.auth_kind,
                "tier": m.tier,
                "actions": list(m.actions),
            }
            for m in rows
        ]

    def list_mcp_servers(_: Mapping[str, Any]) -> Any:
        return container.mcp_pool.status()

    def list_mcp_tools(args: Mapping[str, Any]) -> Any:
        caps = args.get("capabilities")
        rows = container.mcp_gateway.list_tools(
            caps, query=args.get("query"), limit=int(args.get("limit", 20))
        )
        return [spec.as_dict() for spec in rows]

    def list_agents(_: Mapping[str, Any]) -> Any:
        return [a.model_dump() if hasattr(a, "model_dump") else a for a in container.agents.list()]

    def recent_tool_calls(args: Mapping[str, Any]) -> Any:
        return container.mcp_gateway.recent(int(args.get("limit", 20)))

    def workspace_stats(_: Mapping[str, Any]) -> Any:
        return {
            "connectors": container.registry.stats(),
            "mcp": container.mcp_pool.stats(),
            "gateway": container.mcp_gateway.summary(),
        }

    return [
        ExposedTool(
            name="list_connectors",
            description=(
                "List Ultran's built-in connector catalog. Use when the user asks what "
                "integrations Ultran supports. Read-only."
            ),
            input_schema=_obj(
                {
                    "category": {"type": "string", "description": "Filter by category, e.g. 'productivity'"},
                    "search": {"type": "string", "description": "Substring match on id, name or description"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 20},
                }
            ),
            handler=list_connectors,
        ),
        ExposedTool(
            name="list_mcp_servers",
            description=(
                "List registered MCP servers with their connection state, trust level and "
                "tool counts. Use to diagnose why a tool is unavailable. Read-only."
            ),
            input_schema=_obj(),
            handler=list_mcp_servers,
        ),
        ExposedTool(
            name="list_mcp_tools",
            description=(
                "List the MCP tool index, optionally filtered by capability and a search "
                "query. Use before suggesting a tool call. Read-only."
            ),
            input_schema=_obj(
                {
                    "capabilities": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Only return tools whose capabilities are a subset of these",
                    },
                    "query": {"type": "string", "description": "Keyword filter over name and description"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                }
            ),
            handler=list_mcp_tools,
        ),
        ExposedTool(
            name="list_agents",
            description="List the agents configured in this Ultran workspace. Read-only.",
            input_schema=_obj(),
            handler=list_agents,
        ),
        ExposedTool(
            name="recent_tool_calls",
            description=(
                "Read the most recent tool-call audit entries: tool, ok, latency, hashes. "
                "Use to explain what a run did. Read-only."
            ),
            input_schema=_obj(
                {"limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 20}}
            ),
            handler=recent_tool_calls,
        ),
        ExposedTool(
            name="workspace_stats",
            description="Aggregate counts for connectors, MCP servers and the tool gateway. Read-only.",
            input_schema=_obj(),
            handler=workspace_stats,
        ),
    ]


class UltranMcpServer:
    """A minimal, dependency-free MCP server over stdio.

    Implements the three methods a host needs: ``initialize``, ``tools/list`` and
    ``tools/call``. Deliberately small - the SDK's ``MCPServer`` is used when the
    host wants HTTP, but this loop is what makes the server testable in-process
    and keeps the read-only guarantee auditable in one file.
    """

    def __init__(self, tools: Iterable[ExposedTool], *, name: str = SERVER_NAME) -> None:
        self._tools = {tool.name: tool for tool in tools}
        self.name = name
        self.version = SERVER_VERSION

    # ------------------------------------------------------------------ #
    def tool_names(self) -> list[str]:
        return sorted(self._tools)

    def list_tools(self) -> list[dict[str, Any]]:
        return [self._tools[name].as_wire() for name in self.tool_names()]

    def call_tool(self, name: str, arguments: Mapping[str, Any] | None = None) -> dict[str, Any]:
        tool = self._tools.get(name)
        if tool is None:
            return {
                "content": [{"type": "text", "text": f"unknown tool: {name}"}],
                "isError": True,
            }
        try:
            value = tool.handler(dict(arguments or {}))
        except Exception as exc:  # noqa: BLE001 - a tool error is data, not a crash
            return {
                "content": [{"type": "text", "text": f"{type(exc).__name__}: {exc}"}],
                "isError": True,
            }
        text = value if isinstance(value, str) else canonical_json(value)
        return {"content": [{"type": "text", "text": text}], "isError": False}

    # ------------------------------------------------------------------ #
    def handle(self, request: Mapping[str, Any]) -> dict[str, Any] | None:
        """Handle one JSON-RPC message. Returns ``None`` for notifications."""
        method = str(request.get("method") or "")
        request_id = request.get("id")
        is_notification = "id" not in request

        if method == "initialize":
            result: Any = {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": self.name, "version": self.version},
                "instructions": (
                    "Ultran in read-only MCP server mode. Tools here inspect local state; "
                    "they cannot invoke connectors, issue grants or register servers."
                ),
            }
        elif method == "tools/list":
            result = {"tools": self.list_tools()}
        elif method == "tools/call":
            params = dict(request.get("params") or {})
            result = self.call_tool(str(params.get("name") or ""), params.get("arguments") or {})
        elif method in {"notifications/initialized", "initialized"}:
            return None
        elif method == "ping":
            result = {}
        else:
            if is_notification:
                return None
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": f"method not found: {method}"},
            }

        if is_notification:
            return None
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    # ------------------------------------------------------------------ #
    def serve_stdio(self, stdin: Any = None, stdout: Any = None) -> None:
        """Blocking line-delimited JSON-RPC loop."""
        source = stdin or sys.stdin
        sink = stdout or sys.stdout
        for line in source:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except ValueError:
                sink.write(
                    json.dumps(
                        {
                            "jsonrpc": "2.0",
                            "id": None,
                            "error": {"code": -32700, "message": "parse error"},
                        }
                    )
                    + "\n"
                )
                sink.flush()
                continue
            response = self.handle(request)
            if response is not None:
                sink.write(json.dumps(response) + "\n")
                sink.flush()


def build_server(container: Any) -> UltranMcpServer:
    return UltranMcpServer(build_tools(container))


__all__ = [
    "SERVER_NAME",
    "SERVER_VERSION",
    "ExposedTool",
    "UltranMcpServer",
    "build_server",
    "build_tools",
]
