"""Pydantic schemas shared by the HTTP layer and the domain services."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# --------------------------------------------------------------------------- #
# agents
# --------------------------------------------------------------------------- #


class AgentCreate(_Strict):
    name: str = Field(min_length=2, max_length=64)
    persona: str = "ultran"
    system_prompt: str | None = Field(default=None, max_length=8000)
    model: str | None = Field(default=None, max_length=128)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    tools: list[str] = Field(default_factory=list, max_length=64)


class AgentUpdate(_Strict):
    name: str | None = Field(default=None, min_length=2, max_length=64)
    persona: str | None = None
    system_prompt: str | None = Field(default=None, max_length=8000)
    model: str | None = Field(default=None, max_length=128)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    tools: list[str] | None = Field(default=None, max_length=64)
    enabled: bool | None = None


class AgentOut(BaseModel):
    id: str
    name: str
    persona: str
    brain: str
    model: str
    tools: list[str]
    enabled: bool
    created_at: datetime
    total_runs: int
    total_tokens: int


class ChatIn(_Strict):
    message: str = Field(min_length=1, max_length=8000)
    session_id: str | None = Field(default=None, max_length=64)
    max_tool_calls: int = Field(default=3, ge=0, le=16)
    allow_tools: bool = True


class ChatOut(BaseModel):
    session_id: str
    agent_id: str
    content: str
    tokens_in: int
    tokens_out: int
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# connectors
# --------------------------------------------------------------------------- #


class ConnectIn(_Strict):
    connector_id: str = Field(min_length=1, max_length=64)
    api_key: str = Field(min_length=8, max_length=512)
    plan: Literal["free", "paid"] = "free"
    label: str | None = Field(default=None, max_length=64)


class InvokeIn(_Strict):
    connector_id: str = Field(min_length=1, max_length=64)
    action: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# workspace
# --------------------------------------------------------------------------- #


class AvatarMoveIn(_Strict):
    scene: Literal["palace", "forge", "marketplace", "war-room"]
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    emotion: Literal["calm", "focused", "alert", "triumphant"] = "calm"


class SpeakIn(_Strict):
    text: str = Field(min_length=1, max_length=2000)
    voice: str = "ultron"
    rate: float = Field(default=1.0, ge=0.5, le=2.0)


# --------------------------------------------------------------------------- #
# builder
# --------------------------------------------------------------------------- #


class BuildIn(_Strict):
    target: Literal["web", "api", "desktop", "mobile", "function"]
    template: str = Field(default="blank", min_length=1, max_length=64)
    slug: str = Field(min_length=3, max_length=63)
    name: str | None = Field(default=None, max_length=64)
    features: list[str] = Field(default_factory=list, max_length=16)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not SLUG_RE.match(value):
            raise ValueError("slug must be lowercase alphanumeric with single hyphens")
        return value


# --------------------------------------------------------------------------- #
# forge
# --------------------------------------------------------------------------- #


class ForgeIn(_Strict):
    name: str = Field(min_length=1, max_length=64)
    kind: Literal["agent", "connector", "plugin"]
    source: str = Field(min_length=8, max_length=200_000)
    strict: bool = True


# --------------------------------------------------------------------------- #
# billing
# --------------------------------------------------------------------------- #


class SubscribeIn(_Strict):
    plan: Literal["free", "studio", "atelier"]


class MeterIn(_Strict):
    tokens: int = Field(ge=0, le=10_000_000)


class ChargeIn(_Strict):
    amount_cents: int = Field(gt=0, le=10_000_000)
    memo: str | None = Field(default=None, max_length=200)
    idempotency_key: str | None = Field(default=None, max_length=128)


# --------------------------------------------------------------------------- #
# deploys
# --------------------------------------------------------------------------- #


class DeployFile(BaseModel):
    """One file in a deploy manifest.

    ``sha256`` must default to *unset*, not to the empty string: the deploy
    planner treats a declared checksum as an assertion to verify, so an empty
    default would make every file whose checksum the client omitted fail with a
    spurious "checksum mismatch".
    """

    path: str = Field(min_length=1, max_length=512)
    content: str = Field(max_length=2_000_000)
    sha256: str | None = Field(default=None, max_length=64)


class DeployManifest(_Strict):
    slug: str = Field(min_length=3, max_length=63)
    files: list[DeployFile] = Field(min_length=1, max_length=2000)
    env: dict[str, str] = Field(default_factory=dict)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not SLUG_RE.match(value):
            raise ValueError("slug must be lowercase alphanumeric with single hyphens")
        return value


class DeploymentOut(BaseModel):
    """A published release as the API returns it.

    The domain service stamps the release with ``deployed_at`` (the moment the
    bytes went live); the wire contract has always called that field
    ``created_at``. Accept either key so the service record can be returned
    verbatim instead of being remapped at every call site.
    """

    model_config = ConfigDict(populate_by_name=True)

    release_id: str
    slug: str
    version: int
    files: int
    bytes: int
    url: str
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "deployed_at"))
    previous_release_id: str | None = None
    rolled_back: bool = False
