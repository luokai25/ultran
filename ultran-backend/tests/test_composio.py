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


def test_composio_tool_discovery_uses_isolated_pool_and_closes_it():
    gateway = ComposioGateway(api_key="test-key")
    class Pool:
        closed = False
        def list_tools(self):
            return [SimpleNamespace(as_dict=lambda: {"id": "composio.list_messages"})]
        def close(self):
            self.closed = True
    pool = Pool()
    gateway._workspace_pool = lambda workspace: pool
    assert gateway.list_tools("workspace-a") == [{"id": "composio.list_messages"}]
    assert pool.closed is True


def test_composio_unattended_invoke_rejects_mutating_tools_and_closes_pool():
    gateway = ComposioGateway(api_key="test-key")
    class Pool:
        closed = False
        def find_tool(self, tool_id):
            assert tool_id == "composio.send_email"
            return SimpleNamespace(
                id=tool_id,
                capabilities=frozenset({"write"}),
                requires_approval=True,
            )
        def close(self):
            self.closed = True
    pool = Pool()
    gateway._workspace_pool = lambda workspace: pool
    with pytest.raises(ValidationFailed, match="not eligible"):
        gateway.invoke_read_tool("workspace-a", "send_email", {"to": "x@example.com"})
    assert pool.closed is True


def test_composio_tool_routes_are_workspace_scoped(client, container):
    class FakeGateway:
        configured = True
        def pending_approvals(self, workspace):
            return [{"workspace": workspace, "id": "apr_123"}]
        def decide_approval(self, workspace, approval_id, *, approved):
            return {"workspace": workspace, "id": approval_id, "approved": approved}
        def list_tools(self, workspace):
            return [{"workspace": workspace, "id": "composio.list_messages"}]
        def invoke_read_tool(self, workspace, tool_name, arguments):
            return {"workspace": workspace, "tool": tool_name, "arguments": arguments}
    container.composio = FakeGateway()
    headers = {"X-Ultran-Workspace": "kai-workspace"}
    listed = client.get("/v1/connectors/composio/tools", headers=headers)
    assert listed.json()["tools"][0]["workspace"] == "kai-workspace"
    invoked = client.post(
        "/v1/connectors/composio/tools/invoke",
        headers=headers,
        json={"tool_name": "list_messages", "arguments": {"query": "inbox"}},
    )
    assert invoked.json()["workspace"] == "kai-workspace"
    assert invoked.json()["arguments"] == {"query": "inbox"}
    pending = client.get("/v1/connectors/composio/approvals", headers=headers)
    assert pending.json()["approvals"][0]["workspace"] == "kai-workspace"
    approved = client.post(
        "/v1/connectors/composio/approvals/apr_123/approve", headers=headers
    )
    assert approved.json()["approved"] is True
    denied = client.post(
        "/v1/connectors/composio/approvals/apr_123/deny", headers=headers
    )
    assert denied.json()["approved"] is False



def test_agent_planner_runs_read_only_composio_tool(monkeypatch):
    from ultran_backend.composio import ComposioGateway

    spec = SimpleNamespace(
        name="search_messages", title="Search messages", description="Search email messages",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}},
                      "required": ["query"]},
        capabilities=frozenset({"read"}), requires_approval=False, id="composio.search_messages",
    )
    class Pool:
        closed = False
        def list_tools(self):
            return [spec]
        def close(self):
            self.closed = True
    pool = Pool()
    gateway = ComposioGateway(api_key="test-key")
    gateway.create_session = lambda workspace: {"mcp": {"url": "https://mcp.example", "headers": {}}}
    monkeypatch.setattr("ultran_backend.mcp.McpClientPool", lambda: pool)
    monkeypatch.setattr("ultran_backend.mcp.ServerSpec", lambda **kwargs: SimpleNamespace(**kwargs))
    invoked = {}
    gateway._invoke_with_pool = lambda p, workspace, tool, args, approval=None: (
        invoked.update({"workspace": workspace, "tool": tool.name, "args": args}) or
        {"ok": True, "detail": "one result"}
    )
    result = gateway.plan_and_execute(
        "workspace-a", "agent-a", "search my inbox",
        lambda prompt, message: {"calls": [{"tool": "search_messages", "arguments": {"query": "inbox"}}]},
    )
    assert result[0]["ok"] is True
    assert invoked == {"workspace": "workspace-a", "tool": "search_messages", "args": {"query": "inbox"}}
    assert pool.closed is True


def test_agent_planner_pauses_write_tool_for_human_approval(monkeypatch):
    spec = SimpleNamespace(
        name="send_email", title="Send email", description="Send an email",
        input_schema={"type": "object", "properties": {"to": {"type": "string"}},
                      "required": ["to"]},
        capabilities=frozenset({"write"}), requires_approval=True, id="composio.send_email",
    )
    class Pool:
        closed = False
        def list_tools(self):
            return [spec]
        def close(self):
            self.closed = True
    pool = Pool()
    gateway = ComposioGateway(api_key="test-key")
    gateway.create_session = lambda workspace: {"mcp": {"url": "https://mcp.example", "headers": {}}}
    monkeypatch.setattr("ultran_backend.mcp.McpClientPool", lambda: pool)
    monkeypatch.setattr("ultran_backend.mcp.ServerSpec", lambda **kwargs: SimpleNamespace(**kwargs))
    gateway._invoke_with_pool = lambda *args, **kwargs: pytest.fail("write action ran before approval")
    result = gateway.plan_and_execute(
        "workspace-a", "agent-a", "send email",
        lambda prompt, message: {"calls": [{"tool": "send_email", "arguments": {"to": "a@example.com"}}]},
    )
    assert result[0]["approval_required"] is True
    assert result[0]["approval_id"].startswith("apr_")
    approvals = gateway.pending_approvals("workspace-a")
    assert approvals[0]["arguments"] == {"to": "a@example.com"}
    assert approvals[0]["agent_id"] == "agent-a"
    assert pool.closed is True


def test_approval_decision_is_workspace_scoped_and_denial_never_executes():
    from ultran_backend.errors import NotFound

    gateway = ComposioGateway(api_key="test-key")
    approval = gateway._approval_gate.request("workspace-a", "composio.send_email", "hash")
    gateway._pending_calls[approval.id] = {
        "workspace_id": "workspace-a", "agent_id": "agent-a",
        "tool_name": "send_email", "arguments": {"to": "a@example.com"},
    }
    with pytest.raises(NotFound):
        gateway.decide_approval("workspace-b", approval.id, approved=True)
    result = gateway.decide_approval("workspace-a", approval.id, approved=False)
    assert result["executed"] is False
    assert result["approval"]["state"] == "denied"
    assert approval.id not in gateway._pending_calls
