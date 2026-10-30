"""Errors raised by the MCP connector runtime.

Every error subclasses :class:`ultran_backend.errors.UltranError`, so the HTTP
layer maps it onto the existing error envelope without any special casing. The
codes below are the ones the v2 architecture spec adds to that envelope:

``mcp_unavailable`` · ``mcp_protocol_error`` · ``grant_required`` ·
``approval_pending`` · ``egress_denied`` · ``schema_invalid`` ·
``trust_violation``
"""

from __future__ import annotations

from typing import Any

from ..errors import Conflict, Forbidden, UltranError, ValidationFailed


class McpUnavailable(UltranError):
    """The MCP server could not be reached, or the stream closed mid-call."""

    status_code = 503
    code = "mcp_unavailable"


class McpTimeout(McpUnavailable):
    """The server accepted the request but did not answer inside the timeout."""

    code = "mcp_unavailable"


class McpProtocolError(UltranError):
    """The peer spoke something that is not valid MCP / JSON-RPC 2.0."""

    status_code = 502
    code = "mcp_protocol_error"

    def __init__(
        self,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        rpc_code: int | None = None,
        rpc_data: Any = None,
    ) -> None:
        payload = dict(details or {})
        if rpc_code is not None:
            payload["rpc_code"] = rpc_code
        if rpc_data is not None:
            payload["rpc_data"] = rpc_data
        super().__init__(message, details=payload)
        self.rpc_code = rpc_code


class GrantRequired(Forbidden):
    """No valid capability grant covers this tool."""

    code = "grant_required"


class ApprovalPending(Conflict):
    """The tool is sensitive; the run is suspended until a human decides."""

    code = "approval_pending"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, details=details)


class EgressDenied(Forbidden):
    """The destination is not on the egress allow-list."""

    code = "egress_denied"


class SchemaInvalid(ValidationFailed):
    """Arguments do not satisfy the tool's declared ``inputSchema``."""

    code = "schema_invalid"


class TrustViolation(Forbidden):
    """The server's tool manifest drifted from the pinned hash."""

    code = "trust_violation"


__all__ = [
    "ApprovalPending",
    "EgressDenied",
    "GrantRequired",
    "McpProtocolError",
    "McpTimeout",
    "McpUnavailable",
    "SchemaInvalid",
    "TrustViolation",
]
