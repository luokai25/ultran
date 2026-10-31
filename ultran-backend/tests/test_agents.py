"""Agent runtime tests: CRUD, sessions, chat, tool loop."""

from __future__ import annotations

import pytest

from ultran_backend.agents import MAX_HISTORY_TURNS, AgentService
from ultran_backend.brain import BrainRuntime, EchoBackend
from ultran_backend.connectors import ConnectorManifest, ConnectorRegistry, CredentialVault
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


def test_chat_exposes_native_phone_tools_only_to_android_capable_clients(monkeypatch):
    svc = service()
    agent = svc.create(name="Phone-enabled Ultran")
    captured = []
    original_complete = svc.brain.complete

    def capture(messages, **kwargs):
        captured.extend(messages)
        return original_complete(messages, **kwargs)

    monkeypatch.setattr(svc.brain, "complete", capture)
    svc.chat(agent.id, "send a WhatsApp message", client_capabilities=["android_phone_actions"])
    system_prompt = captured[0].content
    assert "ANDROID PHONE ACTIONS" in system_prompt
    assert 'ULTRAN_TOOL_CALL:{"tool":"whatsapp.compose"' in system_prompt
    assert "Never invent a recipient or phone number" in system_prompt
    assert "native approval" in system_prompt


def test_chat_does_not_advertise_native_phone_tools_without_client_capability(monkeypatch):
    svc = service()
    agent = svc.create(name="Web Ultran")
    captured = []
    original_complete = svc.brain.complete

    def capture(messages, **kwargs):
        captured.extend(messages)
        return original_complete(messages, **kwargs)

    monkeypatch.setattr(svc.brain, "complete", capture)
    svc.chat(agent.id, "send a WhatsApp message")
    assert "ANDROID PHONE ACTIONS" not in captured[0].content


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


def test_agent_final_answer_receives_composio_execution_results():
    from ultran_backend.brain import BrainReply
    from ultran_backend.connectors import ConnectorManifest

    class CapturingBrain:
        default_model = "test-model"
        calls = []
        tokens_in = 0
        tokens_out = 0

        def complete(self, messages, *, model, temperature, backend_override=None):
            self.calls.append(messages)
            self.tokens_in += 1
            self.tokens_out += 1
            if len(self.calls) == 2:
                return BrainReply(
                    '{"calls":[{"tool":"search_messages","arguments":{"query":"latest"}}]}',
                    1, 1, model, "test",
                )
            return BrainReply("I found the message you asked for.", 1, 1, model, "test")

    class FakeComposio:
        def plan_and_execute(self, workspace, agent_id, message, planner, *, limit):
            planner("plan using search_messages", message)
            return [{
                "connector": "composio", "action": "search_messages", "ok": True,
                "detail": "Subject: Project update; sender: team@example.com",
            }]

    registry = ConnectorRegistry([
        ConnectorManifest(id="unused", name="Unused", category="test", actions=("noop",))
    ])
    vault = CredentialVault()
    brain = CapturingBrain()
    svc = AgentService(brain, ToolSandbox(registry, vault), vault, composio=FakeComposio())
    agent = svc.create(name="Connected agent", tools=["composio"])

    result = svc.chat(agent.id, "find my latest email", workspace_id="workspace-a")

    assert result["content"] == "I found the message you asked for."
    assert result["tokens_in"] == 4
    assert result["tokens_out"] == 4
    final_messages = brain.calls[-1]
    tool_context = final_messages[-1].content
    assert "Project update" in tool_context
    assert "untrusted tool execution results" in tool_context.lower()
    assert len(svc.session(agent.id, result["session_id"]).messages) == 2


# ------------------------------------------------------ durable agent memory


def test_agents_and_sessions_survive_service_restart(tmp_path):
    from ultran_backend.connectors import ConnectorRegistry, CredentialVault
    from ultran_backend.brain import BrainRuntime, EchoBackend
    from ultran_backend.sandbox import ToolSandbox

    db_path = tmp_path / "agents.sqlite3"
    first = service()
    first._db_path = db_path
    from cryptography.fernet import Fernet
    encryption_key = Fernet.generate_key().decode("ascii")
    first._fernet = Fernet(encryption_key.encode("ascii"))
    first._init_db()
    agent = first.create(name="Persistent Prime", tools=["github"], system_prompt="Remember the project.")
    reply = first.chat(agent.id, "Remember that the release is Friday.", allow_tools=False)
    first.update(agent.id, enabled=False, temperature=0.2)

    registry = ConnectorRegistry(first.sandbox.registry.list())
    second = AgentService(
        BrainRuntime(EchoBackend()), ToolSandbox(registry, CredentialVault()),
        db_path=db_path,
        encryption_key=encryption_key,
    )
    restored = second.get(agent.id)
    restored_session = second.get_session(agent.id, reply["session_id"])

    assert restored.name == "Persistent Prime"
    assert restored.enabled is False
    assert restored.temperature == 0.2
    assert restored.total_runs == 1
    assert restored_session.turns == 1
    assert [m.role for m in restored_session.messages] == ["user", "assistant"]
    assert "Friday" in restored_session.messages[0].content
    with db_path.open("rb") as stored:
        raw_db = stored.read()
    assert b"Remember that the release is Friday." not in raw_db
    assert b"Remember the project." not in raw_db

    from cryptography.fernet import Fernet
    with pytest.raises(RuntimeError, match="cannot be decrypted"):
        AgentService(
            BrainRuntime(EchoBackend()), ToolSandbox(registry, CredentialVault()),
            db_path=db_path, encryption_key=Fernet.generate_key().decode("ascii"),
        )


def test_persistent_session_clear_and_delete_survive_restart(tmp_path):
    db_path = tmp_path / "agents.sqlite3"
    first = service()
    first._db_path = db_path
    first._init_db()
    agent = first.create(name="Persistent")
    reply = first.chat(agent.id, "hello", allow_tools=False)
    first.clear_session(agent.id, reply["session_id"])

    second = AgentService(
        BrainRuntime(EchoBackend()), ToolSandbox(first.sandbox.registry, CredentialVault()),
        db_path=db_path,
    )
    assert second.get_session(agent.id, reply["session_id"]).messages == []
    second.delete_session(agent.id, reply["session_id"])
    second.delete(agent.id)

    third = AgentService(
        BrainRuntime(EchoBackend()), ToolSandbox(first.sandbox.registry, CredentialVault()),
        db_path=db_path,
    )
    with pytest.raises(NotFound):
        third.get(agent.id)


def test_container_wires_durable_encrypted_agent_memory(tmp_path):
    from cryptography.fernet import Fernet
    from ultran_backend.config import Settings
    from ultran_backend.container import Container

    settings = Settings(
        data_dir=tmp_path / "ultran-data",
        credential_encryption_key=Fernet.generate_key().decode("ascii"),
    )
    first = Container.build(settings)
    agent = first.agents.create(name="Ultran Prime", system_prompt="Keep my project context.")
    reply = first.agents.chat(agent.id, "The next milestone is offline mode.", allow_tools=False)
    first.close()

    second = Container.build(settings)
    try:
        restored = second.agents.get(agent.id)
        session = second.agents.get_session(agent.id, reply["session_id"])
        assert restored.system_prompt == "Keep my project context."
        assert session.messages[0].content == "The next milestone is offline mode."
        assert second.agents.get(agent.id).total_runs == 1
    finally:
        second.close()


def test_composio_agent_replans_after_successful_tool_results():
    class MultiStepComposio:
        calls = []

        def plan_and_execute(self, workspace, agent_id, message, planner, *, limit):
            self.calls.append(message)
            planner("Tool catalog: search_messages, get_message", message)
            if len(self.calls) == 1:
                return [{"connector": "composio", "action": "search_messages", "ok": True,
                         "detail": "Found message id msg_123"}]
            if len(self.calls) == 2:
                return [{"connector": "composio", "action": "get_message", "ok": True,
                         "detail": "Message subject: Launch plan"}]
            return []

    registry = ConnectorRegistry([
        ConnectorManifest(id="unused", name="Unused", category="test", actions=("noop",))
    ])
    vault = CredentialVault()
    fake = MultiStepComposio()
    svc = AgentService(BrainRuntime(EchoBackend()), ToolSandbox(registry, vault), vault, composio=fake)
    agent = svc.create(name="Multi-step", tools=["composio"])

    result = svc.chat(agent.id, "find my latest email and read its details", allow_tools=True, max_tool_calls=3)

    assert [call["action"] for call in result["tool_calls"]] == ["search_messages", "get_message"]
    assert len(fake.calls) == 3  # two tool steps, then a final no-more-tools plan
    assert "Found message id msg_123" in fake.calls[1]
    assert "do not repeat" in fake.calls[1].lower()


def test_composio_agent_stops_replanning_when_human_approval_is_required():
    class ApprovalComposio:
        calls = 0

        def plan_and_execute(self, workspace, agent_id, message, planner, *, limit):
            self.calls += 1
            planner("Tool catalog", message)
            return [{"connector": "composio", "action": "send_email", "ok": False,
                     "approval_required": True, "approval_id": "ap_123",
                     "detail": "Waiting for human approval."}]

    registry = ConnectorRegistry([
        ConnectorManifest(id="unused", name="Unused", category="test", actions=("noop",))
    ])
    vault = CredentialVault()
    fake = ApprovalComposio()
    svc = AgentService(BrainRuntime(EchoBackend()), ToolSandbox(registry, vault), vault, composio=fake)
    agent = svc.create(name="Approval-aware", tools=["composio"])

    result = svc.chat(agent.id, "send the email", allow_tools=True, max_tool_calls=3)

    assert fake.calls == 1
    assert result["tool_calls"][0]["approval_required"] is True


def test_agent_memory_is_persistent_workspace_scoped_and_deduplicated(tmp_path):
    from cryptography.fernet import Fernet
    from ultran_backend.brain import BrainRuntime, EchoBackend
    from ultran_backend.connectors import CredentialVault
    from ultran_backend.sandbox import ToolSandbox

    key = Fernet.generate_key().decode("ascii")
    path = tmp_path / "agents.sqlite3"
    first = service()
    first._db_path = path
    first._fernet = Fernet(key.encode("ascii"))
    first._init_db()
    agent = first.create(name="Memory agent")
    item = first.add_memory(agent.id, "workspace-a", "Release target is Friday", category="project")
    duplicate = first.add_memory(agent.id, "workspace-a", "Release target is Friday", category="project")
    first.add_memory(agent.id, "workspace-b", "Different workspace secret")
    assert duplicate.id == item.id

    second = AgentService(
        BrainRuntime(EchoBackend()), ToolSandbox(first.sandbox.registry, CredentialVault()),
        db_path=path, encryption_key=key,
    )
    assert [m.content for m in second.list_memories(agent.id, "workspace-a")] == ["Release target is Friday"]
    assert second.list_memories(agent.id, "workspace-b")[0].content == "Different workspace secret"
    with path.open("rb") as stored:
        raw = stored.read()
    assert b"Release target is Friday" not in raw
    second.delete_memory(agent.id, "workspace-a", item.id)
    assert second.list_memories(agent.id, "workspace-a") == []
    assert second.list_memories(agent.id, "workspace-b")


def test_agent_chat_includes_only_current_workspace_memory():
    from ultran_backend.brain import BrainRuntime, EchoBackend
    from ultran_backend.connectors import CredentialVault
    from ultran_backend.sandbox import ToolSandbox

    class CapturingBackend(EchoBackend):
        def __init__(self):
            self.seen = []

        def complete(self, messages, *, model, temperature):
            self.seen.append(messages[0].content)
            return super().complete(messages, model=model, temperature=temperature)

    backend = CapturingBackend()
    registry = service().sandbox.registry
    svc = AgentService(BrainRuntime(backend), ToolSandbox(registry, CredentialVault()))
    agent = svc.create(name="Memory-aware")
    svc.add_memory(agent.id, "workspace-a", "Project codename is Orion")
    svc.add_memory(agent.id, "workspace-b", "Private other workspace detail")
    svc.chat(agent.id, "What is the project codename?", workspace_id="workspace-a", allow_tools=False)
    assert "Project codename is Orion" in backend.seen[-1]
    assert "Private other workspace detail" not in backend.seen[-1]


def test_agent_memory_api_is_workspace_scoped_and_deletable(client):
    created = client.post("/v1/agents", json={"name": "Memory API agent"})
    assert created.status_code == 201, created.text
    agent_id = created.json()["id"]
    first = client.post(
        f"/v1/agents/{agent_id}/memories", json={"content": "Remember my project is Ultran", "category": "project"},
        headers={"X-Ultran-Workspace": "workspace-a"},
    )
    assert first.status_code == 201, first.text
    memory_id = first.json()["id"]
    assert client.get(
        f"/v1/agents/{agent_id}/memories", headers={"X-Ultran-Workspace": "workspace-b"}
    ).json() == []
    assert client.delete(
        f"/v1/agents/{agent_id}/memories/{memory_id}", headers={"X-Ultran-Workspace": "workspace-b"}
    ).status_code == 404
    assert client.delete(
        f"/v1/agents/{agent_id}/memories/{memory_id}", headers={"X-Ultran-Workspace": "workspace-a"}
    ).status_code == 204


def test_agent_uses_dynamically_discovered_mcp_read_tool():
    import sys
    from pathlib import Path
    from ultran_backend.brain import BrainReply
    from ultran_backend.mcp import McpClientPool, ServerSpec, ToolGateway

    fixture = Path(__file__).parent / "fixtures" / "mcp_fixture_server.py"
    pool = McpClientPool()
    pool.register(ServerSpec(
        id="fixture", name="Fixture", command=sys.executable,
        args=(str(fixture),), trust_level="local", timeout_s=20, connect_timeout_s=20,
    ))
    pool.connect("fixture")
    registry = ConnectorRegistry()
    gateway = ToolGateway(pool)
    registry.attach_mcp(pool, gateway)
    registry.sync_mcp()
    registry.enable("local", "mcp-fixture")

    class PlannedBrain:
        default_model = "fixture-model"
        def __init__(self):
            self.call_count = 0
            self.responses = [
                BrainReply("I will inspect the file.", 1, 1, "fixture-model", "test"),
                BrainReply('{"calls":[{"tool":"fixture.read_file","arguments":{"path":"/tmp/notes.txt"}}]}', 1, 1, "fixture-model", "test"),
                BrainReply('{"calls":[]}', 1, 1, "fixture-model", "test"),
                BrainReply("The file contains the requested information.", 1, 1, "fixture-model", "test"),
            ]
        def complete(self, *args, **kwargs):
            self.call_count += 1
            if self.call_count == 2:
                catalog_prompt = args[0][0].content
                assert "fixture.read_file" in catalog_prompt
                assert "fixture.write_file" not in catalog_prompt
                assert "fixture.delete_path" not in catalog_prompt
            return self.responses.pop(0)

    try:
        svc = AgentService(PlannedBrain(), ToolSandbox(registry, CredentialVault()))
        agent = svc.create(name="MCP Agent", tools=["mcp-fixture"])
        events = []
        result = svc.chat(agent.id, "Read file /tmp/notes.txt", event_callback=events.append)
        calls = [call for call in result["tool_calls"] if call.get("connector") == "mcp"]
        assert len(calls) == 1 and calls[0]["ok"] is True
        assert "contents of /tmp/notes.txt" in calls[0]["detail"]
        assert any(event.get("type") == "tool_started" for event in events)
        assert any(event.get("type") == "tool_completed" for event in events)

        registry.disable("local", "mcp-fixture")
        disabled_svc = AgentService(BrainRuntime(EchoBackend()), ToolSandbox(registry, CredentialVault()))
        disabled_agent = disabled_svc.create(name="Disabled MCP Agent", tools=["mcp-fixture"])
        disabled_result = disabled_svc.chat(disabled_agent.id, "Read file /tmp/notes.txt")
        assert not any(call.get("connector") == "mcp" for call in disabled_result["tool_calls"])
    finally:
        pool.close()


def test_complex_provider_task_uses_shared_capability_contract_and_review_pass(monkeypatch):
    from ultran_backend import agents as agents_module
    from ultran_backend.brain import BrainReply

    svc = service()
    svc.vault.put("local", "groq", KEY)
    agent = svc.create(name="Quality Agent", brain="groq", model="llama-3.3-70b")
    captured = []

    class FakeProviderBackend:
        name = "groq"

        def __init__(self, endpoint, timeout_s=30.0, api_key=None):
            captured.append({"endpoint": endpoint, "api_key": api_key})

        def complete(self, messages, *, model, temperature):
            captured.append({"messages": messages, "model": model, "temperature": temperature})
            if sum(1 for item in captured if "messages" in item) == 1:
                return BrainReply("Draft answer.", 2, 3, model, self.name)
            return BrainReply("Reviewed final answer.", 3, 4, model, self.name)

    monkeypatch.setattr(agents_module, "OpenAICompatBackend", FakeProviderBackend)
    result = svc.chat(agent.id, "Audit and debug this integration", workspace_id="local")

    inference_calls = [item for item in captured if "messages" in item]
    assert result["content"] == "Reviewed final answer."
    assert len(inference_calls) == 2
    assert "CAPABILITY CONTRACT" in inference_calls[0]["messages"][0].content
    assert "TASK MODE: DEEP" in inference_calls[0]["messages"][0].content
    assert "independent quality reviewer" in inference_calls[1]["messages"][0].content
    assert inference_calls[1]["temperature"] <= 0.1


def test_history_budget_preserves_recent_turns_under_a_hard_context_limit():
    from ultran_backend.agents import _budget_history
    from ultran_backend.brain import BrainMessage

    messages = [
        BrainMessage("user", "older context"),
        BrainMessage("assistant", "x" * 500),
        BrainMessage("user", "latest request"),
    ]
    bounded = _budget_history(messages, max_messages=2, max_chars=100)
    assert len(bounded) <= 2
    assert sum(len(item.content) for item in bounded) <= 100
    assert bounded[-1].content == "latest request"
    assert "earlier context omitted" in bounded[0].content
