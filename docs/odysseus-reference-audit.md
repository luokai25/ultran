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


## Expanded runtime parity study (2026-11-02)

The deeper source review covered the agent turn contract, request-authority
workstream, background tool jobs, resource identity and path policy, effects
and provenance, browser lifecycle, memory ownership, and skill lifecycle.
Odysseus contains substantially more than the initial atomic-I/O and prompt
security examples. The relevant architecture is grouped into these domains:

1. **Request authority and turn contracts**: separate user intent, offered
   schemas, executable handlers, hard policy, and exact-action approvals.
   Nested/teacher/background continuations must inherit or narrow authority;
   model-generated messages cannot mint user grants.
2. **Tool execution and lifecycle**: capability classification, exact input
   schemas, one-use approvals, safe retry boundaries, bounded calls, durable
   task handoff, and process/browser cleanup.
3. **Resource identity and path policy**: bind operations to stable resource
   identity and version, not just a path string; reject aliases, symlinks,
   stale revisions, and ambiguous ownership.
4. **Effects and provenance**: record an immutable claim before dispatch,
   capture producer-owned outcomes, distinguish acknowledged from independently
   verified changes, and never let model prose promote uncertain outcomes to
   success.
5. **Evidence-backed completion**: verify file edits by fresh readback, treat
   partial reads as non-authoritative, and block success when later operations
   may have invalidated a required result.
6. **Background jobs**: durable launch/result linkage, idempotent delivery,
   crash reconciliation, owner scoping, and authority continuity.
7. **Browser lifecycle**: per-session ownership, bounded actions, cancellation,
   cleanup verification, navigation generation, and stale-page detection.
8. **Memory and skills**: owner isolation, explicit memory lifecycle, evidence
   based extraction, progressive disclosure, audit/repair states, and safe
   approval/publishing.
9. **Operational security**: secret-safe logs, URL/network policy, auth/session
   revocation, dependency provenance, CI security scans, and platform-specific
   regression tests.

### Current Ultran work added after the initial audit

- Added a request-scoped, immutable capability envelope to the desktop agent.
  The model's tool proposal is now checked against the trusted user goal before
  the existing per-action approval adapter. Read, write, and desktop-launch
  capabilities are independently classified; model output cannot grant itself
  a capability. This is an initial desktop-only classifier, not yet a full
  semantic turn contract or inherited authority system.
- Added regression tests proving an inspection-only request cannot cause a
  model-proposed project write.
- Added prompt-injection guard markers around tool history returned to the local
  planner, with embedded marker breakout neutralization and regression coverage.
- The desktop agent host tests and related runtime/task-store tests pass (37
  tests at this checkpoint).

### Remaining parity gaps (not yet implemented)

- Intent classification is lexical and intentionally conservative; it needs
  multilingual/compound/follow-up coverage and explicit unknown-intent handling.
- Authority is not yet sealed across resumable tasks, child runs, or future
  background jobs. A task currently re-evaluates its saved goal on resume.
- No general capability registry, per-tool effect classes, signed one-use
  approval grants, or operation digest binding to file identity/version.
- No durable effect journal that distinguishes attempted, running, acknowledged,
  interrupted, failed, and independently verified side effects.
- File writes have verified readback and backups, but no identity-bound diff
  or patch workflow and no robust concurrent external-writer conflict check.
- No generic background job manager, resource ownership model, or process-tree
  containment/reaper.
- No browser automation runtime; do not claim browser parity.
- No persistent semantic memory subsystem, owner-scoped vector store, or skill
  lifecycle/audit registry.
- The desktop product does not inherit Odysseus server auth/session, multi-user
  routes, research, document, MCP, or web application subsystems simply by
  copying them. These are product-level non-equivalences, not missing files to
  transplant into an Electron desktop app.

### Reuse and licensing policy

The user has authorized consideration of exact Odysseus code reuse. Reuse is
permitted only after checking the specific file's copyright and provenance,
license compatibility, dependencies, platform assumptions, and security
boundary. Where source is copied or adapted, retain its copyright/license
notices and record the exact upstream commit, source path, destination path,
and modifications in a provenance manifest. The repository's AGPL-3.0-or-later
terms require a release/distribution review for the resulting combined work;
do not describe a proprietary distribution as unaffected. The project LICENSE
and required source/license notices must accompany any applicable distribution.

### Definition of 100% for this port

100% means every Odysseus subsystem that is both relevant to Ultran's desktop
agent and compatible with its local-first, Windows/Electron architecture has
a reviewed parity decision and either (a) a tested implementation, or (b) a
documented, justified non-applicability decision. It does not mean copying all
1,584+ upstream test files or importing the entire Odysseus web server. A
subsystem is not complete merely because a file was copied; behavior, security,
failure modes, platform behavior, and tests must be validated.
