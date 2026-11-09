"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Request

from ..container import Container

DEFAULT_WORKSPACE = "local"


def get_container(request: Request) -> Container:
    container = getattr(request.app.state, "container", None)
    if container is None:  # pragma: no cover - app always sets this
        raise RuntimeError("container is not initialised")
    return container


def get_workspace(
    request: Request,
    x_ultron_workspace: Annotated[str | None, Header(alias="X-Ultron-Workspace")] = None,
) -> str:
    """Use the authenticated owner session as the production workspace boundary.

    ULTRON currently has one owner workspace. In production, never allow a
    caller-supplied workspace header to select another workspace. Local
    development retains the explicit header for isolated workspaces.
    """
    if getattr(request.state, "owner_id", None):
        return DEFAULT_WORKSPACE
    ws = (x_ultron_workspace or DEFAULT_WORKSPACE).strip() or DEFAULT_WORKSPACE
    if len(ws) > 64:
        ws = ws[:64]
    return ws


ContainerDep = Annotated[Container, Depends(get_container)]
WorkspaceDep = Annotated[str, Depends(get_workspace)]
