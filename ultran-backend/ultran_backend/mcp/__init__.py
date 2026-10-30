"""MCP connector runtime.

The v2 architecture replaces 74 hand-written connector manifests with one
protocol. This package is that protocol, in the shape the spec's module contract
asks for:

    core/mcp | Connections, tool index, schema validation
             | list_tools(caps) -> list[ToolSpec]
             | invoke(tool, args, grant) -> ToolResult
             | A tool is never invoked without a valid grant

Layout:

``protocol``    ToolSpec, CallResult, trust levels, manifest hashing
``annotations`` capability derivation from MCP annotations and tool names
``schema``      inputSchema soundness + argument validation
``egress``      network-layer allow-list, budgets, request log
``transports``  stdio and Streamable HTTP, behind one SDK shim
``pool``        live sessions, the tool index, health, pinning
``grants``      signed capability grants and the approval gate
``gateway``     the pre-flight chain and the two-stage tool filter
``server``      Ultran *as* an MCP server (read-only, for Claude Desktop)

Nothing above ``transports`` imports the MCP SDK, so a spec change is contained.
"""

from .annotations import CAPABILITIES, ToolAnnotations
from .egress import EgressPolicy, EgressRequest, parse_url
from .errors import (
    ApprovalPending,
    EgressDenied,
    GrantRequired,
    McpProtocolError,
    McpTimeout,
    McpUnavailable,
    SchemaInvalid,
    TrustViolation,
)
from .gateway import InvokeOutcome, ToolGateway
from .grants import Approval, ApprovalGate, Grant, GrantStore
from .pool import Connection, McpClientPool
from .protocol import (
    CallResult,
    ServerInfo,
    ToolSpec,
    manifest_hash,
    normalise_result,
)
from .schema import is_valid_tool_schema, validate_arguments
from .server import UltranMcpServer, build_server
from .transports import ServerSpec, sdk_available, sdk_version

__all__ = [
    "CAPABILITIES",
    "Approval",
    "ApprovalGate",
    "ApprovalPending",
    "CallResult",
    "Connection",
    "EgressDenied",
    "EgressPolicy",
    "EgressRequest",
    "Grant",
    "GrantRequired",
    "GrantStore",
    "InvokeOutcome",
    "McpClientPool",
    "McpProtocolError",
    "McpTimeout",
    "McpUnavailable",
    "SchemaInvalid",
    "ServerInfo",
    "ServerSpec",
    "ToolAnnotations",
    "ToolGateway",
    "ToolSpec",
    "TrustViolation",
    "UltranMcpServer",
    "build_server",
    "is_valid_tool_schema",
    "manifest_hash",
    "normalise_result",
    "parse_url",
    "sdk_available",
    "sdk_version",
    "validate_arguments",
]
