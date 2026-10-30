"""Runtime configuration loaded from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Mapping

_TRUTHY = {"1", "true", "yes", "on"}
_VALID_BRAINS = {"echo", "ollama"}


def _flag(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in _TRUTHY


def _int(value: str | None, default: int) -> int:
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _float(value: str | None, default: float) -> float:
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _origins(value: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
    """Parse a comma-separated CORS allow-list, falling back to ``default``."""
    if value is None or not value.strip():
        return default
    parsed = tuple(o.strip() for o in value.split(",") if o.strip())
    return parsed or default


@dataclass(frozen=True)
class Settings:
    """Immutable runtime settings. Build with :meth:`from_env`."""

    app_name: str = "ultran-backend"
    version: str = "0.4.0"
    environment: str = "dev"
    api_prefix: str = "/v1"
    data_dir: Path = Path(".ultran-data")
    brain_backend: str = "echo"
    brain_endpoint: str = "http://127.0.0.1:11434"
    brain_model: str = "llama3.1:8b"
    brain_timeout_s: float = 30.0
    sandbox_max_ttl_s: int = 900
    sandbox_cpu_ms_budget: int = 2000
    free_plan_monthly_tokens: int = 100_000
    # ---- MCP connector runtime (v2) ----
    #: Servers declared as code: a JSON array of ServerSpec dicts.
    mcp_servers_json: str = ""
    #: A tool is never invoked without a valid grant (spec invariant).
    mcp_require_grants: bool = True
    mcp_grant_ttl_s: int = 900
    mcp_approval_ttl_s: int = 300
    mcp_wall_ms: int = 30_000
    mcp_egress_bytes: int = 32 * 1024 * 1024
    debug: bool = False
    # The web workspace is served from a different origin (3000) than the API
    # (8080), so the browser needs an explicit CORS allow-list. Dev gets the
    # local origins; production must set ULTRAN_CORS_ORIGINS explicitly.
    cors_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    )

    def __post_init__(self) -> None:
        if self.brain_backend not in _VALID_BRAINS:
            raise ValueError(
                f"brain_backend must be one of {sorted(_VALID_BRAINS)}, got {self.brain_backend!r}"
            )
        if not self.api_prefix.startswith("/"):
            raise ValueError("api_prefix must start with '/'")
        if self.sandbox_max_ttl_s <= 0:
            raise ValueError("sandbox_max_ttl_s must be positive")
        if self.free_plan_monthly_tokens < 0:
            raise ValueError("free_plan_monthly_tokens must be >= 0")

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"prod", "production"}

    def with_overrides(self, **changes: object) -> "Settings":
        return replace(self, **changes)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        return cls(
            app_name=e.get("ULTRAN_APP_NAME", "ultran-backend"),
            version=e.get("ULTRAN_VERSION", "0.4.0"),
            environment=e.get("ULTRAN_ENV", "dev"),
            api_prefix=e.get("ULTRAN_API_PREFIX", "/v1"),
            data_dir=Path(e.get("ULTRAN_DATA_DIR", ".ultran-data")),
            brain_backend=e.get("ULTRAN_BRAIN_BACKEND", "echo").strip().lower(),
            brain_endpoint=e.get("ULTRAN_BRAIN_ENDPOINT", "http://127.0.0.1:11434"),
            brain_model=e.get("ULTRAN_BRAIN_MODEL", "llama3.1:8b"),
            brain_timeout_s=_float(e.get("ULTRAN_BRAIN_TIMEOUT_S"), 30.0),
            sandbox_max_ttl_s=_int(e.get("ULTRAN_SANDBOX_MAX_TTL_S"), 900),
            sandbox_cpu_ms_budget=_int(e.get("ULTRAN_SANDBOX_CPU_MS_BUDGET"), 2000),
            free_plan_monthly_tokens=_int(e.get("ULTRAN_FREE_PLAN_MONTHLY_TOKENS"), 100_000),
            mcp_servers_json=e.get("ULTRAN_MCP_SERVERS", ""),
            mcp_require_grants=_flag(e.get("ULTRAN_MCP_REQUIRE_GRANTS"), True),
            mcp_grant_ttl_s=_int(e.get("ULTRAN_MCP_GRANT_TTL_S"), 900),
            mcp_approval_ttl_s=_int(e.get("ULTRAN_MCP_APPROVAL_TTL_S"), 300),
            mcp_wall_ms=_int(e.get("ULTRAN_MCP_WALL_MS"), 30_000),
            mcp_egress_bytes=_int(e.get("ULTRAN_MCP_EGRESS_BYTES"), 32 * 1024 * 1024),
            debug=_flag(e.get("ULTRAN_DEBUG"), False),
            cors_origins=_origins(e.get("ULTRAN_CORS_ORIGINS"), cls().cors_origins),
        )
