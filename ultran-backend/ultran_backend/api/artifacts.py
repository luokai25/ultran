"""Artifact creation, listing, preview and download."""
from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from ..schemas import ArtifactCreate
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("")
def list_artifacts(container: ContainerDep, workspace: WorkspaceDep,
                   limit: int = Query(default=50, ge=1, le=200)):
    return {"artifacts": container.artifacts.list(workspace, limit)}


@router.post("", status_code=201)
def create_artifact(payload: ArtifactCreate, container: ContainerDep, workspace: WorkspaceDep):
    return container.artifacts.create(workspace, payload.title, payload.format, payload.content)


@router.get("/{artifact_id}/preview")
def preview_artifact(artifact_id: str, container: ContainerDep, workspace: WorkspaceDep):
    item = container.artifacts.get(workspace, artifact_id)
    path = item.get("preview_path") or item["path"]
    mime = "text/html; charset=utf-8" if item.get("preview_path") else item["mime_type"]
    return FileResponse(path, media_type=mime, filename=item["filename"],
                        content_disposition_type="inline", headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'"})


@router.get("/{artifact_id}/download")
def download_artifact(artifact_id: str, container: ContainerDep, workspace: WorkspaceDep):
    item = container.artifacts.get(workspace, artifact_id)
    return FileResponse(item["path"], media_type=item["mime_type"], filename=item["filename"],
                        content_disposition_type="attachment", headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'"})
