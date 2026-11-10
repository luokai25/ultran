# ULTRON Master Implementation Plan

**Status:** Active, incomplete  
**Canonical branch:** `main` only  
**Canonical client:** `apps/phone` (shared Vite web + Capacitor Android)  
**Primary web host:** Vercel  
**Optional cloud data service:** Supabase  
**Purpose:** The single source of truth for completing, repairing, testing and shipping ULTRON.

> This is an implementation plan, not a claim that every listed feature works. A source file, a successful build, a deployed endpoint and a verified end-user workflow are different levels of evidence. Record which level has actually passed.

## 0. Working agreement

Every future ULTRON conversation must resume from this plan and the current repository state. Do not restart the project from scratch, forget previous decisions, or replace this plan with a new disconnected checklist.

For each work session:
1. Read this plan and inspect the relevant current `main` source before editing.
2. Select the highest-priority unfinished item that can be safely advanced.
3. Implement the change, add or update tests, run the narrowest relevant checks, then broader checks when practical.
4. Update this plan with what changed, exact commit(s), test evidence, deployment status and remaining blockers.
5. Continue with the next unfinished item in the same session while useful work is possible.
6. End a session with a precise handoff: completed, verified, not verified, blocked, and the next exact task.

Do not call a feature complete merely because code was added. Do not silently skip failed tests. Never claim a deployment, APK installation, physical-device test, provider integration or security property that was not actually verified.

**Continuity expectation:** work should continue across conversations until all planned repairs and implementation are complete or a genuine external blocker requires the owner's action. A conversation cannot execute indefinitely or make progress while no session is running; this plan is the durable handoff so the next conversation resumes immediately rather than starting over.

### Repository and safety rules
- Push changes to **`main` only**. Do not create or push feature branches.
- Preserve existing user data and applied Supabase migrations.
- Never put API keys, tokens, passwords, signing keys or other secrets in chat, commits, logs, frontend bundles or screenshots.
- Previously exposed credentials must be revoked/rotated. Enter replacement provider keys directly in ULTRON's credential interface.
- Do not make destructive production changes without a backup and explicit approval.
- Keep ULTRON separate from Luo Chat.
- Keep the shared `apps/phone` client; do not create a duplicate web or mobile app.
- Supabase is optional for core operation. Its outage, missing configuration or disconnection must not prevent local chat, local models, local memory or local task history from working.
- Vercel is the current cloud inference/API host. Keep provider secrets server-side; never use `VITE_*` for secrets.

## 1. Product and architecture target

ULTRON is a local-first personal AI operating system with one web/Android client, one consistent brain interface, interchangeable model providers, persistent local state and optional cloud synchronization.

The model is an intelligence provider, not the whole product. ULTRON owns its identity, orchestration, memory, tools, permissions, task lifecycle, artifacts and recovery.

### Target topology

1. **Shared client — `apps/phone`:** chat, model picker, API key management, memory, agents, skills, connectors, workspace, artifacts, settings and task progress. Web and Android use the same application logic.
2. **Local runtime:** Android llama.cpp/native integration, GGUF and supported archive imports, local tools where permitted, local memory and offline operation.
3. **ULTRON brain/orchestrator:** intent and complexity assessment, context assembly, memory retrieval, planning, model choice, tool decisions, verification and final response.
4. **Vercel Brain Gateway:** authenticated API, provider adapters, key verification, model catalogue, streaming normalization, request budgets, rate limits and observability. It is an inference/API gateway, not by itself the entire brain.
5. **Execution runtime:** tool registry, permission checks, approvals, sandboxed execution, task ledger, checkpoints, retries and durable job adapters.
6. **Memory and knowledge:** working/hot memory, episodic/warm memory, archival/cold memory, semantic retrieval, relations/knowledge graph and consolidation.
7. **Storage adapters:** local durable database is always available; Supabase is an optional sync/cloud adapter. Cloud artifacts and durable cloud jobs require a real storage/queue backend if they must survive client closure and Supabase disconnection.
8. **Connectors and artifacts:** independent connector contracts, OAuth/credential handling, tool invocation and private artifact storage.
9. **Learning and improvement:** versioned skills/tools, evaluation, evidence, approvals, rollback and auditable self-improvement.
10. **Observability:** run IDs, event history, provider health, latency, token usage, errors, cancellation and recovery diagnostics.

### Non-negotiable operating properties

- Chat and local capabilities remain usable without Supabase.
- Android and web call the same brain and runtime contracts.
- Local data is durable and survives app restarts.
- Provider secrets never reach public source, frontend bundles or logs.
- User-visible tool execution is permissioned and auditable.
- Long-running tasks have checkpoints and can recover from interruption.
- Provider failover never silently splices a second answer into a partially displayed first answer.
- The UI distinguishes assistant text, task status, tool calls, approvals, errors and completion.

## 2. Streaming architecture

Use one normalized event contract for ordinary chat and multi-step execution. Use `fetch()` with a streaming response body (SSE framing) for POST requests containing message payloads and authorization. Do not depend on browser `EventSource` for authenticated POST chat.

### Normalized events

- `meta`: run ID, model/provider and protocol version.
- `status`: stage and human-readable progress.
- `delta`: incremental assistant text.
- `tool_start`: tool name, call ID and safe display metadata.
- `tool_result`: call ID, status and sanitized result summary.
- `approval_required`: requested action and approval scope.
- `usage`: provider-reported usage when available.
- `heartbeat`: connection/run liveness.
- `error`: structured recoverable or terminal failure.
- `done`: final status and finish reason.

Each event must include a run ID and monotonic sequence number. Persist task events for reconnectable background runs. The client must handle partial UTF-8 chunks, SSE boundaries split across network chunks, multiple events in one chunk, malformed events, heartbeats, cancellation and reconnect/replay.

### Ordinary chat flow

1. Persist the user message locally and create the assistant placeholder.
2. Assemble recent conversation, selected memories and attachment references/content.
3. Select an eligible local or cloud model based on capability, task complexity, provider health, key availability and budget.
4. Send a cancellable request to the shared brain interface.
5. Normalize provider output at the gateway and emit `delta` events immediately.
6. Append each delta to the existing assistant message and persist partial output safely.
7. Finish with usage and `done`; save final message and run metadata.

### Prometheus / long-running task flow

Prometheus must stream execution status and user-facing model text as each step happens. It must not collect a complete model turn in a local string and display it only after the turn ends.

A task should:
1. Create a durable run record and event sequence.
2. Stream planning/status events.
3. Stream user-facing assistant deltas when appropriate.
4. Emit structured tool-start/result events rather than exposing raw tool payloads as prose.
5. Check permissions and request approval for sensitive actions.
6. Save a checkpoint after meaningful steps.
7. Continue with the next model/tool turn.
8. Verify outputs and emit final completion.

Use a durable job/queue and event store for cloud work that must continue after the client closes. A Vercel request alone is not a durable background worker. If no independent durable queue is configured, explicitly limit cloud task guarantees and use local execution where possible.

### Streaming failure rules

- Before the first visible token: retry another eligible provider/key within the request budget.
- After visible output: preserve the partial response; do not silently switch and append an unrelated answer. Offer an explicit continuation/retry path.
- Stop must abort the client request, upstream provider request and cancellable tools.
- Idle, first-token, connection and total-duration timeouts must be separate.
- A disconnected client can reconnect to a still-running durable task and replay events from its last sequence.
- Provider usage must be captured from provider metadata where available; estimates must be labelled as estimates.

## 3. Repository comparison and current baseline

This baseline is based on source inspection of `main`, not complete production or physical-device QA. Recheck the repository before acting because code may have changed.

### Present in source (not automatically production-verified)
- Shared Vite + TypeScript client in `apps/phone`, used by web and Capacitor Android.
- Android native llama.cpp/local inference foundation.
- GGUF and supported `.tgz`/`.tar.gz` model import paths.
- Local provider-key vault with browser Web Crypto/IndexedDB and Android secure-storage integration.
- Vercel `api/ultron-brain.ts` provider gateway.
- Multiple provider adapters, model discovery/selection and local-key candidate routing.
- Fetch-based normal chat streaming and incremental UI rendering.
- Separate identity/cognition/capability modules.
- Prometheus/task planning, execution ledger and checkpoint foundations.
- Hot/warm/cold memory structures, local vector-memory foundation and knowledge relations.
- Skills catalog/storage and learning/proposal foundations.
- Connector SDK/catalog and cloud connector modules.
- Cloud artifact modules.
- Supabase Edge Functions for brain/jobs/runtime/capabilities/connectors/artifacts/Product Studio/Offer Builder.
- Optional Python/FastAPI control plane for workspace and connector operations.
- Existing screen coverage ledger at `docs/ULTRON-SCREEN-COVERAGE.md`.

### Known defects, architectural inconsistencies or gaps from the audit
- Vercel Brain is primarily a provider gateway; full orchestration responsibilities remain split across client and older services.
- The Vercel gateway's origin checks are not owner/device authentication. Add real request authentication, pairing and abuse controls.
- Prometheus buffers a model turn and calls the UI token callback only after the stream completes; convert it to live deltas/events.
- Cohere stream parsing has incorrectly escaped newline delimiters; repair and test real chunk-boundary parsing.
- Cloud chat message construction does not consistently include attachment payloads/content; add a shared attachment ingestion contract.
- Old and new provider/key flows coexist; consolidate into one credential and model interface.
- Main app state relies heavily on localStorage; migrate durable conversations, attachments, task runs and checkpoints to transactional IndexedDB/local database.
- Generic persistence helpers silently swallow storage errors; surface quota/write failures and recovery options.
- Local vector memory's built-in vectorizer is deterministic feature hashing, not a semantic neural embedding model; add pluggable embedding adapters while preserving fallback.
- Usage/token tracking includes estimates; capture actual provider usage where supported.
- Free-provider discovery/eligibility needs a real, explicit status model rather than a null/unimplemented result.
- Runtime, capability, connector and artifact paths still have Supabase-specific dependencies.
- Python control-plane production access still has Supabase-owner-session coupling.
- Current README and architecture docs describe the older Supabase-powered brain/key-vault topology and must be corrected to reflect the target and actual migration status.
- Physical Android, responsive web, all-provider streaming, offline and Supabase-disconnected end-to-end verification remain unproven until tested.

## 4. Phased implementation plan

Priority order is intentional. Do not expand autonomous capabilities while the brain, streaming, persistence and security foundations are unreliable.

### Phase 0 — Baseline, documentation and test harness
- [ ] Reconfirm current `main` commit and working deployment state.
- [ ] Inventory all client-to-Supabase calls and all Python-backend dependencies.
- [ ] Map each feature to local, Vercel, Supabase-optional or external service.
- [ ] Correct README and architecture documentation to reflect current reality and target.
- [ ] Add a clear test matrix for unit, integration, browser, Android emulator and physical device.
- [ ] Record baseline build/typecheck/lint/test outcomes and existing failures.

### Phase 1 — Brain gateway, security and streaming (P0)
- [ ] Add owner/device authentication and secure pairing independent of Supabase sessions.
- [ ] Add rate limits, per-device budgets, request-size limits, replay protection and safe error responses.
- [ ] Ensure secrets are redacted from logs and never returned to the client.
- [ ] Consolidate provider adapters and key handling into one interface.
- [ ] Normalize provider SSE parsing, including Cohere, OpenRouter, Groq, Mistral, Google AI Studio and other enabled providers.
- [ ] Correct SSE framing and chunk-boundary handling; test partial UTF-8, split delimiters and multiple events per chunk.
- [ ] Fix Prometheus so every model turn emits live text deltas and execution status.
- [ ] Add run IDs, event sequence IDs, heartbeat and reconnect/replay support.
- [ ] Implement safe pre-first-token fallback and explicit partial-stream recovery.
- [ ] Ensure stop/cancel aborts upstream generation and active cancellable tools.
- [ ] Implement first-token, idle, connection and total-duration timeouts.
- [ ] Implement provider-reported usage and clear estimate labelling.
- [ ] Add automated provider contract tests and mocked streaming integration tests.

### Phase 2 — Attachments and local-first persistence (P0/P1)
- [ ] Define a shared attachment contract for images, PDFs, documents, text and archives.
- [ ] Implement ingestion, extraction, MIME validation, size limits and safe file references.
- [ ] Pass supported image/file content to compatible cloud/local models.
- [ ] Migrate conversation and message persistence from localStorage to IndexedDB or an appropriate transactional local database.
- [ ] Persist attachments, task runs, event logs and checkpoints.
- [ ] Add versioned migration from existing localStorage data without data loss.
- [ ] Add quota detection, failed-write reporting, recovery/export and storage health UI.
- [ ] Verify app restart, browser refresh, offline and Android process-death recovery.

### Phase 3 — Independent runtime and capabilities (P1)
- [ ] Define platform-neutral runtime and capability contracts.
- [ ] Add Vercel/local adapters without making Supabase mandatory.
- [ ] Move runtime and capability operations behind the shared gateway/interface.
- [ ] Preserve Supabase as an optional adapter during migration.
- [ ] Add permission scopes, approval requirements, audit events and revocation.
- [ ] Add sandbox boundaries, resource limits and tool output validation.
- [ ] Verify tools and core tasks with Supabase disconnected.

### Phase 4 — Durable tasks and Prometheus (P1)
- [ ] Separate foreground chat requests from durable background jobs.
- [ ] Define job states, leases, heartbeat, checkpoints, retry policy, cancellation and dead-letter handling.
- [ ] Select and implement an independent durable queue/event store if cloud tasks must survive app closure while Supabase is unavailable.
- [ ] Keep a local job adapter for offline/device tasks.
- [ ] Implement task event replay and UI reconnect.
- [ ] Add recovery tests for process termination, worker restart, duplicate delivery and partial completion.
- [ ] Make approval-required and destructive operations pause safely until owner action.

### Phase 5 — Independent connectors and artifacts (P1)
- [ ] Define a platform-neutral connector registry and execution contract.
- [ ] Move OAuth callback, token refresh, credential storage and connector health behind a gateway.
- [ ] Encrypt connector credentials server-side and scope them to the ULTRON owner/device.
- [ ] Retain Supabase as an optional connector metadata/sync adapter where useful.
- [ ] Define local and cloud artifact storage adapters.
- [ ] Add upload/download authorization, content-type checks, retention and deletion.
- [ ] Verify artifact generation and connector operations without Supabase where the selected adapter supports it.

### Phase 6 — Memory, knowledge and learning (P2)
- [ ] Preserve current hot/warm/cold memory tiers and existing records.
- [ ] Add pluggable semantic embedding adapters (local and remote).
- [ ] Keep deterministic feature hashing as a documented fallback, not the claimed semantic embedding engine.
- [ ] Improve retrieval ranking, source attribution, recency and deduplication.
- [ ] Add background consolidation with checkpointing and conflict handling.
- [ ] Improve knowledge graph relation validation and memory provenance.
- [ ] Version skills and tools with tests, evaluations, evidence and rollback.
- [ ] Gate self-improvement publication behind policy checks and owner approval where changes affect permissions or execution.
- [ ] Verify memory remains useful offline and sync conflicts do not destroy local records.

### Phase 7 — UI, web/APK parity and reliability (P1/P2)
- [ ] Use `docs/ULTRON-SCREEN-COVERAGE.md` as the canonical screen QA ledger.
- [ ] Verify every screen's loading, empty, populated, error and offline states.
- [ ] Verify streaming, stop, retry, reconnect and task progress.
- [ ] Verify model picker, API-key screen, GGUF/archive imports and provider status.
- [ ] Verify memory, learning, agents, capabilities, connectors, workspace, approvals and artifacts.
- [ ] Verify keyboard, safe areas, system back, file chooser, accessibility and reduced motion.
- [ ] Verify mobile 360×800 and 390×844, tablet 768×1024 and desktop 1280×800 / 1440×900.
- [ ] Ensure web and Android behavior parity while respecting platform-specific local inference.
- [ ] Test performance and memory pressure on the target Poco X3 NFC class device.

### Phase 8 — Production and release verification (final gate)
- [ ] All relevant automated tests pass; failures are fixed or explicitly justified.
- [ ] Production web build is deployed and smoke-tested.
- [ ] Vercel Brain health, auth rejection, provider verification and real provider streaming are verified.
- [ ] APK builds successfully, installs and runs on emulator and physical Android device.
- [ ] GGUF and archive import/load tested on device.
- [ ] Supabase-disconnected core workflow passes on web and Android.
- [ ] Local-only conversation, memory and task recovery pass after restart.
- [ ] Provider outage, key expiry, rate limit and mid-stream disconnect tests pass.
- [ ] Security review confirms no secrets in bundle, logs or repository.
- [ ] Documentation and this plan accurately reflect shipped behavior.

## 5. Acceptance criteria — ULTRON is not complete until these pass

- [ ] Core chat works when Supabase is disconnected or unconfigured.
- [ ] Web and Android use the same brain/runtime contracts.
- [ ] Local models work offline on supported Android hardware.
- [ ] All enabled providers pass streaming adapter tests.
- [ ] Prometheus streams user-facing text and execution progress live.
- [ ] Stop cancels generation and cancellable tool execution.
- [ ] Mid-stream failure preserves partial output and never silently splices a different answer.
- [ ] Provider fallback works before first visible token.
- [ ] Images and supported documents reach compatible models.
- [ ] Conversations, attachments and checkpoints survive app restarts.
- [ ] Durable cloud tasks recover after client disconnect and worker restart.
- [ ] Connectors and tools enforce permissions, approvals and audit records.
- [ ] Local memory works without cloud sync; optional sync cannot block core use.
- [ ] Artifacts have authorized storage and retrieval paths.
- [ ] Security, build, automated tests, web QA and Android QA pass.
- [ ] Every claimed completion has test/deployment/device evidence recorded.

## 6. Current session log

### 2026-11-10 — Master plan created
- Added this document as the canonical end-to-end implementation plan (initial commit: `e8acba2ba6862547498191c811b9b9161f980d0d`).
- Linked it from `docs/README.md` (commit: `013c45c2d312419d610d9fd7a1481601fcf2b21f`).
- Corrected the root README's stale Supabase-brain/key-vault claims (commit: `509ecae4ad7376bf3048270cf43d833ad94793d9`).
- Rewrote `docs/architecture.md` to distinguish current transition state from the target design (commit: `1b5a715a052083a75aafdad24238be26ae9ee802`).
- Captured the local-first/Vercel brain/optional Supabase architecture decision.
- Captured the unified streaming protocol and Prometheus live-streaming requirement.
- Recorded source-audit findings: Prometheus buffers model output; Cohere delimiter parsing needs repair; cloud attachment payloads are incomplete; local persistence relies heavily on localStorage; memory embeddings are currently feature-hash based; several runtime/connector/artifact paths still depend on Supabase; README/architecture docs are stale.
- No implementation or production behavior is declared fixed by creating this plan.
- Baseline inspection: root scripts expose build, typecheck, lint and test; CI workflow runs phone/connector checks, Python backend tests, Supabase artifact/stream-preflight tests and structure checks. The combined status for the latest plan update showed Vercel pending; no passing CI result was established in this session.
- Documentation alignment is complete. Next action: establish full test evidence and start Phase 1 P0 fixes.

### 2026-11-10 — Continuity requirement reaffirmed
- Reaffirmed the standing requirement that every ULTRON conversation resumes from this plan and current `main`, then continues implementation, repair and verification rather than restarting planning or stopping at a checklist.
- Continue across sessions until acceptance criteria are verified, except where a genuine external blocker requires owner action. Record blockers and keep advancing independent work.
- Created a daily scheduled check for the Vercel deployment and streaming status. It must report evidence and must never expose or use uploaded credential files.
- The documentation index now links to this master plan (commit `e8c5ef2883e7cec842897d68ddfdc2522659014d`).


### 2026-11-10 — Local persistence and cache implementation
- Added `apps/phone/src/durable-store.ts`: transactional IndexedDB storage for conversations, messages, attachments (stored with their message records), task runs/events, checkpoints, settings and memory. Writes use strict durability where supported; quota/security errors are surfaced instead of silently swallowed.
- Connected chat history to IndexedDB in `apps/phone/src/main.ts`. Startup restores the active conversation and conversation list from IndexedDB. The legacy localStorage journal is retained as a compatibility fallback and is compared against the durable snapshot to avoid preferring an older database snapshot after an interrupted write.
- User messages and an empty assistant draft are committed before model inference starts. Streaming assistant text is checkpointed separately every 500 ms so it does not contaminate the model's conversation history. Startup restores an interrupted partial response as explicitly marked partial text; successful completion commits the assistant message before removing its draft checkpoint.
- Added a bounded TTL/LRU in-memory cache for non-sensitive runtime metadata and applied a 15-second cache to available cloud model metadata. Chat content, attachments, provider secrets and task checkpoints are excluded from this cache.
- Added cache unit tests for TTL expiry, LRU eviction, byte limits, overwrite accounting and clearing. These tests are in `apps/phone/test/runtime-cache.test.mjs`; they still require an observed test-run result before being marked passed.
- Browser smoke test on the deployed build `d47a75d`: app loaded with no uncaught JavaScript errors; a harmless test user message and its conversation survived a full page reload. Direct IndexedDB inspection confirmed database `ultron-local`, object stores `records` and `meta`, the conversation record and active-conversation metadata. The no-key test turn correctly failed because no eligible provider model was configured; this did not prevent the user message from being saved.
- The browser test confirms web reload persistence only. Android process-death recovery, attachment round-trip, quota failure handling, offline restart and export/recovery are still unverified.
- Added the ULTRON brain SVG favicon and corrected the home status copy so optional cloud sync is not presented as a required Supabase connection.
- Vercel successfully built the IndexedDB integration and model-metadata cache through commit `5227d2b`. Later Prometheus live-streaming changes are committed on `main`, but Vercel reported a build-rate-limit failure for the newer commit; those changes are not declared deployed until a new successful build is observed.
- Current next steps: run the new cache tests; verify the latest `main` commit after the Vercel build limit clears; test attachments and interrupted-response recovery in a browser; then build/install and test the APK on the target Android device.

- Follow-up source changes after the last successful Vercel build: Prometheus now forwards ordinary final-answer tokens as they arrive while buffering possible tool-call envelopes until they can be parsed safely; the Vercel Brain chat-history mapper now includes extracted text from attached files and explicitly labels image bytes as unsupported on that text-only route. These changes are on `main` but are not yet deployment-verified because Vercel returned a build-rate-limit status.
- A read-only browser check of the canonical production alias later failed before page load with `ERR_SOCKS_CONNECTION_FAILED`; this is a verification-network failure, not evidence of an app runtime regression. The successful IndexedDB persistence smoke test remains tied to the specific preview deployment documented above.
