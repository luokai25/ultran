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
    x_ultran_workspace: Annotated[str | None, Header(alias="X-Ultran-Workspace")] = None,
) -> str:
    """Workspace scoping.

    Ultran is local-first: the default workspace is the machine itself. A caller
    that runs several workspaces passes the header and every service keys off it.
    """
    ws = (x_ultran_workspace or DEFAULT_WORKSPACE).strip() or DEFAULT_WORKSPACE
    if len(ws) > 64:
        ws = ws[:64]
    return ws


ContainerDep = Annotated[Container, Depends(get_container)]
WorkspaceDep = Annotated[str, Depends(get_workspace)]
