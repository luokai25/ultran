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
- Persisted the original capability grant snapshot with each task and made
  resumed runs intersect that snapshot with the original goal, so resumption
  cannot widen permissions after a restart.
- Added prompt-injection guard markers around tool history returned to the local
  planner, with embedded marker breakout neutralization and regression coverage.
- Added an explicit tool preflight phase. File-write approvals are now bound to
  the resolved target path, device/inode identity, size, modification time, and
  SHA-256 content digest. The identity and digest are checked again immediately
  before replacement, and a stale approval fails closed without overwriting an
  intervening user edit.
- Added side-effect lifecycle events that distinguish verified outcomes,
  acknowledged-but-unverified outcomes, and failed/uncertain outcomes. The task
  journal persists these events; the runtime does not infer verification from
  a success-shaped message.
- Fixed a resume-path authority propagation gap: interrupted tasks now pass the
  originally persisted capability grants back into the host. Missing legacy
  grants fail closed to an empty set rather than being re-derived as broader
  permissions.
- Windows app launches now return a PID and a narrowly scoped verification
  claim only after Electron observes the child process `spawn` event. The task
  effect is verified as process creation, not as proof the application remains
  open or completed a later task.
- Task recovery now derives unresolved side effects from durable `tool_started`
  and `effect_outcome` journal entries. Interrupted tasks with an uncertain
  write or external action are marked non-resumable and the store rejects direct
  resume attempts until the resource/action is reviewed. This prevents a crash
  between dispatch and outcome persistence from silently replaying or skipping
  an action whose real-world result is unknown.
- The desktop agent host tests and related runtime/task-store The latest focused agent/runtime/task-store/tool-engine set passes 34/34 tests.
  Focused task/runtime tests pass 19/19. A broad `node --test` sweep found 69
  passing tests and 3 test-file loading failures because the validation checkout
  had not built the TypeScript connector/agent-core package outputs (`index.js`,
  `runtime.js`, and the `@ultran/connectors` package). These are environment/build
  prerequisites, not failing assertions; run the repository's package build
  pipeline before treating the full suite as green. Windows CI remains pending.

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

## Luo Kai AI Agent Skills integration

Ultran now includes a local skill-library manager for the public MIT-licensed
`luokai25/ai-agent-skills-by-luo-kai` collection. The current repository
snapshot contains thousands of skill documents; the indexer discovers valid
`SKILL.md` files from a user-selected local clone rather than bundling a
multi-gigabyte registry into the desktop installer. A live validation against
the cloned repository indexed 9,579 documents with usable frontmatter.

The desktop Skills Library page supports selecting the repository folder,
refreshing/searching its catalog, installing individual skill packages, and
enabling/disabling installed skills. Installation copies the skill's bounded
supporting files while rejecting symlinks and hidden folders; it never executes
scripts or hooks. Skill packages are limited to 200 files and 10 MB each, and
individual `SKILL.md` files are limited to 64 KB when indexed/read.

For agent tasks, Ultran selects up to three enabled skills by relevance and
passes their text as untrusted reference guidance. Skill text cannot grant
capabilities, override the user goal, bypass native approvals, or authorize
scripts. The existing request-authority and tool-approval layers remain the
only source of execution permission. The collection is MIT licensed; the
upstream repository and its source registries remain attributed to their
respective authors. Ultran does not redistribute the entire collection in its
installer.

Focused validation for the skill manager and agent/task subsystems: 47 tests
passed. A live index of the cloned skills repository returned 9,579 valid
entries and ranked Python-related skills as expected. Actual Windows UI use and
real local-model skill-guided inference remain unverified until exercised on
the user's PC.
