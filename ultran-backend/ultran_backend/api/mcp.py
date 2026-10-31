"""MCP server registry, tool index, grants and approvals.

The endpoints the spec's API table names:

    GET    /v1/mcp/servers              registered servers + health
    POST   /v1/mcp/servers              register a server (stdio or HTTP)
    DELETE /v1/mcp/servers/{id}         unregister; closes connections
    POST   /v1/mcp/servers/{id}/probe   re-handshake, refresh tool list
    GET    /v1/mcp/tools                tool index (capability-filtered)

Plus the two the gateway needs to be usable from a client: issuing a grant and
deciding a pending approval. Both are admin actions in the spec's auth table
("registering an MCP server or issuing a grant is a privilege escalation"), which
is why they live here next to registration rather than under ``/connectors``.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from ..mcp import ServerSpec
from ..schemas import (
    ApprovalDecision,
    GrantIssue,
    McpInvoke,
    McpServerRegister,
)
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/mcp", tags=["mcp"])


# --------------------------------------------------------------------------- #
# servers
# --------------------------------------------------------------------------- #


@router.get("/servers")
def list_servers(container: ContainerDep):
    """Registered servers with their live state and the pool's health."""
    return {
        "servers": container.mcp_pool.status(),
        "health": container.mcp_pool.health(),
    }


@router.post("/servers", status_code=status.HTTP_201_CREATED)
def register_server(payload: McpServerRegister, container: ContainerDep, workspace: WorkspaceDep):
    """Register a stdio or HTTP MCP server and handshake it immediately.

    A server that fails its handshake is still registered - it shows up as
    ``failed`` with ``last_error`` set, which is far more useful than a 500 that
    leaves the operator with no record of what they tried.
    """
    spec = ServerSpec.from_dict(payload.model_dump())
    status_payload = container.register_mcp_server(spec, connect=payload.connect)
    connector_id = f"mcp-{spec.id}"
    if connector_id in container.registry:
        container.registry.enable(workspace, connector_id)
    return status_payload


@router.get("/servers/{server_id}")
def get_server(server_id: str, container: ContainerDep):
    return container.mcp_pool.status(server_id)


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def unregister_server(server_id: str, container: ContainerDep):
    container.unregister_mcp_server(server_id)


@router.post("/servers/{server_id}/probe")
def probe_server(server_id: str, container: ContainerDep):
    """Re-handshake and refresh the tool list."""
    return container.probe_mcp_server(server_id)


# --------------------------------------------------------------------------- #
# tool index
# --------------------------------------------------------------------------- #


@router.get("/tools")
def list_tools(
    container: ContainerDep,
    capabilities: str | None = Query(
        default=None,
        description="Comma-separated capability ceiling, e.g. 'read,network'",
    ),
    query: str | None = None,
    server_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=500),
):
    caps = [c.strip() for c in capabilities.split(",") if c.strip()] if capabilities else None
    rows = container.mcp_gateway.list_tools(
        caps,
        query=query,
        limit=limit,
        server_ids=[server_id] if server_id else None,
    )
    return {
        "tools": [spec.as_dict() for spec in rows],
        "count": len(rows),
        "capabilities": caps,
    }


@router.get("/tools/{tool_id:path}")
def get_tool(tool_id: str, container: ContainerDep):
    return container.mcp_gateway.describe(tool_id)


# --------------------------------------------------------------------------- #
# invocation
# --------------------------------------------------------------------------- #


@router.post("/invoke")
def invoke(payload: McpInvoke, container: ContainerDep, workspace: WorkspaceDep):
    """Invoke a tool through the gateway.

    The grant is passed by id so a client never has to hold the signed object.
    A sensitive tool without an approved ``approval_id`` returns
    ``409 approval_pending`` with the id of the approval it just created.
    """
    outcome = container.mcp_gateway.invoke(
        payload.tool,
        payload.arguments,
        workspace_id=workspace,
        grant=payload.grant_id,
        approval=payload.approval_id,
        timeout_s=payload.timeout_s,
    )
    return outcome.as_dict()


# --------------------------------------------------------------------------- #
# grants
# --------------------------------------------------------------------------- #


@router.post("/grants", status_code=status.HTTP_201_CREATED)
def issue_grant(payload: GrantIssue, container: ContainerDep, workspace: WorkspaceDep):
    grant = container.mcp_gateway.issue_grant(
        workspace,
        payload.tool,
        payload.capabilities,
        ttl_s=payload.ttl_s,
        single_use=payload.single_use,
    )
    return grant.as_dict()


@router.get("/grants")
def list_grants(container: ContainerDep, workspace: WorkspaceDep, live_only: bool = False):
    return {
        "grants": [g.as_dict() for g in container.mcp_gateway.grants.list(workspace, live_only=live_only)]
    }


@router.delete("/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_grant(grant_id: str, container: ContainerDep):
    container.mcp_gateway.grants.revoke(grant_id)


# --------------------------------------------------------------------------- #
# approvals
# --------------------------------------------------------------------------- #


@router.get("/approvals")
def list_approvals(container: ContainerDep, workspace: WorkspaceDep):
    return {"approvals": [a.as_dict() for a in container.mcp_gateway.approvals.pending(workspace)]}


@router.get("/approvals/history")
def approval_history(
    container: ContainerDep, workspace: WorkspaceDep,
    limit: int = Query(default=100, ge=0, le=500),
):
    return {"approvals": [a.as_dict() for a in container.mcp_gateway.approvals.history(workspace, limit=limit)]}


@router.post("/approvals/{approval_id}")
def decide_approval(approval_id: str, payload: ApprovalDecision, container: ContainerDep):
    approval = container.mcp_gateway.approvals.decide(
        approval_id, approved=payload.approved, decided_by=payload.decided_by
    )
    return approval.as_dict()


# --------------------------------------------------------------------------- #
# audit
# --------------------------------------------------------------------------- #


@router.get("/audit")
def audit(container: ContainerDep, limit: int = Query(default=50, ge=0, le=500)):
    return {
        "entries": container.mcp_gateway.recent(limit),
        "summary": container.mcp_gateway.summary(),
    }


@router.get("/stats")
def stats(container: ContainerDep):
    return {
        "pool": container.mcp_pool.stats(),
        "gateway": container.mcp_gateway.summary(),
        "registry": container.registry.stats(),
    }
