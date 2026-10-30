"""Deployment endpoints - publish, roll back, inspect."""

from __future__ import annotations

from fastapi import APIRouter, status

from ..schemas import DeployManifest, DeploymentOut
from .deps import ContainerDep

router = APIRouter(prefix="/deploys", tags=["deploys"])


@router.post("", response_model=DeploymentOut, status_code=status.HTTP_201_CREATED)
def deploy(payload: DeployManifest, container: ContainerDep):
    files = [f.model_dump() for f in payload.files]
    return container.deploys.deploy(payload.slug, files)


@router.get("")
def list_slugs(container: ContainerDep):
    return {"slugs": container.deploys.list_slugs(), "summary": container.deploys.summary()}


@router.get("/{slug}", response_model=DeploymentOut)
def live(slug: str, container: ContainerDep):
    return container.deploys.live(slug)


@router.get("/{slug}/releases", response_model=list[DeploymentOut])
def releases(slug: str, container: ContainerDep):
    return container.deploys.releases(slug)


@router.post("/{slug}/rollback", response_model=DeploymentOut)
def rollback(slug: str, container: ContainerDep):
    return container.deploys.rollback(slug)
