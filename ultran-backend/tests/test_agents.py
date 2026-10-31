"""Agent runtime tests: CRUD, sessions, chat, tool loop."""

from __future__ import annotations

import pytest

from ultran_backend.agents import MAX_HISTORY_TURNS, AgentService
from ultran_backend.brain import BrainRuntime, EchoBackend
from ultran_backend.connectors import ConnectorRegistry, CredentialVault
from ultran_backend.errors import NotFound, ValidationFailed
from ultran_backend.sandbox import ToolSandbox

KEY = "sk-test-abcdefgh-1234"


def service(*, connectors=("github",)) -> AgentService:
    from ultran_backend.connectors import ConnectorManifest

    reg = ConnectorRegistry(
        [ConnectorManifest(id=c, name=c.title(), category="test", actions=("commit", "list_repos")) for c in connectors]
    )
    vault = CredentialVault()
    sb = ToolSandbox(reg, vault)
    return AgentService(BrainRuntime(EchoBackend()), sb, vault)


# ------------------------------------------------------------------- CRUD


def test_create_returns_a_usable_agent():
    svc = service()
    agent = svc.create(name="Ultran Prime")
    assert agent.id.startswith("ag_")
    assert agent.name == "Ultran Prime"
    assert agent.persona == "ultran"
    assert agent.enabled is True


def test_create_strips_the_name():
    svc = service()
    assert svc.create(name="  Prime  ").name == "Prime"


def test_create_rejects_a_blank_name():
    svc = service()
    with pytest.raises(ValidationFailed, match="name"):
        svc.create(name="   ")


def test_create_rejects_unknown_tools():
    svc = service()
    with pytest.raises(NotFound):
        svc.create(name="Prime", tools=["not-a-connector"])


def test_create_accepts_known_tools():
    svc = service()
    agent = svc.create(name="Prime", tools=["github"])
    assert agent.tools == ["github"]


def test_create_uses_the_runtime_default_model():
    svc = service()
    svc.brain.default_model = "llama3.2"
    assert svc.create(name="Prime").model == "llama3.2"


def test_get_missing_agent_raises():
    svc = service()
    with pytest.raises(NotFound):
        svc.get("ag_missing")


def test_list_is_creation_ordered():
    svc = service()
    first = svc.create(name="One")
    second = svc.create(name="Two")
    assert [a.id for a in svc.list()] == [first.id, second.id]


def test_list_can_filter_to_enabled():
    svc = service()
    a = svc.create(name="One")
    svc.create(name="Two")
    svc.update(a.id, enabled=False)
    assert len(svc.list()) == 2
    assert len(svc.list(enabled_only=True)) == 1


def test_update_changes_fields():
    svc = service()
    a = svc.create(name="One")
    updated = svc.update(a.id, name="Renamed", temperature=1.2, persona="forge")
    assert updated.name == "Renamed"
    assert updated.temperature == 1.2
    assert updated.persona == "forge"


def test_update_rejects_a_blank_name():
    svc = service()
    a = svc.create(name="One")
    with pytest.raises(ValidationFailed):
        svc.update(a.id, name="  ")


def test_update_rejects_unknown_tools():
    svc = service()
    a = svc.create(name="One")
    with pytest.raises(NotFound):
        svc.update(a.id, tools=["ghost"])


def test_update_ignores_none_values():
    svc = service()
    a = svc.create(name="One", persona="ultran")
    svc.update(a.id, name=None, persona=None)
    assert a.name == "One"
    assert a.persona == "ultran"


def test_delete_removes_the_agent_and_its_sessions():
    svc = service()
    a = svc.create(name="One")
    sess = svc.session(a.id)
    svc.delete(a.id)
    assert svc.list() == []
    with pytest.raises(NotFound):
        svc.session(a.id, sess.id)


def test_delete_missing_agent_raises():
    svc = service()
    with pytest.raises(NotFound):
        svc.delete("ag_ghost")


# ----------------------------------------------------------------- session


def test_session_creates_and_reuses():
    svc = service()
    a = svc.create(name="One")
    first = svc.session(a.id)
    assert svc.session(a.id, first.id) is first


def test_session_for_missing_agent_raises():
    svc = service()
    with pytest.raises(NotFound):
        svc.session("ag_ghost")


def test_session_must_belong_to_the_agent():
    svc = service()
    a = svc.create(name="One")
    b = svc.create(name="Two")
    sess = svc.session(a.id)
    with pytest.raises(ValidationFailed, match="does not belong"):
        svc.session(b.id, sess.id)


def test_unknown_session_raises():
    svc = service()
    a = svc.create(name="One")
    with pytest.raises(NotFound):
        svc.session(a.id, "ss_ghost")


def test_session_history_is_bounded():
    svc = service()
    a = svc.create(name="One")
    sess = svc.session(a.id)
    for i in range(MAX_HISTORY_TURNS * 2 + 10):
        sess.append("user", f"m{i}")
    assert len(sess.messages) <= MAX_HISTORY_TURNS * 2


# -------------------------------------------------------------------- chat


def test_chat_returns_content_and_tokens():
    svc = service()
    a = svc.create(name="One")
    result = svc.chat(a.id, "deploy this app")
    assert "Intent: deploy" in result["content"]
    assert result["tokens_in"] > 0
    assert result["tokens_out"] > 0
    assert result["session_id"].startswith("ss_")


def test_chat_keeps_history_across_turns():
    svc = service()
    a = svc.create(name="One")
    first = svc.chat(a.id, "hello")
    second = svc.chat(a.id, "again", session_id=first["session_id"])
    assert second["session_id"] == first["session_id"]
    sess = svc.session(a.id, first["session_id"])
    assert len(sess.messages) == 4


def test_chat_counts_runs_and_tokens_on_the_agent():
    svc = service()
    a = svc.create(name="One")
    svc.chat(a.id, "hello")
    svc.chat(a.id, "hello again")
    assert a.total_runs == 2
    assert a.total_tokens > 0


def test_chat_rejects_a_blank_message():
    svc = service()
    a = svc.create(name="One")
    with pytest.raises(ValidationFailed, match="message"):
        svc.chat(a.id, "   ")


def test_chat_rejects_a_disabled_agent():
    svc = service()
    a = svc.create(name="One")
    svc.update(a.id, enabled=False)
    with pytest.raises(ValidationFailed, match="disabled"):
        svc.chat(a.id, "hello")


def test_chat_on_missing_agent_raises():
    svc = service()
    with pytest.raises(NotFound):
        svc.chat("ag_ghost", "hello")


# --------------------------------------------------------------- tool loop


def test_chat_runs_a_matching_tool():
    svc = service()
    reg = svc.sandbox.registry
    reg.enable("ws", "github")
    svc.sandbox.vault.put("ws", "github", KEY)
    a = svc.create(name="One", tools=["github"])
    result = svc.chat(a.id, "please commit this", workspace_id="ws")
    assert len(result["tool_calls"]) == 1
    assert result["tool_calls"][0]["action"] == "commit"
    assert result["tool_calls"][0]["ok"] is True


def test_chat_skips_tools_when_disallowed():
    svc = service()
    svc.sandbox.registry.enable("ws", "github")
    svc.sandbox.vault.put("ws", "github", KEY)
    a = svc.create(name="One", tools=["github"])
    result = svc.chat(a.id, "please commit this", workspace_id="ws", allow_tools=False)
    assert result["tool_calls"] == []


def test_chat_respects_max_tool_calls():
    svc = service(connectors=("github", "gitlab", "bitbucket"))
    for c in ("github", "gitlab", "bitbucket"):
        svc.sandbox.registry.enable("ws", c)
        svc.sandbox.vault.put("ws", c, KEY)
    a = svc.create(name="One", tools=["github", "gitlab", "bitbucket"])
    result = svc.chat(a.id, "commit everything", workspace_id="ws", max_tool_calls=2)
    assert len(result["tool_calls"]) <= 2


def test_chat_reports_a_denied_tool_without_crashing():
    svc = service()
    a = svc.create(name="One", tools=["github"])
    # connector exists but is not enabled for this workspace and has no credential
    result = svc.chat(a.id, "please commit this", workspace_id="ws")
    assert result["content"]
    assert all(c["ok"] is False for c in result["tool_calls"])


def test_chat_with_no_matching_action_runs_nothing():
    svc = service()
    svc.sandbox.registry.enable("ws", "github")
    svc.sandbox.vault.put("ws", "github", KEY)
    a = svc.create(name="One", tools=["github"])
    result = svc.chat(a.id, "what is the weather", workspace_id="ws")
    assert result["tool_calls"] == []


def test_agent_system_message_lists_its_tools():
    svc = service()
    a = svc.create(name="One", tools=["github"])
    assert "github" in a.system_message()


def test_agent_system_message_uses_the_custom_prompt():
    svc = service()
    a = svc.create(name="One", system_prompt="Be terse.")
    assert a.system_message().startswith("Be terse.")


def test_public_payload_shape():
    svc = service()
    payload = svc.create(name="One").public()
    assert set(payload) == {
        "id",
        "name",
        "persona",
        "brain",
        "model",
        "tools",
        "enabled",
        "created_at",
        "total_runs",
        "total_tokens",
    }



def test_provider_brain_requires_a_saved_workspace_key():
    svc = service()
    agent = svc.create(name="Cloud agent", brain="groq", model="llama-3.3-70b")
    with pytest.raises(NotFound, match="no credential stored"):
        svc.chat(agent.id, "hello", workspace_id="local")


def test_provider_brain_routes_chat_using_workspace_credential(monkeypatch):
    from ultran_backend import agents as agents_module
    from ultran_backend.brain import BrainReply

    svc = service()
    svc.vault.put("local", "groq", KEY)
    agent = svc.create(name="Cloud agent", brain="groq", model="llama-3.3-70b")
    captured = {}

    class FakeProviderBackend:
        name = "openai"

        def __init__(self, endpoint, timeout_s=30.0, api_key=None):
            captured["endpoint"] = endpoint
            captured["api_key"] = api_key

        def complete(self, messages, *, model, temperature):
            captured["model"] = model
            return BrainReply("cloud response", 2, 3, model, self.name)

    monkeypatch.setattr(agents_module, "OpenAICompatBackend", FakeProviderBackend)
    result = svc.chat(agent.id, "hello", workspace_id="local", allow_tools=False)
    assert result["content"] == "cloud response"
    assert captured["endpoint"] == "https://api.groq.com/openai"
    assert captured["api_key"] == KEY
    assert captured["model"] == "llama-3.3-70b"
    assert svc.vault.get("local", "groq").uses == 1



def test_agent_create_accepts_connected_provider_brains():
    svc = service()
    agent = svc.create(name="Groq agent", brain="groq", model="llama-3.3-70b")
    assert agent.brain == "groq"


def test_agent_update_can_change_provider_brain():
    svc = service()
    agent = svc.create(name="Switchable agent")
    updated = svc.update(agent.id, brain="deepseek")
    assert updated.brain == "deepseek"


def test_agent_rejects_unknown_brain_provider():
    svc = service()
    with pytest.raises(ValidationFailed, match="unsupported agent brain"):
        svc.create(name="Unknown agent", brain="made-up-provider")



def test_composio_is_a_valid_virtual_agent_tool_and_enters_execution_loop():
    class FakeComposio:
        called = False
        def plan_and_execute(self, workspace, agent_id, message, planner, *, limit):
            self.called = True
            prompt = "available tool plan instructions"
            planner(prompt, message)
            return [{
                "connector": "composio", "action": "search_messages",
                "ok": True, "detail": "Found one message",
            }]

    from ultran_backend.connectors import ConnectorManifest
    registry = ConnectorRegistry([
        ConnectorManifest(id="github", name="Github", category="test",
                          actions=("commit", "list_repos"))
    ])
    vault = CredentialVault()
    fake = FakeComposio()
    svc = AgentService(BrainRuntime(EchoBackend()), ToolSandbox(registry, vault), vault,
                       composio=fake)
    agent = svc.create(name="Connected agent", tools=["composio"])
    result = svc.chat(agent.id, "find my latest email", workspace_id="ws")
    assert fake.called is True
    assert result["tool_calls"][0]["connector"] == "composio"
    assert "human approval" in agent.system_message().lower()
