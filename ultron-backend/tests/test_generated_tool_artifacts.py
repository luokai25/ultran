import json
import tempfile
import unittest
from pathlib import Path

from ultron_backend.runtime.generated_tool_artifacts import GeneratedToolArtifactError, GeneratedToolArtifactStore
from ultron_backend.runtime.generated_tool_registry import GeneratedToolCandidate, review_candidate


class GeneratedToolArtifactStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = GeneratedToolArtifactStore(Path(self.temp.name) / "staged")
        candidate = GeneratedToolCandidate(
            tool_id="pure_math", action="calculate", version="1.0.0",
            description="Calculate a pure arithmetic expression supplied as input.",
            source="def run(payload):\n    return int(payload['value']) + 1\n",
            input_schema={"type": "object", "properties": {"value": {"type": "integer"}}, "required": ["value"]},
        )
        self.reviewed = review_candidate(candidate)

    def test_stages_content_addressed_source_and_nonexecution_manifest(self):
        path = self.store.stage(self.reviewed)
        self.assertEqual(path.read_text(), self.reviewed.candidate.source)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        manifest = json.loads((path.parent / "review.json").read_text())
        self.assertEqual(manifest["source_sha256"], self.reviewed.source_hash)
        self.assertEqual(manifest["execution"], "not_executed")
        self.assertEqual(self.store.stage(self.reviewed), path)

    def test_changed_bytes_at_existing_hash_path_are_rejected(self):
        path = self.store.stage(self.reviewed)
        path.write_text("changed")
        with self.assertRaises(GeneratedToolArtifactError):
            self.store.stage(self.reviewed)

    def test_symlink_root_is_rejected(self):
        root = Path(self.temp.name) / "link"
        root.symlink_to(Path(self.temp.name) / "staged", target_is_directory=True)
        with self.assertRaises(GeneratedToolArtifactError):
            GeneratedToolArtifactStore(root)


if __name__ == "__main__":
    unittest.main()
