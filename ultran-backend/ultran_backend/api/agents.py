"""Agents, sessions and chat."""

from __future__ import annotations

from fastapi import APIRouter, status

from ..schemas import (
    AgentCreate,
    AgentOut,
    AgentUpdate,
    ChatReply,
    ChatTurn,
    SessionOut,
    SessionSummary,
)
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentOut])
def list_agents(container: ContainerDep, enabled_only: bool = False):
    return [a.public() for a in container.agents.list(enabled_only=enabled_only)]


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
def create_agent(payload: AgentCreate, container: ContainerDep):
    agent = container.agents.create(
        name=payload.name,
        persona=payload.persona,
        brain=payload.brain,
        model=payload.model,
        tools=payload.tools,
        system_prompt=payload.system_prompt,
        temperature=payload.temperature,
    )
    return agent.public()


@router.get("/{agent_id}", response_model=AgentOut)
def get_agent(agent_id: str, container: ContainerDep):
    return container.agents.get(agent_id).public()


@router.patch("/{agent_id}", response_model=AgentOut)
def update_agent(agent_id: str, payload: AgentUpdate, container: ContainerDep):
    agent = container.agents.update(agent_id, **payload.model_dump(exclude_unset=True))
    return agent.public()


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(agent_id: str, container: ContainerDep):
    container.agents.delete(agent_id)
    return None


@router.post("/{agent_id}/chat", response_model=ChatReply)
def chat(
    agent_id: str,
    payload: ChatTurn,
    container: ContainerDep,
    workspace: WorkspaceDep,
):
    result = container.agents.chat(
        agent_id,
        payload.message,
        session_id=payload.session_id,
        workspace_id=workspace,
        allow_tools=payload.allow_tools,
        max_tool_calls=payload.max_tool_calls,
    )
    # meter the turn against the workspace plan before returning
    container.billing.meter(workspace, result["tokens_in"] + result["tokens_out"])
    return result


@router.get("/{agent_id}/sessions", response_model=list[SessionSummary])
def list_sessions(agent_id: str, container: ContainerDep):
    return [s.summary() for s in container.agents.list_sessions(agent_id)]


@router.get("/{agent_id}/sessions/{session_id}", response_model=SessionOut)
def get_session(agent_id: str, session_id: str, container: ContainerDep):
    return container.agents.get_session(agent_id, session_id).public()


@router.post("/{agent_id}/sessions/{session_id}/clear", response_model=SessionOut)
def clear_session(agent_id: str, session_id: str, container: ContainerDep):
    return container.agents.clear_session(agent_id, session_id).public()


@router.delete("/{agent_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(agent_id: str, session_id: str, container: ContainerDep):
    container.agents.delete_session(agent_id, session_id)
    return None
