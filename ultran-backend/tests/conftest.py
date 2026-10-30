"""Test fixtures. Every test gets an isolated container and a temp deploy root."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ultran_backend.app import create_app
from ultran_backend.config import Settings
from ultran_backend.container import Container
from ultran_backend.mcp import (
    ApprovalGate,
    GrantStore,
    McpClientPool,
    ServerSpec,
    ToolGateway,
)

FIXTURE_SERVER = Path(__file__).parent / "fixtures" / "mcp_fixture_server.py"


def fixture_spec(server_id: str = "fixture", **overrides) -> ServerSpec:
    """A real stdio MCP server, spawned from the fixture script."""
    import sys

    base = {
        "id": server_id,
        "name": "Fixture",
        "transport": "stdio",
        "command": sys.executable,
        "args": (str(FIXTURE_SERVER),),
        "trust_level": "local",
        "timeout_s": 20.0,
        "connect_timeout_s": 20.0,
    }
    base.update(overrides)
    return ServerSpec(**base)


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data")


@pytest.fixture()
def container(settings: Settings) -> Container:
    c = Container.build(settings)
    c.seed_default_workspace()
    return c


@pytest.fixture()
def client(settings: Settings, container: Container) -> TestClient:
    app = create_app(settings, container)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def workspace() -> str:
    return "test-ws"


# --------------------------------------------------------------------------- #
# MCP runtime fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def live_pool():
    """One connected MCP pool for the whole module - spawning is the slow part."""
    pool = McpClientPool()
    pool.register(fixture_spec())
    pool.connect("fixture")
    yield pool
    pool.close()


@pytest.fixture()
def gateway(live_pool):
    return ToolGateway(
        live_pool,
        grants=GrantStore(),
        approvals=ApprovalGate(),
        require_grants=True,
    )


@pytest.fixture()
def open_gateway(live_pool):
    """A gateway with grants disabled, for tests about something else."""
    return ToolGateway(live_pool, require_grants=False)
