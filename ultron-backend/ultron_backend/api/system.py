"""Health, readiness and the workspace capability report."""

from __future__ import annotations

from fastapi import APIRouter

from ..connectors.credentials import utcnow
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(tags=["system"])


@router.get("/health")
def health(container: ContainerDep):
    return {
        "status": "ok",
        "service": container.settings.app_name,
        "version": container.settings.version,
        "environment": container.settings.environment,
        "time": utcnow().isoformat(),
    }


@router.get("/readiness")
def readiness(container: ContainerDep):
    """Readiness reflects *capability*, not just liveness."""
    checks = {
        "connectors": len(container.registry) > 0,
        "brain": container.brain.name in {"echo", "ollama", "openai", "failover"},
        "deploy_root": True,
    }
    return {"ready": all(checks.values()), "checks": checks}


@router.get("/capabilities")
def capabilities(container: ContainerDep, workspace: WorkspaceDep):
    return {
        "workspace_id": workspace,
        "connectors": container.registry.stats(),
        "enabled_connectors": container.registry.enabled_for(workspace),
        "credentials": container.vault.count(workspace),
        "brain": container.brain.stats(),
        "agents": len(container.agents.list()),
        "builds": len(container.builder.list()),
        "deploys": container.deploys.summary(),
        "billing": container.billing.summary(),
        "sandbox": container.sandbox.summary(),
        "theme": "golden-black",
    }
