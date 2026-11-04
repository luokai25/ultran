"""Billing endpoints - plans, usage, ledger."""

from __future__ import annotations

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field

from ..schemas import ChargeOut, PlanOut, UsageOut
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/billing", tags=["billing"])


class _Meter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tokens: int = Field(ge=0, le=10_000_000)


class _Charge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_cents: int = Field(ge=-10_000_000, le=10_000_000)
    kind: str = Field(default="usage", max_length=32)
    memo: str = Field(default="", max_length=280)
    idempotency_key: str | None = Field(default=None, max_length=128)


class _Subscribe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: str = Field(min_length=2, max_length=32)


@router.get("/plans", response_model=list[PlanOut])
def plans(container: ContainerDep):
    return container.billing.plans()


@router.post("/subscribe", response_model=UsageOut)
def subscribe(payload: _Subscribe, container: ContainerDep, workspace: WorkspaceDep):
    container.billing.subscribe(workspace, payload.plan)
    return container.billing.usage(workspace)


@router.get("/usage", response_model=UsageOut)
def usage(container: ContainerDep, workspace: WorkspaceDep):
    return container.billing.usage(workspace)


@router.post("/meter", response_model=UsageOut)
def meter(payload: _Meter, container: ContainerDep, workspace: WorkspaceDep):
    return container.billing.meter(workspace, payload.tokens)


@router.post("/charges", response_model=ChargeOut, status_code=status.HTTP_201_CREATED)
def charge(payload: _Charge, container: ContainerDep, workspace: WorkspaceDep):
    return container.billing.charge(
        workspace,
        payload.amount_cents,
        kind=payload.kind,
        memo=payload.memo,
        idempotency_key=payload.idempotency_key,
    )


@router.get("/ledger", response_model=list[ChargeOut])
def ledger(container: ContainerDep, workspace: WorkspaceDep):
    return container.billing.ledger(workspace)
