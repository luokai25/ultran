"""Forge endpoints - compile and sign connectors, agents and plugins."""

from __future__ import annotations

from fastapi import APIRouter

from ..forge import KINDS
from ..schemas import ForgeCompile, ForgeResult
from .deps import ContainerDep

router = APIRouter(prefix="/forge", tags=["forge"])


@router.get("/kinds")
def kinds():
    return {"kinds": sorted(KINDS)}


@router.post("/compile", response_model=ForgeResult)
def compile_artifact(payload: ForgeCompile, container: ContainerDep):
    return container.forge.compile(
        name=payload.name,
        kind=payload.kind,
        source=payload.source,
        strict=payload.strict,
    )
