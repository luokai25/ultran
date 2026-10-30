"""Agent runtime: persona, session memory, and the tool-calling loop."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .brain import BrainMessage, BrainRuntime, OpenAICompatBackend
from .provider_connections import PROVIDER_CHAT_BASE_URLS
from .connectors.credentials import utcnow
from .errors import NotFound, ValidationFailed
from .sandbox import ToolSandbox

MAX_HISTORY_TURNS = 24


@dataclass
class Session:
    id: str
    agent_id: str
    messages: list[BrainMessage] = field(default_factory=list)
    created_at: datetime = field(default_factory=utcnow)
    turns: int = 0

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "created_at": self.created_at,
            "turns": self.turns,
            "messages": [{"role": m.role, "content": m.content} for m in self.messages],
        }

    def summary(self) -> dict[str, Any]:
        last = self.messages[-1].content if self.messages else ""
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "created_at": self.created_at,
            "turns": self.turns,
            "preview": last[:120],
        }

    def append(self, role: str, content: str) -> None:
        self.messages.append(BrainMessage(role=role, content=content))
        # keep the tail bounded so a long session cannot blow the context window
        if len(self.messages) > MAX_HISTORY_TURNS * 2:
            self.messages = self.messages[-MAX_HISTORY_TURNS * 2 :]


@dataclass
class Agent:
    id: str
    name: str
    persona: str
    brain: str
    model: str
    tools: list[str] = field(default_factory=list)
    system_prompt: str = ""
    temperature: float = 0.4
    enabled: bool = True
    created_at: datetime = field(default_factory=utcnow)
    total_runs: int = 0
    total_tokens: int = 0

    def system_message(self) -> str:
        base = self.system_prompt or f"You are {self.name} ({self.persona}), a local Ultran agent."
        if self.tools:
            return f"{base} You may call these tools: {', '.join(self.tools)}."
        return base

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "persona": self.persona,
            "brain": self.brain,
            "model": self.model,
            "tools": list(self.tools),
            "enabled": self.enabled,
            "created_at": self.created_at,
            "total_runs": self.total_runs,
            "total_tokens": self.total_tokens,
        }


class AgentService:
    """Owns agents and their sessions. Every mutation is validated first."""

    def __init__(self, brain: BrainRuntime, sandbox: ToolSandbox, vault=None) -> None:
        self.brain = brain
        self.sandbox = sandbox
        self.vault = vault
        self._agents: dict[str, Agent] = {}
        self._sessions: dict[str, Session] = {}

    # ------------------------------------------------------------------ #
    def create(
        self,
        *,
        name: str,
        persona: str = "ultran",
        brain: str = "echo",
        model: str | None = None,
        tools: list[str] | None = None,
        system_prompt: str = "",
        temperature: float = 0.4,
    ) -> Agent:
        if not name.strip():
            raise ValidationFailed("agent name must not be empty")
        if brain not in {"echo", "ollama", "openai", *PROVIDER_CHAT_BASE_URLS.keys()}:
            raise ValidationFailed("unsupported agent brain provider", details={"provider": brain})
        tool_list = [t for t in (tools or []) if t.strip()]
        for tool_id in tool_list:
            # fail fast: an agent may only be given connectors that exist
            self.sandbox.registry.get(tool_id)
        agent = Agent(
            id=f"ag_{uuid.uuid4().hex[:12]}",
            name=name.strip(),
            persona=persona,
            brain=brain,
            model=model or self.brain.default_model,
            tools=tool_list,
            system_prompt=system_prompt,
            temperature=temperature,
        )
        self._agents[agent.id] = agent
        return agent

    def get(self, agent_id: str) -> Agent:
        try:
            return self._agents[agent_id]
        except KeyError:
            raise NotFound("agent not found", details={"agent_id": agent_id}) from None

    def list(self, *, enabled_only: bool = False) -> list[Agent]:
        rows = [a for a in self._agents.values() if not enabled_only or a.enabled]
        return sorted(rows, key=lambda a: a.created_at)

    def update(self, agent_id: str, **changes: Any) -> Agent:
        agent = self.get(agent_id)
        if "name" in changes and changes["name"] is not None:
            if not str(changes["name"]).strip():
                raise ValidationFailed("agent name must not be empty")
            agent.name = str(changes["name"]).strip()
        if changes.get("brain") is not None:
            brain = str(changes["brain"])
            if brain not in {"echo", "ollama", "openai", *PROVIDER_CHAT_BASE_URLS.keys()}:
                raise ValidationFailed("unsupported agent brain provider", details={"provider": brain})
            agent.brain = brain
        if changes.get("persona") is not None:
            agent.persona = changes["persona"]
        if changes.get("model") is not None:
            agent.model = changes["model"]
        if changes.get("system_prompt") is not None:
            agent.system_prompt = changes["system_prompt"]
        if changes.get("temperature") is not None:
            agent.temperature = float(changes["temperature"])
        if changes.get("enabled") is not None:
            agent.enabled = bool(changes["enabled"])
        if changes.get("tools") is not None:
            new_tools = [t for t in changes["tools"] if t.strip()]
            for tool_id in new_tools:
                self.sandbox.registry.get(tool_id)
            agent.tools = new_tools
        return agent

    def delete(self, agent_id: str) -> None:
        self.get(agent_id)
        del self._agents[agent_id]
        for sid in [s.id for s in self._sessions.values() if s.agent_id == agent_id]:
            del self._sessions[sid]

    # ------------------------------------------------------------------ #
    def session(self, agent_id: str, session_id: str | None = None) -> Session:
        self.get(agent_id)
        if session_id:
            try:
                sess = self._sessions[session_id]
            except KeyError:
                raise NotFound("session not found", details={"session_id": session_id}) from None
            if sess.agent_id != agent_id:
                raise ValidationFailed(
                    "session does not belong to this agent", details={"session_id": session_id}
                )
            return sess
        sess = Session(id=f"ss_{uuid.uuid4().hex[:12]}", agent_id=agent_id)
        self._sessions[sess.id] = sess
        return sess

    def list_sessions(self, agent_id: str) -> list[Session]:
        """Sessions for one agent, newest first."""
        self.get(agent_id)
        rows = [s for s in self._sessions.values() if s.agent_id == agent_id]
        return sorted(rows, key=lambda s: s.created_at, reverse=True)

    def get_session(self, agent_id: str, session_id: str) -> Session:
        return self.session(agent_id, session_id)

    def clear_session(self, agent_id: str, session_id: str) -> Session:
        """Drop the transcript but keep the session id, so a client can reset context."""
        sess = self.session(agent_id, session_id)
        sess.messages = []
        sess.turns = 0
        return sess

    def delete_session(self, agent_id: str, session_id: str) -> None:
        sess = self.session(agent_id, session_id)
        del self._sessions[sess.id]

    def chat(
        self,
        agent_id: str,
        message: str,
        *,
        session_id: str | None = None,
        workspace_id: str = "local",
        allow_tools: bool = True,
        max_tool_calls: int = 4,
    ) -> dict[str, Any]:
        agent = self.get(agent_id)
        if not agent.enabled:
            raise ValidationFailed("agent is disabled", details={"agent_id": agent_id})
        if not message.strip():
            raise ValidationFailed("message must not be empty")

        session = self.session(agent_id, session_id)
        session.append("user", message)
        session.turns += 1

        messages = [BrainMessage("system", agent.system_message()), *session.messages]
        backend_override = None
        if agent.brain in PROVIDER_CHAT_BASE_URLS:
            if self.vault is None:
                raise ValidationFailed("provider credentials are unavailable")
            credential = self.vault.get(workspace_id, agent.brain)
            backend_override = OpenAICompatBackend(
                PROVIDER_CHAT_BASE_URLS[agent.brain],
                api_key=credential.reveal(),
            )
            backend_override.name = agent.brain
            credential.touch()
        elif agent.brain not in {"echo", "ollama", "openai"}:
            raise ValidationFailed("unsupported agent brain provider", details={"provider": agent.brain})
        reply = self.brain.complete(
            messages, model=agent.model, temperature=agent.temperature,
            backend_override=backend_override,
        )
        session.append("assistant", reply.content)

        tool_calls: list[dict[str, Any]] = []
        if allow_tools and agent.tools and max_tool_calls > 0:
            tool_calls = self._run_tools(
                agent, workspace_id, message, limit=max_tool_calls
            )

        agent.total_runs += 1
        agent.total_tokens += reply.tokens_in + reply.tokens_out

        return {
            "session_id": session.id,
            "agent_id": agent.id,
            "content": reply.content,
            "tokens_in": reply.tokens_in,
            "tokens_out": reply.tokens_out,
            "finish_reason": reply.finish_reason,
            "tool_calls": tool_calls,
        }

    def _run_tools(
        self, agent: Agent, workspace_id: str, message: str, *, limit: int
    ) -> list[dict[str, Any]]:
        """Deterministically choose up to ``limit`` declared actions to exercise.

        The echo brain is not a function-calling model, so intent is matched
        against the actions the agent actually holds. Anything not enabled or not
        credentialed is skipped rather than forced - a denied call is not a tool
        call, it is a policy outcome, and the sandbox audit records it.
        """
        low = message.lower()
        results: list[dict[str, Any]] = []
        for connector_id in agent.tools:
            if len(results) >= limit:
                break
            try:
                manifest = self.sandbox.registry.get(connector_id)
            except NotFound:
                continue
            chosen = None
            for action in manifest.actions:
                if action.replace("_", " ") in low or action in low:
                    chosen = action
                    break
            if chosen is None and "sync" in low:
                chosen = manifest.actions[0]
            if chosen is None:
                continue
            try:
                out = self.sandbox.invoke(workspace_id, connector_id, chosen, {"source": "agent"})
            except NotFound as exc:
                results.append(
                    {"connector": connector_id, "action": chosen, "ok": False, "detail": exc.message}
                )
                continue
            results.append(
                {
                    "connector": connector_id,
                    "action": chosen,
                    "ok": out.ok,
                    "latency_ms": out.latency_ms,
                    "detail": "ok" if out.ok else out.error,
                }
            )
        return results
