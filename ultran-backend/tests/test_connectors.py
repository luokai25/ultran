"""Connector manifest + registry tests."""

from __future__ import annotations

import pytest

from ultran_backend.connectors import ConnectorManifest, ConnectorRegistry, load_catalog
from ultran_backend.connectors.catalog import BUILTIN_CONNECTORS, catalog_categories, catalog_size
from ultran_backend.errors import Conflict, NotFound, ValidationFailed


def manifest(**kw) -> ConnectorManifest:
    base = dict(id="demo", name="Demo", category="test", actions=("do_thing",))
    base.update(kw)
    return ConnectorManifest(**base)


# ---------------------------------------------------------------- manifests


def test_manifest_accepts_a_valid_declaration():
    m = manifest()
    assert m.supports("do_thing")
    assert not m.supports("other_thing")


@pytest.mark.parametrize("bad_id", ["Demo", "de", "1demo", "demo_space", "-demo", "d" * 60])
def test_manifest_rejects_bad_ids(bad_id):
    with pytest.raises(ValidationFailed):
        manifest(id=bad_id)


def test_manifest_rejects_empty_name():
    with pytest.raises(ValidationFailed, match="name"):
        manifest(name="   ")


def test_manifest_rejects_unknown_auth_kind():
    with pytest.raises(ValidationFailed, match="auth_kind"):
        manifest(auth_kind="magic")


def test_manifest_rejects_unknown_tier():
    with pytest.raises(ValidationFailed, match="tier"):
        manifest(tier="gold")


def test_manifest_requires_actions():
    with pytest.raises(ValidationFailed, match="action"):
        manifest(actions=())


def test_manifest_rejects_duplicate_actions():
    with pytest.raises(ValidationFailed, match="duplicate"):
        manifest(actions=("do_thing", "do_thing"))


@pytest.mark.parametrize("bad_action", ["Do_Thing", "do-thing", "9do"])
def test_manifest_rejects_bad_action_names(bad_action):
    with pytest.raises(ValidationFailed):
        manifest(actions=(bad_action,))


# ---------------------------------------------------------------- registry


def test_registry_starts_empty_and_registers():
    r = ConnectorRegistry()
    assert len(r) == 0
    r.register(manifest())
    assert len(r) == 1
    assert "demo" in r
    assert r.get("demo").name == "Demo"


def test_registry_rejects_duplicate_registration():
    r = ConnectorRegistry([manifest()])
    with pytest.raises(Conflict):
        r.register(manifest())
    r.register(manifest(), replace=True)  # explicit replace is allowed
    assert len(r) == 1


def test_registry_missing_lookup_raises_not_found():
    r = ConnectorRegistry()
    with pytest.raises(NotFound):
        r.get("ghost")


def test_registry_unregister_removes_and_prunes_enablement():
    r = ConnectorRegistry([manifest()])
    r.enable("ws", "demo")
    r.unregister("demo")
    assert len(r) == 0
    assert r.enabled_for("ws") == []
    with pytest.raises(NotFound):
        r.unregister("demo")


def test_enable_and_disable_are_idempotent():
    r = ConnectorRegistry([manifest()])
    r.enable("ws", "demo")
    r.enable("ws", "demo")
    assert r.enabled_for("ws") == ["demo"]
    r.disable("ws", "demo")
    r.disable("ws", "demo")
    assert r.enabled_for("ws") == []


def test_resolve_requires_enablement():
    r = ConnectorRegistry([manifest()])
    with pytest.raises(NotFound, match="not enabled"):
        r.resolve("ws", "demo")
    r.enable("ws", "demo")
    assert r.resolve("ws", "demo").id == "demo"


def test_enable_unknown_connector_raises():
    r = ConnectorRegistry()
    with pytest.raises(NotFound):
        r.enable("ws", "ghost")


def test_list_filters_by_category_tier_and_auth():
    r = ConnectorRegistry(
        [
            manifest(id="aaa", category="one", tier="free", auth_kind="none"),
            manifest(id="bbb", category="one", tier="paid", auth_kind="api_key"),
            manifest(id="ccc", category="two", tier="paid", auth_kind="api_key"),
        ]
    )
    assert len(r.list()) == 3
    assert len(r.list(category="one")) == 2
    assert len(r.list(tier="paid")) == 2
    assert len(r.list(auth_kind="none")) == 1
    assert [m.id for m in r.list(category="one", tier="paid")] == ["bbb"]


def test_list_search_matches_id_name_and_description():
    r = ConnectorRegistry(
        [manifest(id="alpha", name="Alpha Thing", description="does alpha"), manifest(id="beta")]
    )
    assert [m.id for m in r.list(search="alpha")] == ["alpha"]
    assert [m.id for m in r.list(search="BETA")] == ["beta"]


def test_list_paginates():
    r = ConnectorRegistry([manifest(id=f"c{i}x") for i in range(5)])
    assert len(r.list(limit=2)) == 2
    assert len(r.list(limit=2, offset=4)) == 1
    assert r.list(limit=10, offset=99) == []
    with pytest.raises(ValidationFailed):
        r.list(offset=-1)


def test_list_is_stable_and_sorted():
    r = ConnectorRegistry([manifest(id="bbb", category="b"), manifest(id="aaa", category="a")])
    assert [m.id for m in r.list()] == ["aaa", "bbb"]
    assert [m.id for m in r.list()] == [m.id for m in r.list()]


def test_categories_and_stats():
    r = ConnectorRegistry(
        [manifest(id="aaa", category="one"), manifest(id="bbb", category="one", tier="paid")]
    )
    assert r.categories() == {"one": 2}
    stats = r.stats()
    assert stats["total"] == 2
    assert stats["free"] == 1
    assert stats["paid"] == 1


def test_iteration_yields_manifests():
    r = ConnectorRegistry([manifest()])
    assert [m.id for m in r] == ["demo"]


# ---------------------------------------------------------------- catalog


def test_catalog_is_substantial():
    assert catalog_size() >= 70


def test_catalog_has_no_duplicate_ids():
    ids = [m.id for m in BUILTIN_CONNECTORS]
    assert len(ids) == len(set(ids))


def test_catalog_mixes_free_and_paid_plans():
    tiers = {m.tier for m in BUILTIN_CONNECTORS}
    assert tiers == {"free", "paid"}
    free = sum(1 for m in BUILTIN_CONNECTORS if m.tier == "free")
    assert free >= 30


def test_catalog_covers_the_expected_categories():
    cats = catalog_categories()
    for expected in ("ai", "communication", "infra", "productivity", "social"):
        assert expected in cats
        assert cats[expected] >= 3


def test_catalog_every_manifest_is_valid_and_actionable():
    for m in BUILTIN_CONNECTORS:
        m.validate()
        assert len(m.actions) >= 1
        assert m.description, f"{m.id} has no description"


def test_catalog_loads_into_a_registry():
    r = ConnectorRegistry(load_catalog())
    assert len(r) == catalog_size()
    assert r.stats()["total"] == catalog_size()


def test_catalog_includes_the_keyless_local_connectors():
    by_id = {m.id: m for m in BUILTIN_CONNECTORS}
    assert by_id["ollama"].auth_kind == "none"
    assert by_id["arxiv"].auth_kind == "none"


# ------------------------------------------------- expanded catalog (extension)


def test_catalog_is_in_the_hundreds():
    assert catalog_size() >= 400


def test_catalog_extension_ids_do_not_shadow_the_core_set():
    from ultran_backend.connectors.catalog import _ROWS
    from ultran_backend.connectors.catalog_extra import EXTRA_ROWS

    core = {row[0] for row in _ROWS}
    extra = [row[0] for row in EXTRA_ROWS]
    assert not core & set(extra)
    assert len(extra) == len(set(extra))


def test_catalog_has_no_duplicate_display_names():
    names = [m.name.lower() for m in BUILTIN_CONNECTORS]
    assert len(names) == len(set(names))


def test_catalog_ids_never_collide_with_the_reserved_test_ghost():
    # tests/test_api.py relies on "ghost" being an unknown connector.
    assert "ghost" not in {m.id for m in BUILTIN_CONNECTORS}


def test_catalog_free_connectors_outnumber_paid_ones():
    free = sum(1 for m in BUILTIN_CONNECTORS if m.tier == "free")
    assert free > catalog_size() // 2


def test_phone_snapshot_matches_the_catalog():
    import json
    from pathlib import Path

    snapshot = Path(__file__).resolve().parents[2] / "apps" / "phone" / "src" / "connectors.catalog.json"
    rows = json.loads(snapshot.read_text(encoding="utf-8"))
    assert {r["id"] for r in rows} == {m.id for m in BUILTIN_CONNECTORS}, (
        "apps/phone connectors.catalog.json is stale; run ultran-backend/tools/export_catalog.py"
    )
