"""The MCP client pool: live connections, the tool index, health.

Why a thread and not ``asyncio.run`` per call: an MCP session is a *stateful*
stream. Opening one costs a process spawn (~300 ms for a Node server) plus an
``initialize`` round trip, and closing it between calls would throw away
``tools/list`` cursors and any server-side state. So the pool owns one background
event loop for the whole process and every session lives on it. Callers - which
are ordinary synchronous FastAPI handlers - submit coroutines to that loop via
``run_coroutine_threadsafe`` and block on the future with a deadline.

Failure isolation is the other half of the job:

* a connection that dies is marked ``failed`` and its tools leave the index, so
  the planner stops seeing tools it cannot call;
* one broken server never takes the pool down - every operation is wrapped;
* ``pinned_hash`` is enforced here, at the trust boundary: if the server's tool
  manifest no longer hashes to the pinned value, its tools are quarantined rather
  than silently trusted.
"""

from __future__ import annotations

import asyncio
import atexit
import logging
import threading
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..errors import NotFound, ValidationFailed
from .annotations import capability_filter
from .egress import EgressPolicy, policy_from_config
from .errors import McpTimeout, McpUnavailable, TrustViolation
from .protocol import (
    CallResult,
    ServerInfo,
    ToolSpec,
    manifest_hash,
    normalise_result,
    sha256_of,
    utcnow,
)
from .transports import (
    McpSession,
    ServerSpec,
    sdk_available,
    sdk_version,
    transport_for,
)

log = logging.getLogger("ultran.mcp.pool")

CONNECTION_STATES = ("disconnected", "connecting", "ready", "failed", "quarantined")


@dataclass
class Connection:
    """One server's live state."""

    spec: ServerSpec
    state: str = "disconnected"
    session: McpSession | None = None
    info: ServerInfo = field(default_factory=ServerInfo)
    tools: list[ToolSpec] = field(default_factory=list)
    manifest_hash: str = ""
    last_error: str = ""
    last_seen: datetime | None = None
    connects: int = 0
    failures: int = 0
    tool_calls: int = 0
    egress: EgressPolicy = field(default_factory=EgressPolicy)
    #: The transport's async context manager, kept open for the session's life.
    ctx: Any = None

    @property
    def id(self) -> str:
        return self.spec.id

    @property
    def ready(self) -> bool:
        return self.state == "ready"

    def status(self) -> dict[str, Any]:
        return {
            "id": self.spec.id,
            "name": self.spec.label,
            "transport": self.spec.transport,
            "state": self.state,
            "ready": self.ready,
            "trust_level": self.spec.trust_level,
            "pinned_hash": self.spec.pinned_hash,
            "manifest_hash": self.manifest_hash,
            "server": self.info.as_dict(),
            "tools": len(self.tools),
            "last_error": self.last_error,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
            "connects": self.connects,
            "failures": self.failures,
            "tool_calls": self.tool_calls,
        }


class _LoopThread:
    """One event loop for the process, started lazily and stopped at exit."""

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def loop(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if self._loop is not None and self._loop.is_running():
                return self._loop
            ready = threading.Event()

            def runner() -> None:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                self._loop = loop
                ready.set()
                loop.run_forever()

            thread = threading.Thread(target=runner, name="ultran-mcp-loop", daemon=True)
            thread.start()
            ready.wait(timeout=5.0)
            self._thread = thread
            assert self._loop is not None
            return self._loop

    def run(self, coro: Any, timeout: float) -> Any:
        loop = self.loop()
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        try:
            return future.result(timeout=timeout)
        except TimeoutError as exc:
            future.cancel()
            raise McpTimeout(f"MCP call exceeded {timeout:.1f}s") from exc

    def shutdown(self) -> None:
        with self._lock:
            if self._loop is None:
                return
            loop = self._loop
            if loop.is_running():
                loop.call_soon_threadsafe(loop.stop)
            self._loop = None


_DEFAULT_LOOP = _LoopThread()
atexit.register(_DEFAULT_LOOP.shutdown)


class McpClientPool:
    """Registry of MCP servers plus their live sessions and aggregate tool index."""

    def __init__(
        self,
        servers: Iterable[ServerSpec] = (),
        *,
        loop: _LoopThread | None = None,
        auto_connect: bool = False,
    ) -> None:
        self._servers: dict[str, ServerSpec] = {}
        self._connections: dict[str, Connection] = {}
        self._loop = loop or _DEFAULT_LOOP
        self._lock = threading.RLock()
        self._connect_factory: Callable[[ServerSpec], Any] = transport_for
        for spec in servers:
            self.register(spec, replace=False)
        if auto_connect:
            for spec in list(self._servers.values()):
                if spec.enabled:
                    self.connect(spec.id, raise_on_error=False)

    # ------------------------------------------------------------------ #
    # registration
    # ------------------------------------------------------------------ #
    def register(self, spec: ServerSpec, *, replace: bool = False, connect: bool = False) -> ServerSpec:
        with self._lock:
            if spec.id in self._servers and not replace:
                raise ValidationFailed(
                    "MCP server already registered", details={"server_id": spec.id}
                )
            self._servers[spec.id] = spec
            existing = self._connections.get(spec.id)
            if existing is not None and existing.session is not None:
                self._close_quietly(existing)
            self._connections[spec.id] = Connection(
                spec=spec, egress=policy_from_config(spec.egress)
            )
        if connect and spec.enabled:
            self.connect(spec.id, raise_on_error=False)
        return spec

    def unregister(self, server_id: str) -> None:
        with self._lock:
            if server_id not in self._servers:
                raise NotFound("MCP server not found", details={"server_id": server_id})
            conn = self._connections.get(server_id)
            if conn is not None:
                self._close_quietly(conn)
            del self._servers[server_id]
            self._connections.pop(server_id, None)

    def get(self, server_id: str) -> ServerSpec:
        try:
            return self._servers[server_id]
        except KeyError:
            raise NotFound("MCP server not found", details={"server_id": server_id}) from None

    def connection(self, server_id: str) -> Connection:
        with self._lock:
            if server_id not in self._connections:
                self.get(server_id)
                self._connections[server_id] = Connection(
                    spec=self._servers[server_id],
                    egress=policy_from_config(self._servers[server_id].egress),
                )
            return self._connections[server_id]

    def __len__(self) -> int:
        return len(self._servers)

    def __contains__(self, server_id: object) -> bool:
        return server_id in self._servers

    def servers(self) -> list[ServerSpec]:
        return sorted(self._servers.values(), key=lambda s: s.id)

    # ------------------------------------------------------------------ #
    # connection lifecycle
    # ------------------------------------------------------------------ #
    def connect(self, server_id: str, *, raise_on_error: bool = True) -> Connection:
        """Open a session and refresh the tool index. Idempotent when ready."""
        conn = self.connection(server_id)
        if conn.ready and conn.session is not None:
            return conn

        conn.state = "connecting"
        try:
            info, tools = self._handshake(conn)
        except Exception as exc:
            conn.state = "failed"
            conn.failures += 1
            conn.last_error = f"{type(exc).__name__}: {exc}"
            conn.session = None
            conn.tools = []
            log.warning("mcp server %s failed to connect: %s", server_id, conn.last_error)
            if raise_on_error:
                if isinstance(exc, McpUnavailable):
                    raise
                raise McpUnavailable(
                    f"could not connect to MCP server {server_id!r}: {exc}",
                    details={"server_id": server_id},
                ) from exc
            return conn

        conn.info = info
        conn.tools = tools
        conn.manifest_hash = manifest_hash(tools)
        conn.last_seen = utcnow()
        conn.connects += 1
        conn.last_error = ""

        pinned = conn.spec.pinned_hash.strip()
        if pinned and not _hash_matches(pinned, conn.manifest_hash):
            # The spec's mitigation for a server that changes behind our back.
            conn.state = "quarantined"
            conn.last_error = (
                "tool manifest does not match the pinned hash; refusing to expose its tools"
            )
            conn.tools = []
            log.error("mcp server %s quarantined: %s", server_id, conn.last_error)
            if raise_on_error:
                raise TrustViolation(
                    conn.last_error,
                    details={
                        "server_id": server_id,
                        "pinned_hash": pinned,
                        "actual_hash": conn.manifest_hash,
                    },
                )
            return conn

        conn.state = "ready"
        return conn

    def disconnect(self, server_id: str) -> None:
        conn = self.connection(server_id)
        self._close_quietly(conn)
        conn.state = "disconnected"
        conn.tools = []
        conn.session = None

    def probe(self, server_id: str) -> dict[str, Any]:
        """Re-handshake and refresh the tool list (the ``/probe`` endpoint)."""
        conn = self.connection(server_id)
        self._close_quietly(conn)
        conn.session = None
        conn = self.connect(server_id, raise_on_error=False)
        return {
            **conn.status(),
            "tools": [spec.as_dict() for spec in conn.tools],
        }

    def close(self) -> None:
        with self._lock:
            for conn in self._connections.values():
                self._close_quietly(conn)
                conn.state = "disconnected"
                conn.session = None
                conn.tools = []

    def _close_quietly(self, conn: Connection) -> None:
        ctx = conn.ctx
        conn.ctx = None
        conn.session = None
        if ctx is None:
            return
        try:
            self._loop.run(ctx.__aexit__(None, None, None), timeout=5.0)
        except Exception as exc:  # noqa: BLE001 - shutdown must never raise
            log.debug("error closing MCP session for %s: %s", conn.spec.id, exc)

    # ------------------------------------------------------------------ #
    # handshake
    # ------------------------------------------------------------------ #
    def _handshake(self, conn: Connection) -> tuple[ServerInfo, list[ToolSpec]]:
        spec = conn.spec
        timeout = spec.connect_timeout_s + spec.timeout_s
        result = self._loop.run(self._open_and_list(conn), timeout=timeout)
        return result

    async def _open_and_list(self, conn: Connection) -> tuple[ServerInfo, list[ToolSpec]]:
        """Open, initialise, list tools - and keep the session open afterwards.

        The SDK's transports are context managers, so we enter them manually and
        keep the exit callbacks to run when the connection closes. That is what
        makes the session persist across tool calls.
        """
        transport = self._connect_factory(conn.spec)
        ctx = transport.open()
        session = await ctx.__aenter__()
        try:
            raw_info = getattr(session, "info", None)
            info = ServerInfo.from_wire(raw_info) if raw_info else ServerInfo()
            raw_tools = await session.list_tools()
            specs = []
            for raw in raw_tools:
                try:
                    specs.append(ToolSpec.from_wire(conn.spec.id, raw))
                except ValueError as exc:
                    log.warning("skipping tool on %s: %s", conn.spec.id, exc)
            session._ultran_ctx = ctx  # keep the exit callback for ::close
            conn.session = session
            conn.ctx = ctx
            return info, specs
        except Exception:
            try:
                await ctx.__aexit__(None, None, None)
            except Exception as exc:  # noqa: BLE001 - already failing
                log.debug("error unwinding failed handshake for %s: %s", conn.spec.id, exc)
            raise

    async def _call(self, conn: Connection, name: str, arguments: Mapping[str, Any]) -> Any:
        session = conn.session
        if session is None:
            raise McpUnavailable(
                "server is not connected", details={"server_id": conn.spec.id}
            )
        return await session.call_tool(name, arguments)

    # ------------------------------------------------------------------ #
    # tool index
    # ------------------------------------------------------------------ #
    def list_tools(
        self,
        capabilities: Iterable[str] | None = None,
        *,
        server_ids: Iterable[str] | None = None,
        ready_only: bool = True,
        trust_min: str | None = None,
    ) -> list[ToolSpec]:
        """The capability-filtered tool index (``list_tools(caps)``).

        ``capabilities`` is the *granted* set: a tool is returned only when every
        capability it needs is granted. ``None`` means "no filter", which is what
        the admin UI uses to show what a server offers; the gateway always passes
        a real set.
        """
        allowed = capability_filter(capabilities)
        wanted = set(server_ids) if server_ids is not None else None
        from .protocol import at_least

        rows: list[ToolSpec] = []
        for conn in self._connections.values():
            if ready_only and not conn.ready:
                continue
            if wanted is not None and conn.spec.id not in wanted:
                continue
            if not conn.spec.enabled:
                continue
            if trust_min and not at_least(conn.spec.trust_level, trust_min):
                continue
            for spec in conn.tools:
                if allowed is None or spec.capabilities.issubset(allowed):
                    rows.append(spec)
        rows.sort(key=lambda s: (s.server_id, s.name))
        return rows

    def find_tool(self, tool_id: str, *, ready_only: bool = True) -> ToolSpec:
        """Resolve ``server.tool`` or, for a unique tool name, ``tool``."""
        if not tool_id:
            raise ValidationFailed("tool id is required")
        server_id, _, name = tool_id.partition(".")
        if name:
            conn = self.connection(server_id)
            for spec in conn.tools:
                if spec.name == name:
                    return spec
            raise NotFound(
                "MCP tool not found", details={"tool": tool_id, "server_id": server_id}
            )
        matches = [s for s in self.list_tools(ready_only=ready_only) if s.name == tool_id]
        if not matches:
            raise NotFound("MCP tool not found", details={"tool": tool_id})
        if len(matches) > 1:
            raise ValidationFailed(
                "tool name is ambiguous; use server.tool",
                details={"tool": tool_id, "candidates": [s.id for s in matches]},
            )
        return matches[0]

    # ------------------------------------------------------------------ #
    # invocation
    # ------------------------------------------------------------------ #
    def call_tool(
        self,
        tool: str,
        arguments: Mapping[str, Any] | None = None,
        *,
        timeout_s: float | None = None,
    ) -> CallResult:
        """Call a tool by ``server.tool`` (or unique name). Transport only.

        Policy - grants, approvals, egress, budgets - lives in the gateway. This
        method is deliberately mechanical so it can also serve the MCP *server*
        mode, where the caller is Claude Desktop and the policy is read-only.
        """
        spec = self.find_tool(tool)
        conn = self.connection(spec.server_id)
        if not conn.ready or conn.session is None:
            raise McpUnavailable(
                "server is not ready", details={"server_id": spec.server_id, "state": conn.state}
            )
        args = dict(arguments or {})
        timeout = float(timeout_s or conn.spec.timeout_s)
        started = time.perf_counter()
        args_hash = sha256_of(args)
        try:
            raw = self._loop.run(self._call(conn, spec.name, args), timeout=timeout)
        except McpTimeout:
            conn.failures += 1
            conn.last_error = f"timeout after {timeout:.1f}s"
            raise
        except McpUnavailable as exc:
            # A dead stream invalidates the connection: mark it and drop its tools
            # so the planner stops selecting them.
            conn.state = "failed"
            conn.failures += 1
            conn.last_error = str(exc)
            conn.tools = []
            raise McpUnavailable(
                f"MCP call to {spec.id!r} failed: {exc.message}",
                details={"server_id": spec.server_id, "tool": spec.name},
            ) from exc
        except Exception as exc:
            conn.failures += 1
            conn.last_error = f"{type(exc).__name__}: {exc}"
            raise McpUnavailable(
                f"MCP call to {spec.id!r} failed: {exc}",
                details={"server_id": spec.server_id, "tool": spec.name},
            ) from exc

        latency = int((time.perf_counter() - started) * 1000)
        conn.tool_calls += 1
        conn.last_seen = utcnow()
        return normalise_result(
            spec.name, spec.server_id, raw, latency_ms=latency, args_hash=args_hash
        )

    # ------------------------------------------------------------------ #
    # diagnostics
    # ------------------------------------------------------------------ #
    def stats(self) -> dict[str, Any]:
        conns = list(self._connections.values())
        ready = [c for c in conns if c.ready]
        return {
            "sdk_available": sdk_available(),
            "sdk_version": sdk_version(),
            "servers": len(self._servers),
            "connected": len(ready),
            "failed": sum(1 for c in conns if c.state == "failed"),
            "quarantined": sum(1 for c in conns if c.state == "quarantined"),
            "tools": sum(len(c.tools) for c in ready),
            "tool_calls": sum(c.tool_calls for c in conns),
            "transports": sorted({c.spec.transport for c in conns}),
        }

    def status(self, server_id: str | None = None) -> dict[str, Any] | list[dict[str, Any]]:
        if server_id is not None:
            return self.connection(server_id).status()
        return [self.connection(s.id).status() for s in self.servers()]

    def health(self) -> dict[str, Any]:
        """Liveness for ``GET /v1/mcp/servers``."""
        return {
            "ok": all(c.ready or not c.spec.enabled for c in self._connections.values()),
            "servers": [
                {
                    "id": c.spec.id,
                    "state": c.state,
                    "tools": len(c.tools),
                    "last_error": c.last_error,
                }
                for c in self._connections.values()
            ],
            "stats": self.stats(),
        }


def _hash_matches(pinned: str, actual: str) -> bool:
    """Accept a full or a 16-char prefix pin, and a ``sha256:`` prefix."""
    pin = pinned.strip().lower()
    pin = pin.removeprefix("sha256:")
    return bool(pin) and (actual.lower() == pin or actual.lower().startswith(pin))


__all__ = [
    "CONNECTION_STATES",
    "Connection",
    "McpClientPool",
]
