"""Unified searchable index of native, connector and MCP tools."""
from __future__ import annotations

from fastapi import APIRouter, Query

from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/tools", tags=["tools"])

NATIVE_TOOLS = [
    {"id": f"artifacts.create_{fmt}", "name": f"Create {label}",
     "description": f"Generate a workspace-scoped {label.lower()} with preview or download access.",
     "source": "native", "category": "file-generation", "format": fmt,
     "capabilities": ["file.write"], "requires_approval": False}
    for fmt, label in (("pdf", "PDF"), ("pptx", "PowerPoint"), ("docx", "Word"),
                       ("xlsx", "Excel"), ("html", "HTML"), ("md", "Markdown"),
                       ("txt", "Text"), ("csv", "CSV"), ("json", "JSON"), ("svg", "SVG"))
]


@router.get("/catalog")
def search_catalog(
    container: ContainerDep,
    workspace: WorkspaceDep,
    query: str | None = None,
    source: str | None = None,
    limit: int = Query(default=40, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=100000),
):
    """Search the catalog; only selected tools are sent to an agent per task."""
    needle = (query or "").strip().lower()
    rows: list[dict] = []
    if source in (None, "native"):
        rows.extend(NATIVE_TOOLS)
    if source in (None, "connector"):
        enabled = set(container.registry.enabled_for(workspace))
        for manifest in container.registry.list():
            if manifest.is_mcp:
                continue
            for action in manifest.actions:
                rows.append({
                    "id": f"{manifest.id}.{action}", "name": f"{manifest.name}: {action.replace('_', ' ')}",
                    "description": manifest.description, "source": "connector",
                    "category": manifest.category, "capabilities": list(manifest.capabilities),
                    "enabled": manifest.id in enabled,
                    "requires_approval": action in {"delete", "send_email", "publish", "create_charge", "create_deployment"},
                })
    if source in (None, "mcp"):
        enabled_mcp = [m.mcp_server_id for m in container.registry.mcp_connectors()
                       if m.id in set(container.registry.enabled_for(workspace))]
        for spec in container.mcp_gateway.list_tools(server_ids=enabled_mcp):
            rows.append({**spec.as_dict(), "source": "mcp", "category": "mcp",
                         "capabilities": sorted(spec.capabilities), "requires_approval": spec.requires_approval})
    if needle:
        terms = [part for part in needle.split() if part]
        def score(row: dict) -> int:
            haystack = " ".join(str(row.get(k, "")) for k in ("id", "name", "title", "description", "category", "format")).lower()
            return sum((12 if term in str(row.get("id", "")).lower() else 6 if term in str(row.get("name", "")).lower() else 2) for term in terms if term in haystack)
        rows = [row for row in rows if score(row) > 0]
        rows.sort(key=lambda row: (-score(row), row["id"]))
    else:
        rows.sort(key=lambda row: (row.get("source", ""), row["id"]))
    total = len(rows)
    page = rows[offset:offset + limit]
    return {"tools": page, "count": len(page), "total": total, "limit": limit,
            "offset": offset, "has_more": offset + len(page) < total}
