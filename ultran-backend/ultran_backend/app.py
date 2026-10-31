"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import agents, artifacts, billing, builder, connectors, deploys, forge, mcp, system, tools, workspace, tasks
from .config import Settings
from .container import Container
from .errors import UltranError

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
        title="Ultran Control Plane",
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

    @app.exception_handler(UltranError)
    async def _ultran_error(_: Request, exc: UltranError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.to_payload()},
        )

    for router in ROUTERS:
        app.include_router(router, prefix=settings.api_prefix)

    @app.get("/", include_in_schema=False)
    def _root() -> dict[str, str]:
        return {
            "service": "ultran-backend",
            "version": settings.version,
            "docs": f"{settings.api_prefix}/health",
        }

    return app


app = create_app()
