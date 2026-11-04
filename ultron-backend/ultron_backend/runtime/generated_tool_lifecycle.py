"""Lifecycle coordinator for approval-gated generated tools.

This module never executes generated source and never creates a worker process.
A deployment adapter must provision a separately isolated worker and return a
readiness attestation bound to the exact reviewed source hash. The attestation
is a contract, not a substitute for OS/container enforcement by that adapter.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from ..connectors.registry import ConnectorRegistry, mcp_connector_id
from .generated_tool_registry import (
    GeneratedToolCandidate,
    GeneratedToolRegistrationError,
    ReviewedToolCandidate,
    activate_reviewed_candidate,
    review_candidate,
)


class ToolLifecycleError(RuntimeError):
    pass


class ToolLifecycleState(StrEnum):
    REVIEWED = "reviewed"
    STAGED = "staged"
    WORKER_READY = "worker_ready"
    APPROVED = "approved"
    ACTIVE = "active"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"
    UNLOADED = "unloaded"


@dataclass(frozen=True)
class WorkerReadiness:
    server_id: str
    tool_id: str
    version: str
    source_hash: str
    isolation_profile: str
    network_enabled: bool
    ambient_credentials: bool
    ready: bool


class GeneratedToolWorkerAdapter(Protocol):
    """Adapter to a real isolated worker supervisor, never an in-process exec."""

    def stage(self, reviewed: ReviewedToolCandidate) -> None: ...
    def start(self, reviewed: ReviewedToolCandidate) -> WorkerReadiness: ...
    def stop(self, server_id: str) -> None: ...


@dataclass
class ToolLifecycleRecord:
    reviewed: ReviewedToolCandidate
    state: ToolLifecycleState = ToolLifecycleState.REVIEWED
    worker: WorkerReadiness | None = None
    failure: str | None = None


class GeneratedToolLifecycle:
    """Coordinates stage -> attest -> exact approval -> hot-register -> rollback."""

    REQUIRED_ISOLATION_PROFILE = "generated-tool-restricted-v1"

    def __init__(
        self,
        registry: ConnectorRegistry,
        worker: GeneratedToolWorkerAdapter,
    ) -> None:
        self._registry = registry
        self._worker = worker
        self._records: dict[str, ToolLifecycleRecord] = {}

    def review(self, candidate: GeneratedToolCandidate) -> ToolLifecycleRecord:
        reviewed = review_candidate(candidate)
        key = reviewed.approval_fingerprint
        if key in self._records:
            raise ToolLifecycleError("This exact candidate has already entered the lifecycle.")
        record = ToolLifecycleRecord(reviewed=reviewed)
        self._records[key] = record
        return record

    def stage(self, fingerprint: str) -> ToolLifecycleRecord:
        record = self._get(fingerprint, ToolLifecycleState.REVIEWED)
        try:
            # The adapter stages bytes only. It must not execute them here.
            self._worker.stage(record.reviewed)
            record.state = ToolLifecycleState.STAGED
            return record
        except Exception as exc:
            record.state = ToolLifecycleState.FAILED
            record.failure = "staging failed: " + str(exc)[:500]
            raise ToolLifecycleError(record.failure) from exc

    def prepare_worker(self, fingerprint: str) -> ToolLifecycleRecord:
        record = self._get(fingerprint, ToolLifecycleState.STAGED)
        try:
            attestation = self._worker.start(record.reviewed)
            candidate = record.reviewed.candidate
            if (
                not attestation.ready
                or not attestation.server_id.strip()
                or attestation.tool_id != candidate.tool_id
                or attestation.version != candidate.version
                or attestation.source_hash != record.reviewed.source_hash
                or attestation.isolation_profile != self.REQUIRED_ISOLATION_PROFILE
                or attestation.network_enabled
                or attestation.ambient_credentials
            ):
                if attestation.server_id.strip():
                    self._worker.stop(attestation.server_id)
                raise ToolLifecycleError(
                    "Worker readiness attestation failed identity, isolation, network, or credential checks."
                )
            record.worker = attestation
            record.state = ToolLifecycleState.WORKER_READY
            return record
        except Exception as exc:
            record.state = ToolLifecycleState.FAILED
            record.failure = "worker preparation failed: " + str(exc)[:500]
            raise ToolLifecycleError(record.failure) from exc

    def approve(self, fingerprint: str, exact_approval: str) -> ToolLifecycleRecord:
        record = self._get(fingerprint, ToolLifecycleState.WORKER_READY)
        if exact_approval != record.reviewed.approval_fingerprint:
            raise ToolLifecycleError("Approval does not match this exact source and version.")
        record.state = ToolLifecycleState.APPROVED
        return record

    def activate(self, fingerprint: str, exact_approval: str) -> ToolLifecycleRecord:
        record = self._get(fingerprint, ToolLifecycleState.APPROVED)
        if exact_approval != record.reviewed.approval_fingerprint or record.worker is None:
            raise ToolLifecycleError("Exact approval and a ready worker are required.")
        try:
            activate_reviewed_candidate(
                record.reviewed,
                self._registry,
                worker_server_id=record.worker.server_id,
                worker_ready=record.worker.ready,
                approval_fingerprint=exact_approval,
            )
            record.state = ToolLifecycleState.ACTIVE
            return record
        except Exception as exc:
            self._worker.stop(record.worker.server_id)
            record.state = ToolLifecycleState.FAILED
            record.failure = "activation failed: " + str(exc)[:500]
            raise ToolLifecycleError(record.failure) from exc

    def rollback(self, fingerprint: str) -> ToolLifecycleRecord:
        record = self._record(fingerprint)
        if record.state not in {ToolLifecycleState.ACTIVE, ToolLifecycleState.FAILED, ToolLifecycleState.APPROVED, ToolLifecycleState.WORKER_READY, ToolLifecycleState.STAGED}:
            raise ToolLifecycleError("Candidate cannot be rolled back from its current state.")
        if record.state == ToolLifecycleState.ACTIVE and record.worker:
            connector_id = mcp_connector_id(record.worker.server_id)
            if connector_id in self._registry:
                self._registry.unregister(connector_id)
        if record.worker and record.worker.server_id:
            self._worker.stop(record.worker.server_id)
        record.state = ToolLifecycleState.ROLLED_BACK
        return record

    def unload(self, fingerprint: str) -> ToolLifecycleRecord:
        record = self._get(fingerprint, ToolLifecycleState.ACTIVE)
        assert record.worker is not None
        connector_id = mcp_connector_id(record.worker.server_id)
        self._registry.unregister(connector_id)
        self._worker.stop(record.worker.server_id)
        record.state = ToolLifecycleState.UNLOADED
        return record

    def get(self, fingerprint: str) -> ToolLifecycleRecord:
        return self._record(fingerprint)

    def _record(self, fingerprint: str) -> ToolLifecycleRecord:
        try:
            return self._records[fingerprint]
        except KeyError:
            raise ToolLifecycleError("Unknown generated-tool candidate.") from None

    def _get(self, fingerprint: str, expected: ToolLifecycleState) -> ToolLifecycleRecord:
        record = self._record(fingerprint)
        if record.state != expected:
            raise ToolLifecycleError(
                f"Invalid lifecycle transition: expected {expected.value}, got {record.state.value}."
            )
        return record
