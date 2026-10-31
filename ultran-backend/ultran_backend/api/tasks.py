"""Workspace-scoped background agent task endpoints."""
from __future__ import annotations
import asyncio
import json
from fastapi import APIRouter, Query, status
from fastapi.responses import StreamingResponse
from ..schemas import AgentTaskCreate, AgentTaskOut
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/tasks", tags=["tasks"])

@router.post("", response_model=AgentTaskOut, status_code=status.HTTP_202_ACCEPTED)
def submit_task(payload: AgentTaskCreate, container: ContainerDep, workspace: WorkspaceDep):
    container.agents.get(payload.agent_id)
    if payload.session_id:
        container.agents.get_session(payload.agent_id, payload.session_id)
    return container.tasks.submit(payload.agent_id, workspace, payload.message,
        allow_tools=payload.allow_tools, max_tool_calls=payload.max_tool_calls,
        session_id=payload.session_id).public()

@router.get("", response_model=list[AgentTaskOut])
def list_tasks(container: ContainerDep, workspace: WorkspaceDep,
               limit: int = Query(default=50, ge=0, le=200)):
    return [task.public() for task in container.tasks.list(workspace, limit=limit)]

@router.get("/{task_id}", response_model=AgentTaskOut)
def get_task(task_id: str, container: ContainerDep, workspace: WorkspaceDep):
    return container.tasks.get(workspace, task_id).public()

@router.post("/{task_id}/cancel", response_model=AgentTaskOut)
def cancel_task(task_id: str, container: ContainerDep, workspace: WorkspaceDep):
    return container.tasks.cancel(workspace, task_id).public()

@router.post("/{task_id}/retry", response_model=AgentTaskOut, status_code=status.HTTP_202_ACCEPTED)
def retry_task(task_id: str, container: ContainerDep, workspace: WorkspaceDep):
    return container.tasks.retry(workspace, task_id).public()


@router.get("/{task_id}/events")
async def stream_task_events(task_id: str, container: ContainerDep, workspace: WorkspaceDep,
                             after: int = Query(default=0, ge=0),
                             stream: bool = Query(default=True)):
    """Reconnectable SSE feed or a bounded event snapshot."""
    container.tasks.get(workspace, task_id)  # authorize before returning any task data
    if not stream:
        return {"events": await asyncio.to_thread(container.tasks.events, workspace, task_id, after=after, limit=200)}

    async def stream():
        cursor = after
        idle = 0
        while True:
            rows = await asyncio.to_thread(container.tasks.events, workspace, task_id, after=cursor, limit=100)
            for event in rows:
                cursor = event["id"]
                yield f"id: {cursor}\nevent: progress\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
            task = await asyncio.to_thread(container.tasks.get, workspace, task_id)
            if task.status in {"succeeded", "failed", "cancelled", "interrupted"} and not rows:
                payload = json.dumps({"status": task.status, "task_id": task.id})
                yield f"event: terminal\ndata: {payload}\n\n"
                break
            if not rows:
                idle += 1
                if idle % 15 == 0:
                    yield ": keep-alive\n\n"
                await asyncio.sleep(1)
            else:
                idle = 0

    return StreamingResponse(stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})
