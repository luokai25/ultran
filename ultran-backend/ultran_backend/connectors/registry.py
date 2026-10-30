"""Connector manifest validation and an in-memory registry."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Literal

from ..errors import Conflict, NotFound, ValidationFailed

ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,47}$")
ACTION_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
AUTH_KINDS = {"api_key", "oauth2", "none", "webhook"}
TIERS = {"free", "paid"}


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

    def __post_init__(self) -> None:
        self.validate()

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
        if not self.actions:
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


class ConnectorRegistry:
    """Holds every connector Ultran can drive, plus per-workspace enablement."""

    def __init__(self, manifests: Iterable[ConnectorManifest] = ()) -> None:
        self._manifests: dict[str, ConnectorManifest] = {}
        self._enabled: dict[str, set[str]] = {}
        for manifest in manifests:
            self.register(manifest, replace=False)

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
        return {
            "total": len(self._manifests),
            "free": sum(1 for m in self._manifests.values() if m.tier == "free"),
            "paid": sum(1 for m in self._manifests.values() if m.tier == "paid"),
            "categories": self.categories(),
        }


Plan = Literal["free", "paid"]
__all__ = ["AUTH_KINDS", "ConnectorManifest", "ConnectorRegistry", "TIERS"]
