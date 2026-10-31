from __future__ import annotations

from types import SimpleNamespace

import pytest

from ultran_backend.composio import ComposioGateway, composio_user_id
from ultran_backend.errors import DependencyUnavailable, ValidationFailed


def test_workspace_ids_are_stable_and_opaque():
    first = composio_user_id("workspace-private-name")
    assert first == composio_user_id("workspace-private-name")
    assert first.startswith("ultran_")
    assert "workspace-private-name" not in first


def test_invalid_workspace_is_rejected():
    with pytest.raises(ValidationFailed):
        composio_user_id("")


def test_gateway_fails_closed_without_api_key():
    gateway = ComposioGateway()
    assert gateway.configured is False
    with pytest.raises(DependencyUnavailable):
        gateway.create_session("local")


def test_create_session_returns_only_mcp_endpoint_data():
    gateway = ComposioGateway(api_key="test-key")
    gateway._client = SimpleNamespace(
        sessions=SimpleNamespace(
            create=lambda **kwargs: SimpleNamespace(
                session_id="sess_123",
                mcp=SimpleNamespace(
                    url="https://mcp.example/session",
                    headers={"Authorization": "Bearer session-token"},
                ),
            )
        )
    )
    result = gateway.create_session("local")
    assert result["session_id"] == "sess_123"
    assert result["mcp"]["url"] == "https://mcp.example/session"
    assert result["mcp"]["headers"]["Authorization"].startswith("Bearer ")


def test_authorize_returns_hosted_https_link_and_callback():
    seen = {}

    class Session:
        def authorize(self, toolkit, **kwargs):
            seen["toolkit"] = toolkit
            seen["kwargs"] = kwargs
            return SimpleNamespace(redirect_url="https://connect.composio.dev/link/abc")

    gateway = ComposioGateway(api_key="test-key", callback_url="ultran://connected")
    gateway._client = SimpleNamespace(
        sessions=SimpleNamespace(create=lambda **kwargs: Session())
    )
    result = gateway.authorize("local", "google_drive")
    assert result == {
        "toolkit": "google_drive",
        "redirect_url": "https://connect.composio.dev/link/abc",
    }
    assert seen["toolkit"] == "google_drive"
    assert seen["kwargs"]["callback_url"] == "ultran://connected"


def test_authorize_rejects_invalid_toolkit_slug():
    gateway = ComposioGateway(api_key="test-key")
    with pytest.raises(ValidationFailed):
        gateway.authorize("local", "../gmail")


def test_connections_are_redacted_to_metadata():
    account = SimpleNamespace(
        id="ca_123",
        toolkit=SimpleNamespace(slug="gmail"),
        status="ACTIVE",
        created_at="2026-10-31T00:00:00Z",
        state=SimpleNamespace(val={"access_token": "must-not-leak"}),
    )
    gateway = ComposioGateway(api_key="test-key")
    gateway._client = SimpleNamespace(
        connected_accounts=SimpleNamespace(
            list=lambda **kwargs: SimpleNamespace(items=[account])
        )
    )
    rows = gateway.list_connections("local")
    assert rows == [{
        "id": "ca_123",
        "toolkit": "gmail",
        "status": "ACTIVE",
        "created_at": "2026-10-31T00:00:00Z",
    }]
    assert "access_token" not in str(rows)


def test_composio_routes_report_unconfigured_state(client):
    assert client.get("/v1/connectors/composio/status").json() == {
        "configured": False,
        "provider": "composio",
    }
    response = client.post("/v1/connectors/composio/session")
    assert response.status_code == 503


def test_composio_connect_routes_are_workspace_scoped(client, container):
    class FakeGateway:
        configured = True

        def authorize(self, workspace, toolkit):
            return {"workspace": workspace, "toolkit": toolkit,
                    "redirect_url": "https://connect.composio.dev/link/test"}

        def list_connections(self, workspace):
            return [{"workspace": workspace, "toolkit": "gmail"}]

        def revoke(self, workspace, account_id):
            assert workspace == "kai-workspace"
            assert account_id == "ca_test"

        def create_session(self, workspace):
            return {"workspace": workspace, "mcp": {"url": "https://mcp.example", "headers": {}}}

    container.composio = FakeGateway()
    headers = {"X-Ultran-Workspace": "kai-workspace"}
    assert client.post(
        "/v1/connectors/composio/authorize/gmail", headers=headers
    ).json()["workspace"] == "kai-workspace"
    assert client.get(
        "/v1/connectors/composio/connections", headers=headers
    ).json()["connections"][0]["workspace"] == "kai-workspace"
    assert client.post(
        "/v1/connectors/composio/session", headers=headers
    ).json()["workspace"] == "kai-workspace"
    assert client.delete(
        "/v1/connectors/composio/connections/ca_test", headers=headers
    ).status_code == 204


def test_revoke_refuses_an_account_owned_by_another_workspace():
    from ultran_backend.errors import NotFound

    requested = {}

    def list_accounts(**kwargs):
        requested.update(kwargs)
        # The Composio user filter must isolate this workspace. An account
        # returned for a different user must never be treated as owned here.
        return SimpleNamespace(items=[])

    gateway = ComposioGateway(api_key="test-key")
    gateway._client = SimpleNamespace(
        connected_accounts=SimpleNamespace(
            list=list_accounts,
            revoke=lambda account_id: pytest.fail("foreign account must not be revoked"),
        )
    )
    with pytest.raises(NotFound):
        gateway.revoke("workspace-a", "ca_other")
    assert requested["user_ids"] == [composio_user_id("workspace-a")]
