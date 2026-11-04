"""Tests for the non-executing generated-tool source review."""

import unittest

from ultron_backend.runtime.generated_tool_policy import (
    GeneratedToolPolicyError, review_generated_source, validate_generated_tool_id,
)


class GeneratedToolPolicyTests(unittest.TestCase):
    def test_accepts_a_small_pure_function(self):
        result = review_generated_source('def run(payload):\n    values = payload["values"]\n    return sum(values)\n')
        self.assertTrue(result.accepted)
        self.assertEqual(result.function_name, "run")
        self.assertEqual(len(result.sha256), 64)

    def test_rejects_imports_and_file_access(self):
        for source in (
            'import os\ndef run(payload):\n    return 1\n',
            'def run(payload):\n    return open("secret.txt")\n',
            'def run(payload):\n    return payload.read()\n',
        ):
            with self.subTest(source=source), self.assertRaises(GeneratedToolPolicyError):
                review_generated_source(source)

    def test_rejects_dynamic_execution_and_dunder_access(self):
        for source in (
            'def run(payload):\n    return eval(payload["code"])\n',
            'def run(payload):\n    return payload.__class__\n',
            'def run(payload):\n    return getattr(payload, "x")\n',
        ):
            with self.subTest(source=source), self.assertRaises(GeneratedToolPolicyError):
                review_generated_source(source)

    def test_rejects_top_level_side_effects_and_unsupported_looping(self):
        for source in (
            'print("hello")\ndef run(payload):\n    return 1\n',
            'def run(payload):\n    while True:\n        pass\n',
            'async def run(payload):\n    return 1\n',
        ):
            with self.subTest(source=source), self.assertRaises(GeneratedToolPolicyError):
                review_generated_source(source)

    def test_rejects_oversized_or_malformed_source(self):
        with self.assertRaises(GeneratedToolPolicyError):
            review_generated_source('def run(payload):\n    return 1\n' + (' ' * 33_000))
        with self.assertRaises(GeneratedToolPolicyError):
            review_generated_source('def run(payload): return (')

    def test_tool_ids_are_strict(self):
        self.assertEqual(validate_generated_tool_id("summarize_repo"), "summarize_repo")
        for invalid in ("../oops", "UpperCase", "x", "two words", "a" * 60):
            with self.subTest(invalid=invalid), self.assertRaises(GeneratedToolPolicyError):
                validate_generated_tool_id(invalid)


if __name__ == "__main__":
    unittest.main()
