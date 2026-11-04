"""Builder endpoints - scaffold an app from a template."""

from __future__ import annotations

from fastapi import APIRouter, status

from ..builder import TEMPLATES, TARGETS
from ..schemas import BuildArtifact, BuildRequest
from .deps import ContainerDep

router = APIRouter(prefix="/builder", tags=["builder"])


@router.get("/targets")
def targets():
    return {"targets": sorted(TARGETS), "templates": TEMPLATES}


@router.post("/build", response_model=BuildArtifact, status_code=status.HTTP_201_CREATED)
def build(payload: BuildRequest, container: ContainerDep):
    artifact = container.builder.build(
        target=payload.target,
        template=payload.template,
        slug=payload.slug,
        features=payload.features,
    )
    return artifact.public()


@router.get("/builds", response_model=list[BuildArtifact])
def list_builds(container: ContainerDep):
    return [a.public() for a in container.builder.list()]


@router.get("/builds/{build_id}", response_model=BuildArtifact)
def get_build(build_id: str, container: ContainerDep):
    return container.builder.get(build_id).public()
