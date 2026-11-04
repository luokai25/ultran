import unittest

from ultron_backend.connectors.registry import ConnectorRegistry
from ultron_backend.runtime.generated_tool_lifecycle import (
    GeneratedToolLifecycle, ToolLifecycleError, ToolLifecycleState, WorkerReadiness,
)
from ultron_backend.runtime.generated_tool_registry import GeneratedToolCandidate


class FakeWorker:
    def __init__(self, *, ready=True, source_hash_override=None, network=False, credentials=False):
        self.ready = ready
        self.source_hash_override = source_hash_override
        self.network = network
        self.credentials = credentials
        self.staged = []
        self.started = []
        self.stopped = []

    def stage(self, reviewed):
        self.staged.append(reviewed.source_hash)

    def start(self, reviewed):
        self.started.append(reviewed.source_hash)
        candidate = reviewed.candidate
        return WorkerReadiness(
            server_id="generated-" + candidate.tool_id,
            tool_id=candidate.tool_id,
            version=candidate.version,
            source_hash=self.source_hash_override or reviewed.source_hash,
            isolation_profile=GeneratedToolLifecycle.REQUIRED_ISOLATION_PROFILE,
            network_enabled=self.network,
            ambient_credentials=self.credentials,
            ready=self.ready,
        )

    def stop(self, server_id):
        self.stopped.append(server_id)


def candidate():
    return GeneratedToolCandidate(
        tool_id="repo_summary", action="summarize", version="1.0.0",
        description="Summarize metadata supplied by the caller.",
        source='def run(payload):\n    return {"name": str(payload["name"])}\n',
        input_schema={"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    )


class GeneratedToolLifecycleTests(unittest.TestCase):
    def test_complete_approval_gated_lifecycle_and_unload(self):
        registry, worker = ConnectorRegistry(), FakeWorker()
        manager = GeneratedToolLifecycle(registry, worker)
        record = manager.review(candidate())
        fingerprint = record.reviewed.approval_fingerprint
        manager.stage(fingerprint)
        manager.prepare_worker(fingerprint)
        manager.approve(fingerprint, fingerprint)
        manager.activate(fingerprint, fingerprint)
        self.assertEqual(record.state, ToolLifecycleState.ACTIVE)
        self.assertEqual(len(registry), 1)
        manager.unload(fingerprint)
        self.assertEqual(record.state, ToolLifecycleState.UNLOADED)
        self.assertEqual(len(registry), 0)
        self.assertEqual(worker.stopped, ["generated-repo_summary"])

    def test_changed_source_or_worker_identity_fails_closed(self):
        registry, worker = ConnectorRegistry(), FakeWorker(source_hash_override="f" * 64)
        manager = GeneratedToolLifecycle(registry, worker)
        record = manager.review(candidate())
        manager.stage(record.reviewed.approval_fingerprint)
        with self.assertRaises(ToolLifecycleError):
            manager.prepare_worker(record.reviewed.approval_fingerprint)
        self.assertEqual(len(registry), 0)
        self.assertEqual(record.state, ToolLifecycleState.FAILED)

    def test_network_or_ambient_credentials_are_rejected(self):
        for worker in (FakeWorker(network=True), FakeWorker(credentials=True)):
            manager = GeneratedToolLifecycle(ConnectorRegistry(), worker)
            record = manager.review(candidate())
            manager.stage(record.reviewed.approval_fingerprint)
            with self.assertRaises(ToolLifecycleError):
                manager.prepare_worker(record.reviewed.approval_fingerprint)

    def test_exact_approval_required_and_invalid_transition_rejected(self):
        manager = GeneratedToolLifecycle(ConnectorRegistry(), FakeWorker())
        record = manager.review(candidate())
        key = record.reviewed.approval_fingerprint
        with self.assertRaises(ToolLifecycleError):
            manager.approve(key, "not-the-fingerprint")
        with self.assertRaises(ToolLifecycleError):
            manager.activate(key, key)
        self.assertEqual(record.state, ToolLifecycleState.REVIEWED)


if __name__ == "__main__":
    unittest.main()
