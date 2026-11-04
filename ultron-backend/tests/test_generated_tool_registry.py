import unittest

from ultron_backend.connectors.registry import ConnectorRegistry
from ultron_backend.runtime.generated_tool_registry import (
    GeneratedToolCandidate, GeneratedToolRegistrationError, activate_reviewed_candidate, review_candidate,
)


class GeneratedToolRegistryTests(unittest.TestCase):
    def setUp(self):
        self.candidate = GeneratedToolCandidate(
            tool_id="repo_summary", action="summarize", version="1.0.0",
            description="Summarize repository metadata supplied by the trusted worker.",
            source='def run(payload):\n    return {"name": str(payload["name"])}\n',
            input_schema={"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
        )

    def test_review_binds_approval_to_exact_source_hash_and_version(self):
        reviewed = review_candidate(self.candidate)
        self.assertIn("repo_summary:1.0.0:", reviewed.approval_fingerprint)
        self.assertEqual(len(reviewed.source_hash), 64)

    def test_hot_registration_requires_ready_worker_and_exact_approval(self):
        reviewed = review_candidate(self.candidate)
        registry = ConnectorRegistry()
        with self.assertRaises(GeneratedToolRegistrationError):
            activate_reviewed_candidate(reviewed, registry, worker_server_id="generated-repo", worker_ready=False, approval_fingerprint=reviewed.approval_fingerprint)
        with self.assertRaises(GeneratedToolRegistrationError):
            activate_reviewed_candidate(reviewed, registry, worker_server_id="generated-repo", worker_ready=True, approval_fingerprint="wrong")
        self.assertEqual(len(registry), 0)

    def test_approved_candidate_is_hot_registered_as_mcp_worker_tool(self):
        reviewed = review_candidate(self.candidate)
        registry = ConnectorRegistry()
        manifest = activate_reviewed_candidate(reviewed, registry, worker_server_id="generated-repo", worker_ready=True, approval_fingerprint=reviewed.approval_fingerprint)
        self.assertEqual(len(registry), 1)
        self.assertEqual(manifest.source, "mcp")
        self.assertEqual(manifest.actions, ("summarize",))
        self.assertEqual(registry.get(manifest.id).mcp_server_id, "generated-repo")

    def test_changed_source_requires_a_new_approval_fingerprint(self):
        first = review_candidate(self.candidate)
        changed = GeneratedToolCandidate(**{**self.candidate.__dict__, "source": 'def run(payload):\n    return "changed"\n'})
        second = review_candidate(changed)
        self.assertNotEqual(first.approval_fingerprint, second.approval_fingerprint)


if __name__ == "__main__":
    unittest.main()
