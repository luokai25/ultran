"""Agents, sessions and chat."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, status
from fastapi.responses import StreamingResponse

from ..schemas import (
    AgentCreate,
    AgentMemoryCreate,
    AgentMemoryOut,
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


@router.get("/{agent_id}/memories", response_model=list[AgentMemoryOut])
def list_memories(agent_id: str, container: ContainerDep, workspace: WorkspaceDep):
    return [m.public() for m in container.agents.list_memories(agent_id, workspace)]


@router.post("/{agent_id}/memories", response_model=AgentMemoryOut, status_code=status.HTTP_201_CREATED)
def add_memory(
    agent_id: str, payload: AgentMemoryCreate, container: ContainerDep, workspace: WorkspaceDep,
):
    return container.agents.add_memory(
        agent_id, workspace, payload.content, category=payload.category,
    ).public()


@router.delete("/{agent_id}/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(
    agent_id: str, memory_id: str, container: ContainerDep, workspace: WorkspaceDep,
):
    container.agents.delete_memory(agent_id, workspace, memory_id)
    return None


@router.delete("/{agent_id}/memories", status_code=status.HTTP_200_OK)
def clear_memories(agent_id: str, container: ContainerDep, workspace: WorkspaceDep):
    return {"deleted": container.agents.clear_memories(agent_id, workspace)}


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
        client_capabilities=payload.client_capabilities,
    )
    # meter the turn against the workspace plan before returning
    container.billing.meter(workspace, result["tokens_in"] + result["tokens_out"])
    return result


@router.post("/{agent_id}/chat/stream")
async def chat_stream(
    agent_id: str, payload: ChatTurn, container: ContainerDep, workspace: WorkspaceDep,
):
    """Stream agent planning, tool activity, artifact creation and final output as SSE."""
    loop = asyncio.get_running_loop()
    events: asyncio.Queue = asyncio.Queue()

    def publish(event) -> None:
        loop.call_soon_threadsafe(events.put_nowait, event)

    def execute() -> None:
        try:
            result = container.agents.chat(
                agent_id, payload.message, session_id=payload.session_id,
                workspace_id=workspace, allow_tools=payload.allow_tools,
                max_tool_calls=payload.max_tool_calls, client_capabilities=payload.client_capabilities, event_callback=publish,
            )
            container.billing.meter(workspace, result["tokens_in"] + result["tokens_out"])
            publish({"type": "final", "result": result})
        except Exception as exc:
            from ..errors import UltranError
            if isinstance(exc, UltranError):
                error = exc.to_payload()
            else:
                error = {"code": "agent_error", "message": str(exc)[:500], "details": {}}
            publish({"type": "error", "error": error})
        finally:
            publish(None)

    worker = asyncio.create_task(asyncio.to_thread(execute))

    async def stream():
        while True:
            try:
                event = await asyncio.wait_for(events.get(), timeout=15)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                break
            yield "data: " + json.dumps(event, ensure_ascii=False, default=str) + "\n\n"
        await worker

    return StreamingResponse(
        stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


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
