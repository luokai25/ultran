"""Workspace-scoped background agent task endpoints."""
from __future__ import annotations
from fastapi import APIRouter, Query, status
from ..schemas import AgentTaskCreate, AgentTaskOut
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/tasks", tags=["tasks"])

@router.post("", response_model=AgentTaskOut, status_code=status.HTTP_202_ACCEPTED)
def submit_task(payload: AgentTaskCreate, container: ContainerDep, workspace: WorkspaceDep):
    container.agents.get(payload.agent_id)
    return container.tasks.submit(payload.agent_id, workspace, payload.message,
        allow_tools=payload.allow_tools, max_tool_calls=payload.max_tool_calls).public()

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
