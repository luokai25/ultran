"""Connector manifest validation and an in-memory registry.

v2 keeps this module as the single answer to "what can Ultran call?", but the
answer now has two sources:

* **builtin** - the frozen builtin catalog (several hundred manifests) (read-only in v2, removed in
  Phase 5 once MCP covers the surface);
* **mcp** - a registered MCP server, whose tools are discovered at handshake
  time and projected into the same registry as a synthetic manifest.

That projection is the whole point of the wiring: the marketplace, the
enable/disable flow, the sandbox's four pre-flight checks and the UI all keep
working unchanged, while the *transport* underneath is MCP. A caller that does
not care about the difference keeps calling ``resolve()``; a caller that does
uses :meth:`ConnectorRegistry.invoke`, which routes MCP connectors through the
tool gateway (grants, approvals, egress) and everything else through the legacy
sandbox.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal

from ..errors import Conflict, NotFound, ValidationFailed

ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,47}$")
ACTION_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
AUTH_KINDS = {"api_key", "oauth2", "none", "webhook"}
TIERS = {"free", "paid"}
SOURCES = {"builtin", "mcp"}

#: Category every MCP-backed connector is filed under in the marketplace.
MCP_CATEGORY = "mcp"
MCP_ID_PREFIX = "mcp-"


def mcp_connector_id(server_id: str) -> str:
    """Map an MCP server id onto a valid connector id (``fs`` -> ``mcp-fs``)."""
    slug = re.sub(r"[^a-z0-9]+", "-", server_id.strip().lower()).strip("-")
    if not slug:
        raise ValidationFailed("MCP server id has no usable characters", details={"id": server_id})
    candidate = f"{MCP_ID_PREFIX}{slug}"[:48].rstrip("-")
    if not ID_RE.match(candidate):
        raise ValidationFailed(
            "MCP server id cannot be mapped to a connector id", details={"id": server_id}
        )
    return candidate


def server_id_from_connector(connector_id: str) -> str:
    """Inverse of :func:`mcp_connector_id` for the ids we generate."""
    return connector_id.removeprefix(MCP_ID_PREFIX)


@dataclass(frozen=True)
class ConnectorManifest:
    """A connector as declared by its author and validated on registration."""

    id: str
    name: str
    category: str
    auth_kind: str = "api_key"
    tier: str = "free"
    actions: tuple[str, ...] = ()
    description: str = ""
    #: ``builtin`` for the frozen catalog, ``mcp`` for a discovered server.
    source: str = "builtin"
    #: The MCP server this manifest projects, when ``source == "mcp"``.
    mcp_server_id: str = ""
    #: Transport label for display: ``stdio`` / ``http`` / ``""`` for builtin.
    transport: str = ""
    #: Capability union across the server's tools, for the marketplace badge.
    capabilities: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        self.validate()

    @property
    def is_mcp(self) -> bool:
        return self.source == "mcp"

    def validate(self) -> None:
        if not ID_RE.match(self.id):
            raise ValidationFailed(
                "connector id must be lowercase alphanumeric with hyphens",
                details={"id": self.id},
            )
        if not self.name.strip():
            raise ValidationFailed("connector name must not be empty", details={"id": self.id})
        if self.auth_kind not in AUTH_KINDS:
            raise ValidationFailed(
                "unsupported auth_kind",
                details={"auth_kind": self.auth_kind, "allowed": sorted(AUTH_KINDS)},
            )
        if self.tier not in TIERS:
            raise ValidationFailed(
                "unsupported tier", details={"tier": self.tier, "allowed": sorted(TIERS)}
            )
        if self.source not in SOURCES:
            raise ValidationFailed(
                "unsupported source", details={"source": self.source, "allowed": sorted(SOURCES)}
            )
        if self.is_mcp and not self.mcp_server_id:
            raise ValidationFailed(
                "an mcp connector must name its server", details={"id": self.id}
            )
        # A builtin connector must declare actions; an MCP server may legitimately
        # expose none yet (it is registered before its first handshake).
        if not self.actions and not self.is_mcp:
            raise ValidationFailed("a connector must expose at least one action", details={"id": self.id})
        for action in self.actions:
            if not ACTION_RE.match(action):
                raise ValidationFailed(
                    "invalid action name", details={"action": action, "connector": self.id}
                )
        if len(set(self.actions)) != len(self.actions):
            raise ValidationFailed("duplicate action names", details={"id": self.id})

    def supports(self, action: str) -> bool:
        return action in self.actions

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "auth_kind": self.auth_kind,
            "tier": self.tier,
            "actions": list(self.actions),
            "description": self.description,
            "source": self.source,
            "mcp_server_id": self.mcp_server_id,
            "transport": self.transport,
            "capabilities": list(self.capabilities),
        }


class ConnectorRegistry:
    """Holds every connector Ultran can drive, plus per-workspace enablement.

    Two sources feed it: the builtin catalog and the MCP client pool. The pool is
    attached with :meth:`attach_mcp`; from then on :meth:`sync_mcp` projects every
    connected server into a manifest, so the rest of the backend never has to
    know whether a connector is a hand-written manifest or a discovered tool set.
    """

    def __init__(self, manifests: Iterable[ConnectorManifest] = ()) -> None:
        self._manifests: dict[str, ConnectorManifest] = {}
        self._enabled: dict[str, set[str]] = {}
        self._mcp_pool: Any = None
        self._mcp_gateway: Any = None
        for manifest in manifests:
            self.register(manifest, replace=False)

    # ------------------------------------------------------------------ #
    # MCP bridge
    # ------------------------------------------------------------------ #
    def attach_mcp(self, pool: Any, gateway: Any = None) -> None:
        """Bind the MCP client pool (and optionally its gateway) to this registry."""
        self._mcp_pool = pool
        self._mcp_gateway = gateway

    @property
    def mcp_pool(self) -> Any:
        return self._mcp_pool

    @property
    def mcp_gateway(self) -> Any:
        return self._mcp_gateway

    @property
    def mcp_attached(self) -> bool:
        return self._mcp_pool is not None

    def sync_mcp(self, *, connect: bool = False) -> list[ConnectorManifest]:
        """Project every registered MCP server into a connector manifest.

        Called after a server is registered, after a probe, and on startup. A
        server that is not connected still gets a manifest - with no actions - so
        the UI can show it as registered-but-down instead of hiding it.
        """
        if self._mcp_pool is None:
            return []
        projected: list[ConnectorManifest] = []
        for spec in self._mcp_pool.servers():
            if connect and spec.enabled:
                self._mcp_pool.connect(spec.id, raise_on_error=False)
            manifest = self.mcp_manifest(spec.id)
            self.register(manifest, replace=True)
            projected.append(manifest)
        return projected

    def mcp_manifest(self, server_id: str) -> ConnectorManifest:
        """Build the synthetic manifest for one MCP server."""
        if self._mcp_pool is None:
            raise NotFound("no MCP pool is attached", details={"server_id": server_id})
        spec = self._mcp_pool.get(server_id)
        conn = self._mcp_pool.connection(server_id)
        actions = tuple(sorted({tool.name for tool in conn.tools}))
        caps: set[str] = set()
        for tool in conn.tools:
            caps |= set(tool.capabilities)
        return ConnectorManifest(
            id=mcp_connector_id(server_id),
            name=spec.label,
            category=MCP_CATEGORY,
            # An MCP server carries its own credentials in its own environment;
            # Ultran never hands it a secret, so there is nothing to store.
            auth_kind="none",
            tier="free",
            actions=actions,
            description=spec.description
            or f"MCP server over {spec.transport} ({len(actions)} tools)",
            source="mcp",
            mcp_server_id=server_id,
            transport=spec.transport,
            capabilities=tuple(sorted(caps)),
        )

    def mcp_connectors(self) -> list[ConnectorManifest]:
        return [m for m in self._manifests.values() if m.is_mcp]

    def invoke(
        self,
        workspace_id: str,
        connector_id: str,
        action: str,
        payload: dict[str, Any] | None = None,
        *,
        grant: Any = None,
        approval: Any = None,
        sandbox: Any = None,
    ) -> Any:
        """Route one call to the right runtime.

        MCP connectors go through the tool gateway, which enforces grants,
        approvals, schema and egress. Builtin connectors keep the legacy sandbox
        path so the frozen catalog and its tests behave identically.
        """
        manifest = self.resolve(workspace_id, connector_id)
        if not manifest.supports(action):
            raise ValidationFailed(
                "connector does not expose this action",
                details={
                    "connector": connector_id,
                    "action": action,
                    "available": list(manifest.actions),
                },
            )
        if manifest.is_mcp:
            if self._mcp_gateway is None:
                raise NotFound(
                    "MCP gateway is not attached", details={"connector": connector_id}
                )
            return self._mcp_gateway.invoke(
                f"{manifest.mcp_server_id}.{action}",
                payload or {},
                workspace_id=workspace_id,
                grant=grant,
                approval=approval,
            )
        if sandbox is None:
            raise ValidationFailed(
                "a sandbox is required to invoke a builtin connector",
                details={"connector": connector_id},
            )
        return sandbox.invoke(workspace_id, connector_id, action, payload)

    # ------------------------------------------------------------------ #
    def __len__(self) -> int:
        return len(self._manifests)

    def __contains__(self, connector_id: object) -> bool:
        return connector_id in self._manifests

    def __iter__(self):
        return iter(self._manifests.values())

    def register(self, manifest: ConnectorManifest, *, replace: bool = False) -> ConnectorManifest:
        manifest.validate()
        if manifest.id in self._manifests and not replace:
            raise Conflict("connector already registered", details={"id": manifest.id})
        self._manifests[manifest.id] = manifest
        return manifest

    def unregister(self, connector_id: str) -> None:
        if connector_id not in self._manifests:
            raise NotFound("connector not found", details={"id": connector_id})
        del self._manifests[connector_id]
        for enabled in self._enabled.values():
            enabled.discard(connector_id)

    def get(self, connector_id: str) -> ConnectorManifest:
        try:
            return self._manifests[connector_id]
        except KeyError:
            raise NotFound("connector not found", details={"id": connector_id}) from None

    # ------------------------------------------------------------------ #
    def list(
        self,
        *,
        category: str | None = None,
        tier: str | None = None,
        auth_kind: str | None = None,
        search: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[ConnectorManifest]:
        if offset < 0:
            raise ValidationFailed("offset must be >= 0")
        needle = (search or "").strip().lower()
        rows = [
            m
            for m in self._manifests.values()
            if (category is None or m.category == category)
            and (tier is None or m.tier == tier)
            and (auth_kind is None or m.auth_kind == auth_kind)
            and (not needle or needle in m.id or needle in m.name.lower() or needle in m.description.lower())
        ]
        rows.sort(key=lambda m: (m.category, m.id))
        rows = rows[offset:]
        if limit is not None:
            rows = rows[:limit]
        return rows

    def categories(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for manifest in self._manifests.values():
            counts[manifest.category] = counts.get(manifest.category, 0) + 1
        return dict(sorted(counts.items()))

    # ------------------------------------------------------------------ #
    def enable(self, workspace_id: str, connector_id: str) -> None:
        self.get(connector_id)
        self._enabled.setdefault(workspace_id, set()).add(connector_id)

    def disable(self, workspace_id: str, connector_id: str) -> None:
        self._enabled.get(workspace_id, set()).discard(connector_id)

    def enabled_for(self, workspace_id: str) -> list[str]:
        return sorted(self._enabled.get(workspace_id, set()))

    def resolve(self, workspace_id: str, connector_id: str) -> ConnectorManifest:
        manifest = self.get(connector_id)
        if connector_id not in self._enabled.get(workspace_id, set()):
            raise NotFound(
                "connector is not enabled for this workspace",
                details={"id": connector_id, "workspace": workspace_id},
            )
        return manifest

    def stats(self) -> dict[str, object]:
        mcp = self.mcp_connectors()
        return {
            "total": len(self._manifests),
            "free": sum(1 for m in self._manifests.values() if m.tier == "free"),
            "paid": sum(1 for m in self._manifests.values() if m.tier == "paid"),
            "builtin": sum(1 for m in self._manifests.values() if not m.is_mcp),
            "mcp": len(mcp),
            "mcp_tools": sum(len(m.actions) for m in mcp),
            "categories": self.categories(),
        }


Plan = Literal["free", "paid"]
__all__ = [
    "AUTH_KINDS",
    "MCP_CATEGORY",
    "MCP_ID_PREFIX",
    "SOURCES",
    "TIERS",
    "ConnectorManifest",
    "ConnectorRegistry",
    "mcp_connector_id",
    "server_id_from_connector",
]
