"""Test fixtures. Every test gets an isolated container and a temp deploy root."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ultran_backend.app import create_app
from ultran_backend.config import Settings
from ultran_backend.container import Container


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
