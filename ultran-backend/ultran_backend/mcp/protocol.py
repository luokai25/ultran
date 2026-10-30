"""Protocol data model: tool specs, results, trust levels and manifest hashing.

This module is the seam between "what the MCP SDK gives us" and "what Ultran's
gateway, event log and UI need". Nothing here imports the SDK - the wire model is
converted by :mod:`ultran_backend.mcp.transports`, so a spec change touches one
module instead of the whole runtime.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .annotations import ToolAnnotations
from .schema import is_valid_tool_schema, required_keys

PROTOCOL_VERSION = "2025-06-18"

#: Trust levels, lowest first. The spec's risk table asks for these so a
#: malicious third-party server is not treated like a curated one.
TRUST_LEVELS: tuple[str, ...] = ("untrusted", "third_party", "verified", "curated", "local")
DEFAULT_TRUST = "third_party"

_TRUST_RANK = {level: rank for rank, level in enumerate(TRUST_LEVELS)}


def utcnow() -> datetime:
    return datetime.now(UTC)


def canonical_json(value: Any) -> str:
    """Deterministic JSON so a hash does not move with key order."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def sha256_of(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def trust_rank(level: str) -> int:
    return _TRUST_RANK.get(str(level).strip().lower(), 1)


def at_least(level: str, minimum: str) -> bool:
    return trust_rank(level) >= trust_rank(minimum)


@dataclass(frozen=True)
class ToolSpec:
    """One tool, as Ultran understands it.

    ``id`` is namespaced (``server.tool``) so two servers exposing ``search`` do
    not collide in the tool index or in the event log.
    """

    server_id: str
    name: str
    description: str = ""
    input_schema: dict[str, Any] = field(default_factory=dict)
    annotations: ToolAnnotations = field(default_factory=lambda: ToolAnnotations())
    title: str = ""
    hash: str = ""

    def __post_init__(self) -> None:
        if not self.server_id:
            raise ValueError("ToolSpec.server_id is required")
        if not self.name:
            raise ValueError("ToolSpec.name is required")

    # ------------------------------------------------------------------ #
    @property
    def id(self) -> str:
        return f"{self.server_id}.{self.name}"

    @property
    def capabilities(self) -> frozenset[str]:
        return self.annotations.capabilities

    @property
    def required(self) -> list[str]:
        return required_keys(self.input_schema)

    @property
    def requires_approval(self) -> bool:
        return self.annotations.requires_approval

    def supports(self, capability: str) -> bool:
        return capability in self.annotations.capabilities

    # ------------------------------------------------------------------ #
    def fingerprint(self) -> str:
        """Hash of the parts of the spec a server could lie about later."""
        if self.hash:
            return self.hash
        return sha256_of(
            {
                "name": self.name,
                "description": self.description,
                "inputSchema": self.input_schema,
                "capabilities": sorted(self.annotations.capabilities),
            }
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "server_id": self.server_id,
            "name": self.name,
            "title": self.title or self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "required": self.required,
            "annotations": self.annotations.to_dict(),
            "hash": self.fingerprint()[:16],
        }

    def as_openai_tool(self) -> dict[str, Any]:
        """The shape a function-calling model expects."""
        return {
            "type": "function",
            "function": {
                "name": self.id.replace(".", "__"),
                "description": self.description or self.name,
                "parameters": self.input_schema or {"type": "object", "properties": {}},
            },
        }

    # ------------------------------------------------------------------ #
    @classmethod
    def from_wire(cls, server_id: str, tool: Any) -> ToolSpec:
        """Build from either an SDK ``Tool`` model or a plain dict."""
        raw = _as_mapping(tool)
        name = str(raw.get("name") or "").strip()
        if not name:
            raise ValueError("tool has no name")
        schema = raw.get("inputSchema") or raw.get("input_schema") or {}
        annotations_raw = raw.get("annotations") or {}
        meta_raw = raw.get("_meta") or raw.get("meta") or {}

        ok, reason = is_valid_tool_schema(schema)
        if not ok:
            raise ValueError(f"tool {name!r} has an unusable inputSchema: {reason}")

        annotations = ToolAnnotations.from_wire(
            name,
            annotations=_as_mapping(annotations_raw),
            meta=_as_mapping(meta_raw),
        )
        return cls(
            server_id=server_id,
            name=name,
            description=str(raw.get("description") or "").strip(),
            input_schema=dict(schema or {}),
            annotations=annotations,
            title=str(raw.get("title") or annotations.title or name),
        )


def _as_mapping(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        return dict(value.model_dump(exclude_none=True))
    if hasattr(value, "__dict__"):
        return {k: v for k, v in vars(value).items() if not k.startswith("_")}
    return {}


@dataclass
class ContentBlock:
    type: str
    text: str = ""
    data: str = ""
    mime_type: str = ""
    uri: str = ""

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"type": self.type}
        if self.text:
            out["text"] = self.text
        if self.uri:
            out["uri"] = self.uri
        if self.mime_type:
            out["mime_type"] = self.mime_type
        if self.data:
            out["data"] = self.data  # already truncated by the gateway
        return out


@dataclass
class CallResult:
    """A normalised tool result - the shape the event log stores.

    ``text`` is what the model reads; ``structured`` is what the orchestrator can
    branch on. Every transport path funnels into this one type so replay does not
    have to know whether the tool was stdio, HTTP or local.
    """

    tool: str
    server_id: str
    ok: bool = True
    text: str = ""
    structured: Any = None
    content: list[ContentBlock] = field(default_factory=list)
    is_error: bool = False
    error: str = ""
    latency_ms: int = 0
    tier: str = "remote-mcp"
    truncated: bool = False
    result_hash: str = ""
    args_hash: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "tool": self.tool,
            "server_id": self.server_id,
            "ok": self.ok and not self.is_error,
            "text": self.text,
            "structured": self.structured,
            "content": [block.as_dict() for block in self.content],
            "is_error": self.is_error,
            "error": self.error,
            "latency_ms": self.latency_ms,
            "tier": self.tier,
            "truncated": self.truncated,
            "result_hash": self.result_hash,
            "args_hash": self.args_hash,
        }

    @classmethod
    def failure(
        cls,
        tool: str,
        server_id: str,
        error: str,
        *,
        latency_ms: int = 0,
        args_hash: str = "",
    ) -> CallResult:
        return cls(
            tool=tool,
            server_id=server_id,
            ok=False,
            is_error=True,
            error=error,
            text=error,
            latency_ms=latency_ms,
            args_hash=args_hash,
        )


MAX_TEXT_CHARS = 64_000
MAX_BLOCK_BYTES = 256 * 1024


def normalise_result(
    tool: str,
    server_id: str,
    raw: Any,
    *,
    latency_ms: int = 0,
    args_hash: str = "",
) -> CallResult:
    """Convert an SDK ``CallToolResult`` (or a dict, or a plain value) to ours."""
    payload = _as_mapping(raw) if not isinstance(raw, (str, int, float, bool, list)) else {}
    if not payload and isinstance(raw, (str, int, float, bool, list)):
        payload = {"content": [{"type": "text", "text": str(raw)}]}

    is_error = bool(payload.get("isError") or payload.get("is_error"))
    blocks: list[ContentBlock] = []
    texts: list[str] = []
    truncated = False

    for item in payload.get("content") or []:
        block = _as_mapping(item)
        btype = str(block.get("type") or "text")
        if btype == "text":
            text = str(block.get("text") or "")
            if len(text) > MAX_TEXT_CHARS:
                text = text[:MAX_TEXT_CHARS] + "\n…[truncated]"
                truncated = True
            blocks.append(ContentBlock(type="text", text=text))
            texts.append(text)
        elif btype in {"image", "audio"}:
            data = str(block.get("data") or "")
            if len(data) > MAX_BLOCK_BYTES:
                data = data[:MAX_BLOCK_BYTES]
                truncated = True
            blocks.append(
                ContentBlock(
                    type=btype,
                    data=data,
                    mime_type=str(block.get("mimeType") or block.get("mime_type") or ""),
                )
            )
            texts.append(f"[{btype} {block.get('mimeType') or 'binary'}]")
        elif btype == "resource":
            resource = _as_mapping(block.get("resource"))
            uri = str(resource.get("uri") or "")
            text = resource.get("text")
            if text is None and resource.get("blob") is not None:
                text = f"[blob {len(str(resource.get('blob')))} bytes]"
            if len(str(text or "")) > MAX_TEXT_CHARS:
                text = str(text)[:MAX_TEXT_CHARS] + "\n…[truncated]"
                truncated = True
            blocks.append(
                ContentBlock(
                    type="resource",
                    text=str(text or ""),
                    uri=uri,
                    mime_type=str(resource.get("mimeType") or ""),
                )
            )
            texts.append(f"[resource {uri}] {text or ''}".strip())
        else:
            blocks.append(ContentBlock(type="text", text=canonical_json(block)))
            texts.append(canonical_json(block))

    structured = payload.get("structuredContent")
    if structured is None:
        structured = payload.get("structured_content")

    text = "\n".join(t for t in texts if t)
    if not text and structured is not None:
        text = canonical_json(structured)
    if not text and is_error:
        text = "tool reported an error without a message"

    result = CallResult(
        tool=tool,
        server_id=server_id,
        ok=not is_error,
        text=text,
        structured=structured,
        content=blocks,
        is_error=is_error,
        latency_ms=latency_ms,
        truncated=truncated,
        args_hash=args_hash,
    )
    result.result_hash = sha256_of({"text": text, "structured": structured, "is_error": is_error})
    return result


def manifest_hash(specs: Iterable[ToolSpec]) -> str:
    """Hash of a server's whole tool manifest, for pinning."""
    rows = [
        {
            "name": spec.name,
            "description": spec.description,
            "inputSchema": spec.input_schema,
            "capabilities": sorted(spec.capabilities),
        }
        for spec in sorted(specs, key=lambda s: s.name)
    ]
    return sha256_of(rows)


@dataclass
class ServerInfo:
    """What a server reports about itself during ``initialize``."""

    name: str = ""
    version: str = ""
    protocol_version: str = ""
    instructions: str = ""
    capabilities: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_wire(cls, raw: Any) -> ServerInfo:
        payload = _as_mapping(raw)
        server = _as_mapping(payload.get("serverInfo") or payload.get("server_info"))
        return cls(
            name=str(server.get("name") or ""),
            version=str(server.get("version") or ""),
            protocol_version=str(payload.get("protocolVersion") or payload.get("protocol_version") or ""),
            instructions=str(payload.get("instructions") or ""),
            capabilities=_as_mapping(payload.get("capabilities")),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "protocol_version": self.protocol_version,
            "instructions": self.instructions,
            "capabilities": self.capabilities,
        }


__all__ = [
    "DEFAULT_TRUST",
    "PROTOCOL_VERSION",
    "TRUST_LEVELS",
    "CallResult",
    "ContentBlock",
    "ServerInfo",
    "ToolSpec",
    "at_least",
    "canonical_json",
    "manifest_hash",
    "normalise_result",
    "sha256_of",
    "trust_rank",
    "utcnow",
]
