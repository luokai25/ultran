# Odysseus reference audit for Ultran

Audit date: 2026-11-02

Reference checkout: `odysseus-dev/odysseus`, branch `dev`, cloned into an isolated development workspace for inspection. The checkout was not added to the Ultran repository.

## What was verified in the repository

The project is a self-hosted AI workspace with chat/agents, tools and MCP, local model management, persistent memory, deep research, documents and integrations.

The inspected source and tests include:
- `core/atomic_io.py` and `tests/test_atomic_io.py`: sibling temporary files, flush/fsync, atomic replace, random temporary suffixes, failure-path preservation and concurrent-writer coverage.
- `src/prompt_security.py` and `tests/test_prompt_security.py`: external material is represented as untrusted context; guard delimiters are escaped to prevent wrapper breakout.
- `src/tool_capabilities.py`, `src/tool_approval_scopes.py`, `src/tool_approvals.py` and approval/security tests: tool effects are classified, approvals have bounded scopes, and server-owned grants are signed rather than trusting client-authored transcript metadata.
- Windows-specific regression tests cover selected Windows process, model-fit and update-script behaviors.

## Test and device-validation caveats

The inspected CI workflow runs Python tests on Ubuntu 24.04 in four pytest shards. It also runs Python compile checks and Node/frontend checks on Ubuntu. The six test files with Windows in their names provide targeted Windows regression coverage, but many cases mock Windows APIs. This workflow does not establish that the complete application has been installed and exercised on a matrix of physical Windows devices.

The Odysseus pytest suite could not be executed in this isolated workspace because Python's pytest package is not installed. The repository and test definitions were inspected directly. Do not treat the number of tests in the checkout as a successful local test run.

## Ultran implementation decisions

Ultran is using the architecture as a reference, not copying source files:
- A standalone conversation store has been independently implemented with versioned JSON, legacy-array migration, atomic replacement, serialized writes and backup recovery.
- A standalone tool engine has been independently implemented with a strict tool allowlist, argument validation, fail-closed behavior and a native Windows confirmation before launching an approved built-in application.
- Regression tests for both modules run with Node's built-in test runner and are included in Ultran's Windows CI.

## License and provenance

The inspected Odysseus checkout declares AGPL-3.0-or-later. No Odysseus source files are vendored or transplanted into Ultran by this audit. Any future code reuse requires a deliberate license and distribution review before integration. This document records architectural observations and test-coverage caveats, not legal advice.
