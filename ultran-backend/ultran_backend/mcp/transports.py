"""Transports: stdio and Streamable HTTP, plus the SDK compatibility shim.

The v2 spec accepts the risk of MCP spec churn and mitigates it the same way for
every external dependency: *pin the SDK and wrap it behind one module*. This is
that module. It resolves the SDK's names once, so a 1.x/2.x rename
(``fastmcp`` -> ``MCPServer``, ``streamablehttp_client`` ->
``streamable_http_client``) is a two-line change here instead of a repo-wide
migration.

Nothing above this file imports ``mcp``.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .errors import McpProtocolError, McpUnavailable

# --------------------------------------------------------------------------- #
# SDK surface
# --------------------------------------------------------------------------- #

try:  # pragma: no cover - the happy path in every environment we ship to
    from mcp import ClientSession as _ClientSession
    from mcp import StdioServerParameters as _StdioServerParameters
    from mcp.client.stdio import stdio_client as _stdio_client
    from mcp.client.streamable_http import streamable_http_client as _http_client

    SDK_AVAILABLE = True
except Exception:  # noqa: BLE001 - absent SDK is a reported, degraded state
    _ClientSession = None  # type: ignore[assignment]
    _StdioServerParameters = None  # type: ignore[assignment]
    _stdio_client = None  # type: ignore[assignment]
    _http_client = None  # type: ignore[assignment]
    SDK_AVAILABLE = False

SDK_NAME = "mcp"
SDK_MIN_VERSION = "1.2"


def sdk_available() -> bool:
    return SDK_AVAILABLE


def sdk_version() -> str:
    if not SDK_AVAILABLE:  # pragma: no cover - environment probe
        return ""
    try:
        import importlib.metadata as md

        return md.version(SDK_NAME)
    except Exception:  # noqa: BLE001
        return ""


def _require_sdk() -> None:
    if not SDK_AVAILABLE:
        raise McpUnavailable(
            "the MCP SDK is not installed",
            details={"install": f"pip install '{SDK_NAME}>={SDK_MIN_VERSION}'"},
        )


# --------------------------------------------------------------------------- #
# Server spec
# --------------------------------------------------------------------------- #

TRANSPORTS: tuple[str, ...] = ("stdio", "http")
#: Env vars a stdio child is allowed to inherit. Everything else is dropped:
#: "no ambient credentials" (spec, tier-3 isolation).
SAFE_ENV = (
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TZ",
    "PYTHONPATH",
    "PYTHONUNBUFFERED",
    "NODE_PATH",
    "SYSTEMROOT",
    "APPDATA",
    "USERPROFILE",
)


@dataclass(frozen=True)
class ServerSpec:
    """A registered MCP server, as configuration - not a live connection."""

    id: str
    name: str = ""
    transport: str = "stdio"
    # stdio
    command: str = ""
    args: tuple[str, ...] = ()
    env: Mapping[str, str] = field(default_factory=dict)
    cwd: str | None = None
    # http
    url: str = ""
    headers: Mapping[str, str] = field(default_factory=dict)
    # policy
    trust_level: str = "third_party"
    pinned_hash: str = ""
    enabled: bool = True
    timeout_s: float = 30.0
    connect_timeout_s: float = 10.0
    egress: Mapping[str, Any] = field(default_factory=dict)
    capabilities: tuple[str, ...] = ()
    description: str = ""

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("server id is required")
        if self.transport not in TRANSPORTS:
            raise ValueError(
                f"transport must be one of {list(TRANSPORTS)}, got {self.transport!r}"
            )
        if self.transport == "stdio" and not self.command:
            raise ValueError("a stdio server needs a command")
        if self.transport == "http" and not self.url:
            raise ValueError("an http server needs a url")
        if self.timeout_s <= 0 or self.connect_timeout_s <= 0:
            raise ValueError("timeouts must be positive")

    @property
    def label(self) -> str:
        return self.name or self.id

    def redacted(self) -> dict[str, Any]:
        """Configuration safe to log or return over HTTP."""
        env_keys = sorted(self.env)
        header_keys = sorted(self.headers)
        return {
            "id": self.id,
            "name": self.label,
            "transport": self.transport,
            "command": self.command if self.transport == "stdio" else "",
            "args": list(self.args) if self.transport == "stdio" else [],
            "env_keys": env_keys,
            "cwd": self.cwd,
            "url": self.url,
            "header_keys": header_keys,
            "trust_level": self.trust_level,
            "pinned_hash": self.pinned_hash,
            "enabled": self.enabled,
            "timeout_s": self.timeout_s,
            "capabilities": list(self.capabilities),
            "description": self.description,
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> ServerSpec:
        data = dict(payload)
        args = data.get("args") or ()
        if isinstance(args, str):
            args = (args,)
        return cls(
            id=str(data["id"]),
            name=str(data.get("name") or data["id"]),
            transport=str(data.get("transport") or "stdio"),
            command=str(data.get("command") or ""),
            args=tuple(str(a) for a in args),
            env={str(k): str(v) for k, v in (data.get("env") or {}).items()},
            cwd=data.get("cwd"),
            url=str(data.get("url") or ""),
            headers={str(k): str(v) for k, v in (data.get("headers") or {}).items()},
            trust_level=str(data.get("trust_level") or "third_party"),
            pinned_hash=str(data.get("pinned_hash") or ""),
            enabled=bool(data.get("enabled", True)),
            timeout_s=float(data.get("timeout_s", 30.0)),
            connect_timeout_s=float(data.get("connect_timeout_s", 10.0)),
            egress=dict(data.get("egress") or {}),
            capabilities=tuple(str(c) for c in (data.get("capabilities") or ())),
            description=str(data.get("description") or ""),
        )


def child_env(spec: ServerSpec, *, base: Mapping[str, str] | None = None) -> dict[str, str]:
    """The environment a stdio child gets: the safe allow-list plus its own vars."""
    source = os.environ if base is None else base
    env = {key: source[key] for key in SAFE_ENV if key in source}
    env.update({str(k): str(v) for k, v in spec.env.items()})
    env.setdefault("PYTHONUNBUFFERED", "1")
    return env


# --------------------------------------------------------------------------- #
# Live sessions
# --------------------------------------------------------------------------- #


class McpSession:
    """A connected SDK session with the ~3 calls the runtime needs."""

    def __init__(self, session: Any, spec: ServerSpec) -> None:
        self._session = session
        self.spec = spec
        self.closed = False
        #: The raw ``initialize`` result, kept so the pool can report server info.
        self.info: Any = None

    async def initialize(self) -> Any:
        self.info = await self._session.initialize()
        return self.info

    async def list_tools(self) -> list[Any]:
        """Drain every page of ``tools/list``."""
        tools: list[Any] = []
        cursor = None
        while True:
            params = None
            if cursor is not None:
                params = _paginated_params(cursor)
            result = (
                await self._session.list_tools(params=params)
                if params is not None
                else await self._session.list_tools()
            )
            tools.extend(list(getattr(result, "tools", []) or []))
            cursor = getattr(result, "nextCursor", None) or getattr(result, "next_cursor", None)
            if not cursor:
                break
        return tools

    async def call_tool(self, name: str, arguments: Mapping[str, Any] | None) -> Any:
        return await self._session.call_tool(name, dict(arguments or {}))


def _paginated_params(cursor: str) -> Any:
    try:  # pragma: no cover - depends on SDK version
        from mcp import types

        return types.PaginatedRequestParams(cursor=cursor)
    except Exception:  # noqa: BLE001
        return {"cursor": cursor}


class StdioTransport:
    """Spawns a child process and speaks MCP over its stdin/stdout."""

    kind = "stdio"

    def __init__(self, spec: ServerSpec) -> None:
        self.spec = spec

    def open(self) -> Any:
        """Return an async context manager yielding a live :class:`McpSession`."""
        _require_sdk()
        params = _StdioServerParameters(
            command=self.spec.command,
            args=list(self.spec.args),
            env=child_env(self.spec),
            cwd=self.spec.cwd,
        )
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _open():
            try:
                async with (
                    _stdio_client(params) as (read, write),
                    _ClientSession(
                        read, write, read_timeout_seconds=self.spec.timeout_s
                    ) as session,
                ):
                    live = McpSession(session, self.spec)
                    await live.initialize()
                    yield live
            except McpUnavailable:
                raise
            except FileNotFoundError as exc:
                raise McpUnavailable(
                    "MCP server command not found",
                    details={"server": self.spec.id, "command": self.spec.command, "error": str(exc)},
                ) from exc
            except Exception as exc:
                raise McpUnavailable(
                    f"MCP stdio session failed: {type(exc).__name__}: {exc}",
                    details={"server": self.spec.id, "transport": "stdio"},
                ) from exc

        return _open()


class HttpTransport:
    """Streamable HTTP: one endpoint, POST for requests, SSE for streams."""

    kind = "http"

    def __init__(self, spec: ServerSpec) -> None:
        self.spec = spec

    def open(self) -> Any:
        """Return an async context manager yielding a live :class:`McpSession`."""
        _require_sdk()
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _open():
            try:
                async with _http_client(
                    self.spec.url, http_client=_http_client_with_headers(self.spec)
                ) as streams:
                    read, write = _split_http_streams(streams)
                    async with _ClientSession(read, write, read_timeout_seconds=self.spec.timeout_s) as session:
                        live = McpSession(session, self.spec)
                        await live.initialize()
                        yield live
            except McpUnavailable:
                raise
            except Exception as exc:
                raise McpUnavailable(
                    f"MCP http session failed: {type(exc).__name__}: {exc}",
                    details={"server": self.spec.id, "transport": "http", "url": self.spec.url},
                ) from exc

        return _open()


def _http_client_with_headers(spec: ServerSpec) -> Any:
    """Build the ``httpx2`` client the SDK wants, carrying our headers.

    The SDK's ``streamable_http_client`` takes no ``headers`` argument - auth and
    custom headers go on a pre-configured client. Returning ``None`` when there
    are no headers lets the SDK use its own recommended timeouts.
    """
    if not spec.headers:
        return None
    try:
        import httpx2
    except ImportError:  # pragma: no cover - httpx2 ships with the SDK
        return None
    return httpx2.AsyncClient(
        headers=dict(spec.headers),
        timeout=httpx2.Timeout(spec.timeout_s, read=spec.timeout_s),
        follow_redirects=False,
    )


def _split_http_streams(streams: Any) -> tuple[Any, Any]:
    """Streamable HTTP yields ``(read, write)`` or ``(read, write, get_session_id)``."""
    if isinstance(streams, tuple):
        if len(streams) >= 2:
            return streams[0], streams[1]
        raise McpProtocolError("streamable HTTP transport returned an incomplete stream pair")
    return streams.read_stream, streams.write_stream


def transport_for(spec: ServerSpec) -> StdioTransport | HttpTransport:
    return StdioTransport(spec) if spec.transport == "stdio" else HttpTransport(spec)


__all__ = [
    "SAFE_ENV",
    "SDK_AVAILABLE",
    "SDK_MIN_VERSION",
    "TRANSPORTS",
    "HttpTransport",
    "McpSession",
    "ServerSpec",
    "StdioTransport",
    "child_env",
    "sdk_available",
    "sdk_version",
    "transport_for",
]
