"""The wiring: MCP servers projected into the connector registry, and the API.

This is the test file that proves the task's actual requirement - that the MCP
runtime is *wired into* ``connectors/registry.py`` rather than sitting beside it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from ultran_backend.connectors import ConnectorManifest, ConnectorRegistry, load_catalog
from ultran_backend.connectors.registry import (
    MCP_CATEGORY,
    mcp_connector_id,
    server_id_from_connector,
)
from ultran_backend.errors import NotFound, ValidationFailed
from ultran_backend.mcp import McpClientPool, ServerSpec, ToolGateway
from ultran_backend.mcp.errors import GrantRequired

FIXTURE = Path(__file__).parent / "fixtures" / "mcp_fixture_server.py"


def spec(server_id: str = "fixture", **kw) -> ServerSpec:
    base = {
        "id": server_id,
        "name": "Fixture",
        "command": sys.executable,
        "args": (str(FIXTURE),),
        "trust_level": "local",
        "timeout_s": 20.0,
        "connect_timeout_s": 20.0,
    }
    base.update(kw)
    return ServerSpec(**base)


@pytest.fixture()
def wired():
    """A registry with the builtin catalog plus one live MCP server."""
    registry = ConnectorRegistry(load_catalog())
    pool = McpClientPool()
    gateway = ToolGateway(pool)
    registry.attach_mcp(pool, gateway)
    pool.register(spec())
    pool.connect("fixture")
    registry.sync_mcp()
    yield registry, pool, gateway
    pool.close()


# ---------------------------------------------------------------- id mapping


def test_server_id_maps_to_a_valid_connector_id():
    assert mcp_connector_id("fs") == "mcp-fs"
    assert mcp_connector_id("github-server") == "mcp-github-server"


def test_id_mapping_normalises_awkward_server_ids():
    assert mcp_connector_id("My_Server.v2") == "mcp-my-server-v2"


def test_id_mapping_round_trips():
    assert server_id_from_connector(mcp_connector_id("fs")) == "fs"


def test_id_mapping_rejects_an_unusable_id():
    with pytest.raises(ValidationFailed):
        mcp_connector_id("!!!")


# ---------------------------------------------------------------- projection


def test_sync_projects_the_server_into_the_registry(wired):
    registry, _, _ = wired
    manifest = registry.get("mcp-fixture")
    assert manifest.is_mcp
    assert manifest.source == "mcp"
    assert manifest.mcp_server_id == "fixture"
    assert manifest.category == MCP_CATEGORY
    assert manifest.transport == "stdio"


def test_projected_manifest_lists_the_discovered_tools(wired):
    registry, _, _ = wired
    manifest = registry.get("mcp-fixture")
    assert "read_file" in manifest.actions
    assert "delete_path" in manifest.actions


def test_projected_manifest_carries_the_capability_union(wired):
    registry, _, _ = wired
    caps = set(registry.get("mcp-fixture").capabilities)
    assert {"read", "write", "delete"} <= caps


def test_projected_manifest_needs_no_credential(wired):
    """An MCP server carries its own credentials; Ultran stores none."""
    registry, _, _ = wired
    assert registry.get("mcp-fixture").auth_kind == "none"


def test_builtin_connectors_are_untouched(wired):
    registry, _, _ = wired
    github = registry.get("github")
    assert not github.is_mcp
    assert github.source == "builtin"
    assert github.actions


def test_registry_stats_separate_builtin_from_mcp(wired):
    registry, _, _ = wired
    stats = registry.stats()
    assert stats["mcp"] == 1
    assert stats["builtin"] >= 70
    assert stats["mcp_tools"] >= 5
    assert stats["total"] == stats["builtin"] + stats["mcp"]


def test_mcp_connectors_are_listed_under_their_own_category(wired):
    registry, _, _ = wired
    rows = registry.list(category=MCP_CATEGORY)
    assert [m.id for m in rows] == ["mcp-fixture"]


def test_mcp_connector_is_searchable(wired):
    registry, _, _ = wired
    assert "mcp-fixture" in [m.id for m in registry.list(search="fixture")]


def test_sync_is_idempotent(wired):
    registry, _, _ = wired
    before = len(registry)
    registry.sync_mcp()
    registry.sync_mcp()
    assert len(registry) == before


def test_sync_without_a_pool_is_a_no_op():
    registry = ConnectorRegistry(load_catalog())
    assert registry.sync_mcp() == []
    assert not registry.mcp_attached


def test_manifest_requires_a_server_id_when_mcp():
    with pytest.raises(ValidationFailed, match="name its server"):
        ConnectorManifest(
            id="mcp-x", name="X", category="mcp", actions=(), source="mcp"
        )


def test_mcp_manifest_may_have_no_actions_yet():
    """A registered-but-not-yet-handshaked server is valid."""
    m = ConnectorManifest(
        id="mcp-x", name="X", category="mcp", actions=(), source="mcp", mcp_server_id="x"
    )
    assert m.actions == ()


def test_builtin_manifest_still_requires_actions():
    with pytest.raises(ValidationFailed, match="at least one action"):
        ConnectorManifest(id="demo", name="Demo", category="test", actions=())


def test_unknown_source_is_rejected():
    with pytest.raises(ValidationFailed, match="source"):
        ConnectorManifest(
            id="demo", name="Demo", category="t", actions=("a",), source="magic"
        )


# ---------------------------------------------------------------- routing


def test_registry_routes_an_mcp_connector_through_the_gateway(wired):
    registry, _, gateway = wired
    registry.enable("ws", "mcp-fixture")
    grant = gateway.issue_grant("ws", "fixture.read_file")
    outcome = registry.invoke(
        "ws", "mcp-fixture", "read_file", {"path": "/x"}, grant=grant
    )
    assert outcome.ok
    assert "contents of /x" in outcome.result.text


def test_registry_enforces_grants_on_the_mcp_path(wired):
    registry, _, _ = wired
    registry.enable("ws", "mcp-fixture")
    with pytest.raises(GrantRequired):
        registry.invoke("ws", "mcp-fixture", "read_file", {"path": "/x"})


def test_registry_rejects_an_undeclared_action(wired):
    registry, _, _ = wired
    registry.enable("ws", "mcp-fixture")
    with pytest.raises(ValidationFailed, match="does not expose"):
        registry.invoke("ws", "mcp-fixture", "not_a_tool", {})


def test_registry_requires_enablement_before_invoking(wired):
    registry, _, _ = wired
    with pytest.raises(NotFound, match="not enabled"):
        registry.invoke("ws", "mcp-fixture", "read_file", {})


def test_registry_routes_a_builtin_connector_to_the_sandbox(wired):
    """The legacy path must be untouched by the MCP wiring."""
    registry, _, _ = wired
    registry.enable("ws", "arxiv")

    class FakeSandbox:
        def __init__(self):
            self.calls = []

        def invoke(self, workspace_id, connector_id, action, payload):
            self.calls.append((workspace_id, connector_id, action, payload))
            return "sandbox-result"

    sandbox = FakeSandbox()
    result = registry.invoke("ws", "arxiv", "search", {"q": "x"}, sandbox=sandbox)
    assert result == "sandbox-result"
    assert sandbox.calls == [("ws", "arxiv", "search", {"q": "x"})]


def test_registry_requires_a_sandbox_for_builtin_connectors(wired):
    registry, _, _ = wired
    registry.enable("ws", "arxiv")
    with pytest.raises(ValidationFailed, match="sandbox"):
        registry.invoke("ws", "arxiv", "search", {})


def test_registry_requires_a_gateway_for_mcp_connectors():
    registry = ConnectorRegistry(load_catalog())
    pool = McpClientPool()
    registry.attach_mcp(pool)  # no gateway
    pool.register(spec())
    pool.connect("fixture")
    registry.sync_mcp()
    registry.enable("ws", "mcp-fixture")
    with pytest.raises(NotFound, match="gateway"):
        registry.invoke("ws", "mcp-fixture", "read_file", {"path": "/x"})
    pool.close()


# ---------------------------------------------------------------- container


def test_container_builds_the_mcp_runtime(container):
    assert container.mcp_pool is not None
    assert container.mcp_gateway is not None
    assert container.registry.mcp_attached
    assert container.registry.mcp_pool is container.mcp_pool


def test_container_registers_and_projects_a_server(container):
    status = container.register_mcp_server(spec("demo"), connect=True)
    assert status["state"] == "ready"
    assert "mcp-demo" in container.registry
    assert container.registry.get("mcp-demo").is_mcp
    container.unregister_mcp_server("demo")
    assert "mcp-demo" not in container.registry


def test_container_seeds_mcp_connectors_for_the_workspace(container):
    container.register_mcp_server(spec("demo"), connect=True)
    container.seed_default_workspace("ws")
    assert "mcp-demo" in container.registry.enabled_for("ws")


def test_container_probes_a_server(container):
    container.register_mcp_server(spec("demo"), connect=True)
    status = container.probe_mcp_server("demo")
    assert status["state"] == "ready"
    assert status["tools"]


def test_container_reads_servers_from_config(tmp_path):
    import json

    from ultran_backend.config import Settings
    from ultran_backend.container import Container

    settings = Settings(
        data_dir=tmp_path / "d",
        mcp_servers_json=json.dumps(
            [{"id": "cfg", "command": sys.executable, "args": [str(FIXTURE)]}]
        ),
    )
    c = Container.build(settings)
    assert "cfg" in c.mcp_pool
    assert "mcp-cfg" in c.registry
    c.close()


def test_container_ignores_malformed_server_config(tmp_path):
    from ultran_backend.config import Settings
    from ultran_backend.container import Container

    settings = Settings(data_dir=tmp_path / "d", mcp_servers_json="{not json")
    c = Container.build(settings)
    assert len(c.mcp_pool) == 0
    c.close()


# ---------------------------------------------------------------- HTTP API


def test_api_lists_servers(client):
    response = client.get("/v1/mcp/servers")
    assert response.status_code == 200
    body = response.json()
    assert "servers" in body
    assert "health" in body


def test_api_registers_a_server_and_exposes_its_tools(client):
    response = client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    assert response.status_code == 201, response.text
    assert response.json()["state"] == "ready"

    tools = client.get("/v1/mcp/tools").json()
    assert "api-demo.read_file" in {t["id"] for t in tools["tools"]}

    # And it appears in the connector marketplace, which is the whole point.
    connectors = client.get("/v1/connectors").json()
    assert "mcp-api-demo" in {c["id"] for c in connectors}


def test_api_capability_filter_narrows_the_index(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    body = client.get("/v1/mcp/tools", params={"capabilities": "read"}).json()
    assert body["tools"]
    assert all(t["annotations"]["capabilities"] == ["read"] for t in body["tools"])


def test_api_invokes_with_a_grant(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    grant = client.post("/v1/mcp/grants", json={"tool": "api-demo.read_file"}).json()
    response = client.post(
        "/v1/mcp/invoke",
        json={
            "tool": "api-demo.read_file",
            "arguments": {"path": "/x"},
            "grant_id": grant["id"],
        },
    )
    assert response.status_code == 200, response.text
    assert "contents of /x" in response.json()["text"]


def test_api_invoke_without_a_grant_returns_403(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    response = client.post(
        "/v1/mcp/invoke",
        json={"tool": "api-demo.read_file", "arguments": {"path": "/x"}},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "grant_required"


def test_api_sensitive_tool_returns_409_with_an_approval_id(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    grant = client.post("/v1/mcp/grants", json={"tool": "api-demo.delete_path"}).json()
    response = client.post(
        "/v1/mcp/invoke",
        json={
            "tool": "api-demo.delete_path",
            "arguments": {"path": "/x"},
            "grant_id": grant["id"],
        },
    )
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "approval_pending"
    assert body["details"]["approval_id"].startswith("apr_")


def test_api_approval_flow_completes(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    grant = client.post("/v1/mcp/grants", json={"tool": "api-demo.delete_path"}).json()
    first = client.post(
        "/v1/mcp/invoke",
        json={
            "tool": "api-demo.delete_path",
            "arguments": {"path": "/x"},
            "grant_id": grant["id"],
        },
    )
    approval_id = first.json()["error"]["details"]["approval_id"]

    pending = client.get("/v1/mcp/approvals").json()["approvals"]
    assert approval_id in {a["id"] for a in pending}

    decided = client.post(f"/v1/mcp/approvals/{approval_id}", json={"approved": True})
    assert decided.json()["state"] == "approved"

    second = client.post(
        "/v1/mcp/invoke",
        json={
            "tool": "api-demo.delete_path",
            "arguments": {"path": "/x"},
            "grant_id": grant["id"],
            "approval_id": approval_id,
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["ok"] is True


def test_api_egress_denial_returns_403(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    grant = client.post("/v1/mcp/grants", json={"tool": "api-demo.fetch_url"}).json()
    response = client.post(
        "/v1/mcp/invoke",
        json={
            "tool": "api-demo.fetch_url",
            "arguments": {"url": "https://evil.com/x"},
            "grant_id": grant["id"],
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "egress_denied"


def test_api_schema_violation_returns_422(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    grant = client.post("/v1/mcp/grants", json={"tool": "api-demo.read_file"}).json()
    response = client.post(
        "/v1/mcp/invoke",
        json={"tool": "api-demo.read_file", "arguments": {}, "grant_id": grant["id"]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "schema_invalid"


def test_api_probe_refreshes(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    response = client.post("/v1/mcp/servers/api-demo/probe")
    assert response.status_code == 200
    assert response.json()["state"] == "ready"


def test_api_unregister_removes_the_connector(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    assert client.delete("/v1/mcp/servers/api-demo").status_code == 204
    connectors = client.get("/v1/connectors").json()
    assert "mcp-api-demo" not in {c["id"] for c in connectors}


def test_api_rejects_a_bad_server_id(client):
    response = client.post(
        "/v1/mcp/servers", json={"id": "Bad ID!", "command": "true"}
    )
    assert response.status_code == 422


def test_api_rejects_shell_metacharacters_in_command(client):
    response = client.post(
        "/v1/mcp/servers", json={"id": "x", "command": "true; rm -rf /"}
    )
    assert response.status_code == 422


def test_api_audit_lists_tool_calls(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    grant = client.post("/v1/mcp/grants", json={"tool": "api-demo.read_file"}).json()
    client.post(
        "/v1/mcp/invoke",
        json={"tool": "api-demo.read_file", "arguments": {"path": "/x"}, "grant_id": grant["id"]},
    )
    body = client.get("/v1/mcp/audit").json()
    assert body["entries"]
    assert body["entries"][0]["tool"] == "api-demo.read_file"


def test_api_stats_combines_pool_gateway_and_registry(client):
    body = client.get("/v1/mcp/stats").json()
    assert "pool" in body and "gateway" in body and "registry" in body


def test_api_grant_can_be_revoked(client):
    client.post(
        "/v1/mcp/servers",
        json={"id": "api-demo", "command": sys.executable, "args": [str(FIXTURE)]},
    )
    grant = client.post("/v1/mcp/grants", json={"tool": "api-demo.read_file"}).json()
    assert client.delete(f"/v1/mcp/grants/{grant['id']}").status_code == 204
    response = client.post(
        "/v1/mcp/invoke",
        json={"tool": "api-demo.read_file", "arguments": {"path": "/x"}, "grant_id": grant["id"]},
    )
    assert response.status_code == 403
