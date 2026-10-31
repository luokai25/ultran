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
    persona: str = Field(default="ultran", min_length=2, max_length=64)
    brain: str = Field(default="echo", min_length=2, max_length=64)
    model: str = Field(default="llama3.1:8b", max_length=96)
    tools: list[str] = Field(default_factory=list)
    system_prompt: str = Field(default="", max_length=8000)
    temperature: float = Field(default=0.4, ge=0.0, le=2.0)

    @field_validator("name", "persona")
    @classmethod
    def _no_control_chars(cls, value: str) -> str:
        if any(ord(ch) < 32 for ch in value):
            raise ValueError("control characters are not allowed")
        return value

    @field_validator("tools")
    @classmethod
    def _dedupe_tools(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for item in value:
            if item not in seen:
                seen.append(item)
        return seen


class AgentUpdate(_Strict):
    brain: str | None = Field(default=None, min_length=2, max_length=64)
    name: str | None = Field(default=None, min_length=2, max_length=64)
    persona: str | None = None
    model: str | None = None
    tools: list[str] | None = None
    system_prompt: str | None = Field(default=None, max_length=8000)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
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
    total_runs: int = 0
    total_tokens: int = 0


class AgentMemoryCreate(_Strict):
    content: str = Field(min_length=1, max_length=5000)
    category: str = Field(default="general", min_length=1, max_length=48)


class AgentMemoryOut(BaseModel):
    id: str
    agent_id: str
    workspace_id: str
    content: str
    category: str
    created_at: datetime
    updated_at: datetime


class ChatTurn(_Strict):
    message: str = Field(min_length=1, max_length=16_000)
    session_id: str | None = Field(default=None, max_length=64)
    allow_tools: bool = True
    max_tool_calls: int = Field(default=4, ge=0, le=16)


class SessionMessage(BaseModel):
    role: str
    content: str


class SessionSummary(BaseModel):
    id: str
    agent_id: str
    created_at: datetime
    turns: int = 0
    preview: str = ""


class SessionOut(BaseModel):
    id: str
    agent_id: str
    created_at: datetime
    turns: int = 0
    messages: list[SessionMessage] = Field(default_factory=list)


class ToolCallRecord(BaseModel):
    connector: str
    action: str
    ok: bool
    latency_ms: int = 0
    detail: str = ""


class ChatReply(BaseModel):
    session_id: str
    agent_id: str
    content: str
    tokens_in: int
    tokens_out: int
    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    finish_reason: str = "stop"


# --------------------------------------------------------------------------- #
# connectors
# --------------------------------------------------------------------------- #


class ConnectorOut(BaseModel):
    id: str
    name: str
    category: str
    auth_kind: str
    tier: str
    actions: list[str] = Field(default_factory=list)
    description: str = ""
    #: ``builtin`` (frozen catalog) or ``mcp`` (a discovered MCP server).
    source: str = "builtin"
    mcp_server_id: str = ""
    transport: str = ""
    capabilities: list[str] = Field(default_factory=list)


class ConnectorConnect(_Strict):
    connector_id: str = Field(min_length=2, max_length=64)
    api_key: str = Field(min_length=4, max_length=4096)
    plan: Literal["free", "paid"] = "free"
    label: str = Field(default="default", max_length=64)


class CredentialOut(BaseModel):
    connector_id: str
    label: str
    plan: str
    masked_key: str
    fingerprint: str
    created_at: datetime


class ConnectorInvoke(_Strict):
    connector_id: str = Field(min_length=2, max_length=64)
    action: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# MCP
# --------------------------------------------------------------------------- #

#: MCP server ids become connector ids, so they share the connector alphabet.
MCP_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,47}$")


class McpServerRegister(_Strict):
    """Register a stdio or Streamable HTTP MCP server.

    ``env`` and ``headers`` carry the server's own credentials. They are stored
    with the server spec and handed to the child process - never to a tool call.
    """

    id: str = Field(min_length=1, max_length=48)
    name: str = Field(default="", max_length=96)
    transport: Literal["stdio", "http"] = "stdio"
    command: str = Field(default="", max_length=512)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    cwd: str | None = Field(default=None, max_length=1024)
    url: str = Field(default="", max_length=2048)
    headers: dict[str, str] = Field(default_factory=dict)
    trust_level: Literal["untrusted", "third_party", "verified", "curated", "local"] = "third_party"
    pinned_hash: str = Field(default="", max_length=80)
    enabled: bool = True
    timeout_s: float = Field(default=30.0, gt=0, le=600)
    connect_timeout_s: float = Field(default=10.0, gt=0, le=120)
    egress: dict[str, Any] = Field(default_factory=dict)
    capabilities: list[str] = Field(default_factory=list)
    description: str = Field(default="", max_length=512)
    #: Handshake immediately. ``False`` registers a server you will probe later.
    connect: bool = True

    @field_validator("id")
    @classmethod
    def _valid_id(cls, value: str) -> str:
        if not MCP_ID_RE.match(value):
            raise ValueError("server id must be lowercase alphanumeric with '.', '_' or '-'")
        return value

    @field_validator("command")
    @classmethod
    def _no_shell_metachars(cls, value: str) -> str:
        # The command is exec'd, not shell'd, but a stray ';' in a config file is
        # almost always a mistake worth catching at the boundary.
        if any(ch in value for ch in (";", "|", "&", "`", "$(")):
            raise ValueError("command must not contain shell metacharacters")
        return value


class McpInvoke(_Strict):
    tool: str = Field(min_length=1, max_length=160)
    arguments: dict[str, Any] = Field(default_factory=dict)
    grant_id: str | None = Field(default=None, max_length=64)
    approval_id: str | None = Field(default=None, max_length=64)
    timeout_s: float | None = Field(default=None, gt=0, le=600)


class GrantIssue(_Strict):
    tool: str = Field(min_length=1, max_length=160)
    capabilities: list[str] | None = None
    ttl_s: int | None = Field(default=None, ge=1, le=86_400)
    single_use: bool = False


class ApprovalDecision(_Strict):
    approved: bool
    decided_by: str = Field(default="user", max_length=64)


# --------------------------------------------------------------------------- #
# workspace / avatar / voice
# --------------------------------------------------------------------------- #


class AvatarState(BaseModel):
    persona: str
    scene: Literal["palace", "forge", "marketplace", "war-room"]
    emotion: Literal["calm", "focused", "alert", "triumphant"]
    position: tuple[float, float, float]
    palette: dict[str, str]


class AvatarMove(_Strict):
    scene: Literal["palace", "forge", "marketplace", "war-room"]
    x: float = Field(default=0.0, ge=-40.0, le=40.0)
    y: float = Field(default=0.0, ge=-40.0, le=40.0)
    z: float = Field(default=0.0, ge=-40.0, le=40.0)
    emotion: Literal["calm", "focused", "alert", "triumphant"] = "calm"


class VoiceLine(_Strict):
    text: str = Field(min_length=1, max_length=1200)
    voice: Literal["ultron", "narrator", "operator"] = "ultron"
    speed: float = Field(default=0.95, ge=0.5, le=2.0)
    pitch: float = Field(default=-2.0, ge=-12.0, le=12.0)


class VoiceRendered(BaseModel):
    voice: str
    duration_s: float
    syllables: int
    phonemes: list[str]
    ssml: str


# --------------------------------------------------------------------------- #
# builder / forge
# --------------------------------------------------------------------------- #


class BuildRequest(_Strict):
    target: Literal["web", "api", "desktop", "mobile", "function"] = "web"
    template: str = Field(default="blank", max_length=64)
    slug: str = Field(min_length=3, max_length=63)
    features: list[str] = Field(default_factory=list)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not SLUG_RE.match(value):
            raise ValueError("slug must be lowercase alphanumeric with single hyphens")
        return value


class BuildArtifact(BaseModel):
    id: str
    slug: str
    target: str
    template: str
    files: dict[str, str]
    file_count: int
    bytes: int
    created_at: datetime


class ForgeCompile(_Strict):
    name: str = Field(min_length=2, max_length=64)
    kind: Literal["connector", "agent", "plugin"] = "connector"
    source: str = Field(min_length=16, max_length=200_000)
    strict: bool = True


class ForgeResult(BaseModel):
    name: str
    kind: str
    ok: bool
    diagnostics: list[str] = Field(default_factory=list)
    export: dict[str, Any] = Field(default_factory=dict)
    checksum: str


# --------------------------------------------------------------------------- #
# deployments
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


# --------------------------------------------------------------------------- #
# billing
# --------------------------------------------------------------------------- #


class PlanOut(BaseModel):
    id: str
    name: str
    monthly_tokens: int
    price_usd_cents: int
    connector_limit: int
    features: list[str] = Field(default_factory=list)


class UsageOut(BaseModel):
    account_id: str
    plan: str
    tokens_used: int
    tokens_allowance: int
    percent_used: float
    remaining: int


class ChargeOut(BaseModel):
    id: str
    account_id: str
    amount_cents: int
    kind: str
    memo: str
    balance_cents: int
    created_at: datetime
