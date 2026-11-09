"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx

from .api import agents, artifacts, billing, builder, connectors, deploys, forge, mcp, system, tools, workspace, tasks
from .config import Settings
from .container import Container
from .errors import UltronError

ROUTERS = (
    system.router,
    agents.router,
    connectors.router,
    mcp.router,
    workspace.router,
    builder.router,
    forge.router,
    billing.router,
    deploys.router,
    tasks.router,
    artifacts.router,
    tools.router,
)


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    built = container or Container.build(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        # MCP sessions are child processes; leaving them running after the daemon
        # exits is how you accumulate orphaned servers.
        built.close()

    app = FastAPI(
        title="Ultron Control Plane",
        version=settings.version,
        description=(
            "Local-first AI agent workspace: connector marketplace, local brain runtime, "
            "tool sandbox, MCP connector runtime, builder, forge, billing and atomic deploys."
        ),
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.container = built
    app.state.settings = settings
    app.state.container.seed_default_workspace()

    # The web workspace runs on its own origin, so without this every fetch from
    # the browser dies as an opaque CORS failure before the handler is reached.
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["Content-Length"],
        )

    @app.middleware("http")
    async def _require_supabase_owner(request: Request, call_next):
        # Health and preflight stay public. Every operational route in production
        # must carry a live Supabase owner session; workspace headers are not auth.
        if not settings.is_production or request.method == "OPTIONS" or request.url.path in {"/", f"{settings.api_prefix}/health"}:
            return await call_next(request)
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            return JSONResponse(status_code=401, content={"error": "owner_session_required"})
        base = settings.supabase_url.rstrip("/")
        headers = {"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token.strip()}"}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0)) as client:
                identity = await client.get(f"{base}/auth/v1/user", headers=headers)
                if identity.status_code in {401, 403}:
                    return JSONResponse(status_code=401, content={"error": "invalid_or_expired_owner_session"})
                identity.raise_for_status()
                identity_body = identity.json()
                owner_id = identity_body.get("id") if isinstance(identity_body, dict) else None
                if not isinstance(owner_id, str) or not owner_id:
                    return JSONResponse(status_code=401, content={"error": "invalid_owner_identity"})
                instance = await client.get(f"{base}/rest/v1/ultron_instance", params={"select": "owner_id", "id": "eq.true"}, headers=headers)
                if instance.status_code in {401, 403}:
                    return JSONResponse(status_code=403, content={"error": "owner_instance_access_denied"})
                instance.raise_for_status()
                rows = instance.json()
                if not isinstance(rows, list) or not any(isinstance(row, dict) and row.get("owner_id") == owner_id for row in rows):
                    return JSONResponse(status_code=403, content={"error": "registered_owner_required"})
                request.state.owner_id = owner_id
        except (httpx.HTTPError, ValueError):
            return JSONResponse(status_code=503, content={"error": "owner_auth_provider_unavailable"})
        return await call_next(request)
    @app.exception_handler(UltronError)
    async def _ultron_error(_: Request, exc: UltronError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.to_payload()},
        )

    for router in ROUTERS:
        app.include_router(router, prefix=settings.api_prefix)

    @app.get("/", include_in_schema=False)
    def _root() -> dict[str, str]:
        return {
            "service": "ultron-backend",
            "version": settings.version,
            "docs": f"{settings.api_prefix}/health",
        }

    return app


app = create_app()
