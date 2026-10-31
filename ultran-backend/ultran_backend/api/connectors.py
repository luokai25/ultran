"""Connector marketplace + credential management."""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from ..schemas import ConnectorConnect, ConnectorInvoke, ConnectorOut, CredentialOut
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/connectors", tags=["connectors"])



# --------------------------------------------------------- Composio gateway


@router.get("/composio/status")
def composio_status(container: ContainerDep):
    """Expose configuration state only; never reveal the Composio API key."""
    return {"configured": container.composio.configured, "provider": "composio"}


@router.post("/composio/session")
def composio_session(container: ContainerDep, workspace: WorkspaceDep):
    """Create an MCP session scoped to the current Ultran workspace."""
    return container.composio.create_session(workspace)


@router.post("/composio/authorize/{toolkit}")
def composio_authorize(toolkit: str, container: ContainerDep, workspace: WorkspaceDep):
    """Return a hosted OAuth Connect Link for the selected Composio toolkit."""
    return container.composio.authorize(workspace, toolkit)


@router.get("/composio/connections")
def composio_connections(container: ContainerDep, workspace: WorkspaceDep):
    """List this workspace's connected accounts with credentials redacted."""
    return {"connections": container.composio.list_connections(workspace)}


@router.delete("/composio/connections/{connected_account_id}", status_code=status.HTTP_204_NO_CONTENT)
def composio_revoke(connected_account_id: str, container: ContainerDep):
    """Revoke an account by its Composio ID."""
    container.composio.revoke(connected_account_id)
    return None

@router.get("/stats")
def stats(container: ContainerDep):
    return container.registry.stats()


@router.get("", response_model=list[ConnectorOut])
def list_connectors(
    container: ContainerDep,
    category: str | None = None,
    tier: str | None = None,
    auth_kind: str | None = None,
    search: str | None = None,
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    rows = container.registry.list(
        category=category, tier=tier, auth_kind=auth_kind, search=search, limit=limit, offset=offset
    )
    return [
        {
            "id": m.id,
            "name": m.name,
            "category": m.category,
            "auth_kind": m.auth_kind,
            "tier": m.tier,
            "actions": list(m.actions),
            "description": m.description,
        }
        for m in rows
    ]


@router.post("/{connector_id}/test")
def test_connection(connector_id: str, container: ContainerDep, workspace: WorkspaceDep):
    """Verify a saved AI provider key without generating a billable completion."""
    from ..provider_connections import PROVIDER_PROBES, probe_provider
    from ..errors import ValidationFailed

    if connector_id not in PROVIDER_PROBES:
        raise ValidationFailed(
            "Connection testing is not available for this provider yet.",
            details={"provider": connector_id},
        )
    credential = container.vault.get(workspace, connector_id)
    result = probe_provider(connector_id, credential.reveal())
    credential.touch()
    return result.public()


@router.get("/{connector_id}", response_model=ConnectorOut)
def get_connector(connector_id: str, container: ContainerDep):
    m = container.registry.get(connector_id)
    return {
        "id": m.id,
        "name": m.name,
        "category": m.category,
        "auth_kind": m.auth_kind,
        "tier": m.tier,
        "actions": list(m.actions),
        "description": m.description,
    }


@router.get("/enabled/list")
def enabled(container: ContainerDep, workspace: WorkspaceDep):
    return {"workspace_id": workspace, "enabled": container.registry.enabled_for(workspace)}


@router.post("/{connector_id}/enable", status_code=status.HTTP_204_NO_CONTENT)
def enable(connector_id: str, container: ContainerDep, workspace: WorkspaceDep):
    container.registry.enable(workspace, connector_id)
    return None


@router.post("/{connector_id}/disable", status_code=status.HTTP_204_NO_CONTENT)
def disable(connector_id: str, container: ContainerDep, workspace: WorkspaceDep):
    container.registry.disable(workspace, connector_id)
    return None


@router.post("/connect", response_model=CredentialOut, status_code=status.HTTP_201_CREATED)
def connect(payload: ConnectorConnect, container: ContainerDep, workspace: WorkspaceDep):
    container.registry.get(payload.connector_id)  # 404 before we store anything
    cred = container.vault.put(
        workspace,
        payload.connector_id,
        payload.api_key,
        plan=payload.plan,
        label=payload.label,
    )
    container.registry.enable(workspace, payload.connector_id)
    return {
        "connector_id": cred.connector_id,
        "label": cred.label,
        "plan": cred.plan,
        "masked_key": cred.masked_key,
        "fingerprint": cred.fingerprint,
        "created_at": cred.created_at,
    }


@router.get("/credentials/list", response_model=list[CredentialOut])
def credentials(container: ContainerDep, workspace: WorkspaceDep):
    return [
        {
            "connector_id": c.connector_id,
            "label": c.label,
            "plan": c.plan,
            "masked_key": c.masked_key,
            "fingerprint": c.fingerprint,
            "created_at": c.created_at,
        }
        for c in container.vault.list(workspace)
    ]


@router.delete("/credentials/{connector_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke(
    connector_id: str,
    container: ContainerDep,
    workspace: WorkspaceDep,
    label: str = "default",
):
    container.vault.revoke(workspace, connector_id, label)
    return None


@router.post("/invoke")
def invoke(payload: ConnectorInvoke, container: ContainerDep, workspace: WorkspaceDep):
    result = container.sandbox.invoke(
        workspace, payload.connector_id, payload.action, payload.payload
    )
    return {
        "connector": result.connector,
        "action": result.action,
        "ok": result.ok,
        "output": result.output,
        "latency_ms": result.latency_ms,
        "sensitive": result.sensitive,
    }


@router.get("/audit/log")
def audit(container: ContainerDep, limit: int = Query(default=50, ge=0, le=500)):
    return {"entries": container.sandbox.recent(limit), "summary": container.sandbox.summary()}
