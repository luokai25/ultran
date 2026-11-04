"""Approval-gated hot registration for tools hosted by isolated MCP workers.

Generated source is reviewed but never imported by the trusted API process.
Execution is delegated to a separately managed MCP worker and its policy gateway.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from ..connectors.registry import ConnectorManifest, ConnectorRegistry, mcp_connector_id
from .generated_tool_policy import review_generated_source, validate_generated_tool_id

ACTION_ID = re.compile(r"^[a-z][a-z0-9_]{1,47}$")


class GeneratedToolRegistrationError(ValueError):
    pass


@dataclass(frozen=True)
class GeneratedToolCandidate:
    tool_id: str
    action: str
    version: str
    description: str
    source: str
    input_schema: dict[str, Any]
    capability: str = "generated:invoke"

@dataclass(frozen=True)
class ReviewedToolCandidate:
    candidate: GeneratedToolCandidate
    source_hash: str
    approval_fingerprint: str


def review_candidate(candidate: GeneratedToolCandidate) -> ReviewedToolCandidate:
    validate_generated_tool_id(candidate.tool_id)
    if not ACTION_ID.fullmatch(candidate.action):
        raise GeneratedToolRegistrationError("Action id is invalid.")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", candidate.version):
        raise GeneratedToolRegistrationError("Version must use semantic versioning.")
    if not candidate.description.strip() or len(candidate.description) > 500:
        raise GeneratedToolRegistrationError("A concise description is required.")
    if not isinstance(candidate.input_schema, dict) or candidate.input_schema.get("type") != "object":
        raise GeneratedToolRegistrationError("Input schema must describe an object.")
    review = review_generated_source(candidate.source)
    fingerprint = "ultron-generated-tool:" + candidate.tool_id + ":" + candidate.version + ":" + review.sha256
    return ReviewedToolCandidate(candidate, review.sha256, fingerprint)


def activate_reviewed_candidate(
    reviewed: ReviewedToolCandidate, registry: ConnectorRegistry, *,
    worker_server_id: str, worker_ready: bool, approval_fingerprint: str,
) -> ConnectorManifest:
    """Register a worker-backed manifest in memory after exact approval."""
    if not worker_ready or not worker_server_id.strip():
        raise GeneratedToolRegistrationError("An isolated, policy-gated MCP worker must be ready first.")
    if approval_fingerprint != reviewed.approval_fingerprint:
        raise GeneratedToolRegistrationError("Approval does not match this exact source version.")
    candidate = reviewed.candidate
    connector_id = mcp_connector_id(worker_server_id)
    manifest = ConnectorManifest(
        id=connector_id, name="ULTRON generated: " + candidate.tool_id,
        category="generated", auth_kind="none", tier="free",
        actions=(candidate.action,), description=candidate.description,
        source="mcp", mcp_server_id=worker_server_id, transport="stdio",
        capabilities=(candidate.capability,),
    )
    registry.register(manifest)
    return manifest


def candidate_fingerprint(reviewed: ReviewedToolCandidate) -> str:
    return hashlib.sha256(reviewed.approval_fingerprint.encode("utf-8")).hexdigest()
