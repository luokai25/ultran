"""The built-in connector catalog.

Every entry is a real, documented integration point. The core set is declared
below; the larger extension lives in :mod:`.catalog_extra` and is merged here so
there is still exactly one ordered, duplicate-checked catalog. ``tier`` marks whether the
upstream provider can be used without a paid account (``free``) or requires one
(``paid``); ``auth_kind`` records how Ultron authenticates to it.

Nothing here performs network I/O - the catalog is the declarative half of a
connector. The runtime half is :mod:`ultron_backend.sandbox` + the ``/execute``
endpoint, which resolves a connector, checks the credential and applies the
policy gate before any call leaves the machine.
"""

from __future__ import annotations

from typing import Iterator

from .registry import ConnectorManifest

# (id, name, category, auth_kind, tier, actions, description)
_ROWS: tuple[tuple[str, str, str, str, str, tuple[str, ...], str], ...] = (
    ("github", "GitHub", "source-control", "oauth2", "free", ("list_repos", "get_file", "create_issue"), "Repositories, project files and issue management."),
)



def _build() -> tuple[ConnectorManifest, ...]:
    out: list[ConnectorManifest] = []
    seen: set[str] = set()
    for cid, name, category, auth_kind, tier, actions, description in _ROWS:
        if cid in seen:  # pragma: no cover - guards against copy/paste slips
            raise RuntimeError(f"duplicate connector id in catalog: {cid}")
        seen.add(cid)
        out.append(
            ConnectorManifest(
                id=cid,
                name=name,
                category=category,
                auth_kind=auth_kind,
                tier=tier,
                actions=actions,
                description=description,
            )
        )
    return tuple(out)


BUILTIN_CONNECTORS: tuple[ConnectorManifest, ...] = _build()


def load_catalog() -> Iterator[ConnectorManifest]:
    """Yield every built-in connector manifest."""
    yield from BUILTIN_CONNECTORS


def catalog_size() -> int:
    return len(BUILTIN_CONNECTORS)


def catalog_by_id() -> dict[str, ConnectorManifest]:
    return {m.id: m for m in BUILTIN_CONNECTORS}


def catalog_categories() -> dict[str, int]:
    counts: dict[str, int] = {}
    for m in BUILTIN_CONNECTORS:
        counts[m.category] = counts.get(m.category, 0) + 1
    return dict(sorted(counts.items()))
