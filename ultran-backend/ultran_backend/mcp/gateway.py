"""The tool gateway: ``list_tools(caps)`` and ``invoke(tool, args, grant)``.

This is the module the orchestrator talks to. It owns the pre-flight chain from
the spec, in the spec's order, and every check runs **before any side effect**:

    0a. grant valid?        signature, expiry, capability covers this tool
    0b. approval needed?    sensitive action => suspend, do not execute
    1.  tool exists + enabled for workspace
    2.  action declared by the tool spec
    3.  credential present (or auth_kind=none)   <- MCP servers carry their own
    4.  payload within budget (256 KB) and schema-valid
    5.  tier limits: cpu_ms, wall_ms, memory_mb, egress_bytes
    6.  execute -> audit append (args_hash, result_hash, latency, tier)

Step 3 is the one that changes shape under MCP: a stdio server gets its
credentials from its own environment, so the gateway's job is to *not* pass any -
"never passes a raw secret to a tool process". What it does instead is enforce
the egress allow-list, which is the control that actually bounds exfiltration.

The gateway also does the **two-stage filter** the spec's Fig 1 calls for: a
cheap capability/name prefilter over the whole index, then a keyword score over
the survivors, so a 200-tool index does not become a 200-tool prompt.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..errors import NotFound, ValidationFailed
from .egress import EgressPolicy, parse_url
from .errors import ApprovalPending, EgressDenied, GrantRequired, McpUnavailable
from .grants import ApprovalGate, Grant, GrantStore
from .pool import McpClientPool
from .protocol import CallResult, ToolSpec, sha256_of, utcnow
from .schema import validate_arguments

log = logging.getLogger("ultran.mcp.gateway")

MAX_PAYLOAD_BYTES = 256 * 1024
DEFAULT_WALL_MS = 30_000
DEFAULT_EGRESS_BYTES = 32 * 1024 * 1024

#: Argument keys whose values are URLs the tool will fetch. Checked against the
#: egress allow-list before the call, because a read-only tool with a URL
#: parameter is the exfiltration path the spec calls out.
URL_ARG_KEYS = ("url", "uri", "endpoint", "href", "target_url", "webhook", "callback_url")


@dataclass
class GatewayAuditEntry:
    """One line in the run log. Mirrors the ``tool_call`` table in the spec."""

    workspace_id: str
    tool: str
    server_id: str
    ok: bool
    reason: str
    latency_ms: int = 0
    tier: str = "remote-mcp"
    args_hash: str = ""
    result_hash: str = ""
    sensitive: bool = False
    capabilities: tuple[str, ...] = ()
    grant_id: str = ""
    at: datetime = field(default_factory=utcnow)

    def as_dict(self) -> dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "tool": self.tool,
            "server_id": self.server_id,
            "ok": self.ok,
            "reason": self.reason,
            "latency_ms": self.latency_ms,
            "tier": self.tier,
            "args_hash": self.args_hash,
            "result_hash": self.result_hash,
            "sensitive": self.sensitive,
            "capabilities": list(self.capabilities),
            "grant_id": self.grant_id,
            "at": self.at.isoformat(),
        }


@dataclass
class InvokeOutcome:
    """What ``invoke`` returns: the result plus the policy context around it."""

    result: CallResult
    tool: ToolSpec
    grant_id: str = ""
    approval_id: str = ""
    egress: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.result.ok and not self.result.is_error

    def as_dict(self) -> dict[str, Any]:
        return {
            **self.result.as_dict(),
            "tool_id": self.tool.id,
            "capabilities": sorted(self.tool.capabilities),
            "grant_id": self.grant_id,
            "approval_id": self.approval_id,
            "egress": self.egress,
        }


class ToolGateway:
    """Policy-enforcing front door to the MCP client pool."""

    def __init__(
        self,
        pool: McpClientPool,
        *,
        grants: GrantStore | None = None,
        approvals: ApprovalGate | None = None,
        max_payload_bytes: int = MAX_PAYLOAD_BYTES,
        wall_ms: int = DEFAULT_WALL_MS,
        egress_bytes: int = DEFAULT_EGRESS_BYTES,
        require_grants: bool = True,
    ) -> None:
        self.pool = pool
        self.grants = grants or GrantStore()
        self.approvals = approvals or ApprovalGate()
        self.max_payload_bytes = max_payload_bytes
        self.wall_ms = wall_ms
        self.egress_bytes = egress_bytes
        self.require_grants = require_grants
        self.audit: list[GatewayAuditEntry] = []

    # ------------------------------------------------------------------ #
    # discovery
    # ------------------------------------------------------------------ #
    def list_tools(
        self,
        capabilities: Iterable[str] | None = None,
        *,
        query: str | None = None,
        limit: int | None = None,
        server_ids: Iterable[str] | None = None,
        trust_min: str | None = None,
    ) -> list[ToolSpec]:
        """The capability-filtered tool index, optionally narrowed by a query.

        ``capabilities`` is the grant ceiling. Passing ``None`` means "everything
        this workspace can see" and is only appropriate for the admin UI.
        """
        rows = self.pool.list_tools(
            capabilities, server_ids=server_ids, trust_min=trust_min
        )
        if query:
            rows = self._rank(rows, query)
        if limit is not None:
            if limit < 0:
                raise ValidationFailed("limit must be >= 0")
            rows = rows[:limit]
        return rows

    def search_tools(
        self,
        query: str,
        capabilities: Iterable[str] | None = None,
        *,
        limit: int = 8,
    ) -> list[ToolSpec]:
        """Two-stage filter: capability prefilter, then keyword score."""
        return self.list_tools(capabilities, query=query, limit=limit)

    @staticmethod
    def _rank(rows: list[ToolSpec], query: str) -> list[ToolSpec]:
        terms = [t for t in re.split(r"[^a-z0-9]+", query.lower()) if len(t) > 1]
        if not terms:
            return rows

        def score(spec: ToolSpec) -> tuple[int, str]:
            name = spec.name.lower()
            desc = spec.description.lower()
            total = 0
            for term in terms:
                if term in name:
                    total += 10
                if term in desc:
                    total += 3
                if term in spec.server_id.lower():
                    total += 2
            return (-total, spec.id)

        scored = [(score(s), s) for s in rows]
        hits = [(sc, s) for sc, s in scored if sc[0] < 0]
        hits.sort(key=lambda pair: pair[0])
        return [s for _, s in hits]

    def describe(self, tool_id: str) -> dict[str, Any]:
        spec = self.pool.find_tool(tool_id)
        return spec.as_dict()

    # ------------------------------------------------------------------ #
    # invocation
    # ------------------------------------------------------------------ #
    def invoke(
        self,
        tool: str,
        arguments: Mapping[str, Any] | None = None,
        *,
        workspace_id: str = "local",
        grant: Grant | str | None = None,
        approval: Any = None,
        capabilities: Iterable[str] | None = None,
        timeout_s: float | None = None,
    ) -> InvokeOutcome:
        """Run one tool call through the full pre-flight chain.

        ``capabilities`` is a convenience for callers that hold a grant object
        already: it is only used to *narrow* what the grant allows, never to
        widen it.
        """
        started = time.perf_counter()
        args = dict(arguments or {})
        args_hash = sha256_of(args)

        def deny(exc: Exception, reason: str, spec: ToolSpec | None = None) -> None:
            self._record(
                GatewayAuditEntry(
                    workspace_id=workspace_id,
                    tool=tool,
                    server_id=spec.server_id if spec else tool.partition(".")[0],
                    ok=False,
                    reason=reason,
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    args_hash=args_hash,
                    sensitive=bool(spec and spec.requires_approval),
                    capabilities=tuple(sorted(spec.capabilities)) if spec else (),
                )
            )
            raise exc

        # 1. tool exists + is enabled (the pool only indexes enabled servers)
        try:
            spec = self.pool.find_tool(tool)
        except NotFound as exc:
            deny(exc, "tool_not_found")
            raise  # pragma: no cover - deny always raises

        # 0a. grant valid and covering
        resolved_grant: Grant | None = None
        if self.require_grants:
            try:
                resolved_grant = self.grants.verify(
                    grant,
                    workspace_id=workspace_id,
                    tool_id=spec.id,
                    required=spec.capabilities,
                )
            except GrantRequired as exc:
                deny(exc, "grant_required", spec)
                raise  # pragma: no cover
            if capabilities is not None:
                narrowed = {str(c).lower() for c in capabilities}
                if not spec.capabilities.issubset(narrowed):
                    deny(
                        GrantRequired(
                            "caller's capability set does not cover this tool",
                            details={
                                "tool": spec.id,
                                "required": sorted(spec.capabilities),
                                "offered": sorted(narrowed),
                            },
                        ),
                        "capability_narrowed",
                        spec,
                    )

        # 0b. approval gate for sensitive tools
        approval_id = ""
        if spec.requires_approval:
            try:
                decided = self.approvals.require(
                    approval, workspace_id=workspace_id, tool_id=spec.id
                )
                approval_id = decided.id
            except ApprovalPending as exc:
                pending = self.approvals.request(
                    workspace_id,
                    spec.id,
                    args_hash,
                    reason=f"{spec.id} is annotated as sensitive",
                )
                exc.details.setdefault("approval_id", pending.id)
                deny(exc, "approval_pending", spec)
                raise  # pragma: no cover

        # 2. action declared by the tool spec - implicit: the spec *is* the tool.
        #    What we can still check is that the server is actually ready.
        conn = self.pool.connection(spec.server_id)
        if not conn.ready:
            deny(
                McpUnavailable(
                    "MCP server is not ready",
                    details={"server_id": spec.server_id, "state": conn.state},
                ),
                "server_not_ready",
                spec,
            )

        # 4. payload budget + schema
        size = len(str(args).encode("utf-8"))
        if size > self.max_payload_bytes:
            deny(
                ValidationFailed(
                    "payload exceeds the tool budget",
                    details={"bytes": size, "max_bytes": self.max_payload_bytes},
                ),
                "payload_too_large",
                spec,
            )
        try:
            cleaned = validate_arguments(spec.name, spec.input_schema, args)
        except Exception as exc:
            deny(exc, "schema_invalid", spec)
            raise  # pragma: no cover

        # 5. egress: any URL argument must be on the allow-list
        egress_info: dict[str, Any] = {}
        try:
            egress_info = self._check_egress(conn.egress, cleaned)
        except EgressDenied as exc:
            deny(exc, "egress_denied", spec)
            raise  # pragma: no cover

        # 6. execute
        wall_s = min(
            (timeout_s or conn.spec.timeout_s),
            max(0.001, self.wall_ms / 1000),
        )
        try:
            result = self.pool.call_tool(spec.id, cleaned, timeout_s=wall_s)
        except McpUnavailable as exc:
            deny(exc, "mcp_unavailable", spec)
            raise  # pragma: no cover

        if resolved_grant is not None:
            self.grants.consume(resolved_grant)

        latency = int((time.perf_counter() - started) * 1000)
        self._record(
            GatewayAuditEntry(
                workspace_id=workspace_id,
                tool=spec.id,
                server_id=spec.server_id,
                ok=result.ok and not result.is_error,
                reason="ok" if result.ok else "tool_error",
                latency_ms=latency,
                tier=result.tier,
                args_hash=args_hash,
                result_hash=result.result_hash,
                sensitive=spec.requires_approval,
                capabilities=tuple(sorted(spec.capabilities)),
                grant_id=resolved_grant.id if resolved_grant else "",
            )
        )
        return InvokeOutcome(
            result=result,
            tool=spec,
            grant_id=resolved_grant.id if resolved_grant else "",
            approval_id=approval_id,
            egress=egress_info,
        )

    # ------------------------------------------------------------------ #
    def _check_egress(self, policy: EgressPolicy, args: Mapping[str, Any]) -> dict[str, Any]:
        """Reject URL arguments that point off the allow-list."""
        checked: list[dict[str, Any]] = []
        for key, value in args.items():
            if not isinstance(value, str) or not value.strip():
                continue
            looks_like_url = key.lower() in URL_ARG_KEYS or value.startswith(("http://", "https://"))
            if not looks_like_url:
                continue
            request = parse_url(value)
            decision = policy.check(request)
            checked.append(
                {"arg": key, "host": decision.host, "allowed": decision.allowed, "rule": decision.rule}
            )
            if not decision.allowed:
                raise EgressDenied(
                    f"egress to {decision.host!r} is not allowed: {decision.reason}",
                    details={"arg": key, "host": decision.host, "rule": decision.rule},
                )
        return {"checked": checked, "usage": policy.usage()} if checked else {}

    def _record(self, entry: GatewayAuditEntry) -> None:
        self.audit.append(entry)

    # ------------------------------------------------------------------ #
    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        if limit < 0:
            raise ValidationFailed("limit must be >= 0")
        return [e.as_dict() for e in self.audit[-limit:]][::-1]

    def summary(self) -> dict[str, Any]:
        ok = sum(1 for e in self.audit if e.ok)
        latencies = sorted(e.latency_ms for e in self.audit)
        return {
            "total": len(self.audit),
            "ok": ok,
            "denied": len(self.audit) - ok,
            "sensitive": sum(1 for e in self.audit if e.sensitive),
            "p50_latency_ms": latencies[len(latencies) // 2] if latencies else 0,
            "tools": len(self.pool.list_tools(None)),
        }

    # ------------------------------------------------------------------ #
    def issue_grant(
        self,
        workspace_id: str,
        tool_id: str,
        capabilities: Iterable[str] | None = None,
        *,
        ttl_s: int | None = None,
        single_use: bool = False,
    ) -> Grant:
        """Issue a grant, defaulting to exactly the capabilities the tool needs."""
        spec = self.pool.find_tool(tool_id)
        caps = list(capabilities) if capabilities is not None else sorted(spec.capabilities)
        return self.grants.issue(
            workspace_id,
            spec.id,
            caps,
            ttl_s=ttl_s,
            single_use=single_use,
        )


__all__ = [
    "DEFAULT_EGRESS_BYTES",
    "DEFAULT_WALL_MS",
    "MAX_PAYLOAD_BYTES",
    "URL_ARG_KEYS",
    "GatewayAuditEntry",
    "InvokeOutcome",
    "ToolGateway",
]
