"""FastAPI application factory."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import agents, billing, builder, connectors, deploys, forge, system, workspace
from .config import Settings
from .container import Container
from .errors import UltranError

ROUTERS = (
    system.router,
    agents.router,
    connectors.router,
    workspace.router,
    builder.router,
    forge.router,
    billing.router,
    deploys.router,
)


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(
        title="Ultran Control Plane",
        version=settings.version,
        description=(
            "Local-first AI agent workspace: connector marketplace, local brain runtime, "
            "tool sandbox, builder, forge, billing and atomic deploys."
        ),
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )
    app.state.container = container or Container.build(settings)
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
