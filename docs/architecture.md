# ULTRON Architecture

> **Canonical plan:** [Master Implementation Plan](ULTRON-MASTER-IMPLEMENTATION-PLAN.md). This document describes the intended architecture and calls out migration status. A component existing in source does not mean its production workflow has passed QA.

## 1. Product surfaces

| Surface | Implementation | Responsibility |
| --- | --- | --- |
| Web | `apps/phone` deployed to Vercel | Shared ULTRON interface |
| Android | `apps/phone/android` via Capacitor | Same interface plus native local inference and device integrations |
| Local runtime | Android native llama.cpp integration | Offline local model execution and supported model imports |
| Brain API | Vercel `api/ultron-brain.ts` | Provider gateway, key verification, model discovery and chat transport |
| Optional cloud data | Supabase | Cloud persistence, synchronization and legacy services during migration |
| Connector SDK | `packages/connectors` | Shared connector manifests and validation |
| Optional control plane | `ultron-backend` (FastAPI) | Agent sessions, workspace tasks and connector operations; still has cloud identity coupling |

There is one client codebase. Do not create another web or mobile application for the same product.

## 2. Target architecture and boundaries

ULTRON is local-first. Its identity, orchestration, memory, tools, permissions and task lifecycle belong to ULTRON; model providers supply language/model inference.

- **Client:** presentation, local state, local persistence adapter, model selection, streaming event rendering and task controls.
- **Brain/orchestrator:** intent and complexity assessment, context assembly, memory retrieval, planning, model selection, tool decisions, verification and final response.
- **Vercel Brain Gateway:** authenticated API, provider adapters, key verification, model catalogue, normalized streaming, request budgets, rate limits and diagnostics. It is not the entire brain by itself.
- **Local runtime:** Android llama.cpp/local models, local tools where allowed, offline inference and local job execution.
- **Execution runtime:** tool registry, permissions, approvals, sandbox boundaries, task ledger, checkpoints, retries and cancellation.
- **Memory:** working/hot, episodic/warm, archival/cold, semantic retrieval, knowledge relations and consolidation.
- **Storage adapters:** local durable database is always available; Supabase is optional cloud synchronization/data storage.
- **Connectors/artifacts:** platform-neutral connector contracts, OAuth/credential management, tool execution and private artifact storage.
- **Learning:** versioned skills/tools, evaluation, evidence, approvals and rollback.

Supabase must not be a prerequisite for local chat, local models, local memory or local task history. Some runtime, capability, connector, artifact and job modules still use Supabase-specific APIs; they remain migration work, not completed independence.

## 3. Chat and streaming

### Current transition state

The repository contains a Vercel provider gateway and a fetch-based chat stream. The client has a normal path that appends streamed tokens as they arrive. Some older Supabase paths and client-side orchestration still coexist.

The source audit identified a Prometheus path that accumulates an entire model response before calling the UI callback. That path must be changed to stream live deltas and execution events. The Cohere adapter's newline delimiter parsing also needs repair and chunk-boundary tests. Cloud chat payload construction does not yet consistently pass attachment content.

### Target request flow

1. Persist the user message locally and create an assistant placeholder.
2. Assemble conversation context, relevant memories and attachment content/references.
3. Select an eligible local or cloud model based on capability, complexity, provider health, key availability and budget.
4. Send a cancellable POST request through the shared Brain interface.
5. Normalize provider output and emit streaming events.
6. Append text deltas immediately and persist partial output.
7. Save usage and run metadata when the stream finishes.

Use `fetch()` with a streaming response body and SSE framing for POST requests. The normalized event contract is defined in the master plan: `meta`, `status`, `delta`, `tool_start`, `tool_result`, `approval_required`, `usage`, `heartbeat`, `error` and `done`. Events should carry a run ID and sequence number.

### Prometheus and durable work

Prometheus must emit live planning/status events, model text deltas, tool-start/result events, approval requests, checkpoints and completion. Raw tool payloads must not be rendered as ordinary assistant prose.

Long-running cloud tasks need a durable job queue and event store so they can survive client closure and reconnect/replay. A Vercel request alone is not a durable worker. If an independent queue/store is not configured, cloud background execution guarantees must be limited and stated honestly.

### Failure behavior

- Before the first visible token, retry another eligible provider/key within the request budget.
- After visible output, preserve partial output; never silently splice a different provider's answer into it.
- Stop cancels the upstream provider and cancellable tools.
- Use separate connection, first-token, idle and total-duration timeouts.
- Reconnecting clients replay durable events from their last sequence.
- Capture provider-reported usage when available; label estimates as estimates.

## 4. Model providers and credentials

Supported provider adapters are maintained behind one interface. The client must not contain provider secrets. Browser and Android local vaults are separate device-local stores; optional encrypted synchronization may make credentials available on another device, but local storage alone does not create cross-device sync.

The current code has a local encrypted provider-key vault foundation and a Vercel gateway that accepts a key for provider operations. Consolidation of older single-key and Supabase Vault flows remains required. The gateway needs owner/device authentication, pairing, rate limits, request budgets, size limits, replay protection and secret-safe logging. Origin checks alone are not authentication.

Never put secrets in `VITE_*` variables, client bundles, source files, chat messages or logs. Rotate credentials that have been exposed.

## 5. Local storage and optional Supabase

Local persistence is the source of continuity when offline. The current app relies heavily on localStorage and has generic write paths that can silently swallow failures. The plan is to migrate conversations, attachments, task runs, event history and checkpoints to transactional IndexedDB or another appropriate local database, with a safe versioned migration and quota/error recovery.

Supabase remains useful as an optional adapter for cloud data and synchronization. Its absence must not prevent core local operation. However, Supabase-dependent runtime, capabilities, connectors, artifacts, scheduled jobs and Python control-plane identity paths must be migrated or explicitly classified before the whole app can be called Supabase-independent.

Local web and Android data do not automatically synchronize with each other. Cross-device sync requires an available cloud data service.

## 6. Memory, knowledge and learning

The repository contains hot/warm/cold memory structures, knowledge relations, skills and learning/proposal foundations. The local vector-memory implementation currently uses deterministic feature hashing as a fallback vectorizer; that is not equivalent to a neural semantic embedding model.

Preserve existing memory data and interfaces while adding pluggable local/remote embedding adapters, better retrieval ranking, provenance, deduplication and consolidation. Skill/tool changes must be versioned, evaluated, auditable and reversible. Changes affecting permissions or execution require owner approval.

## 7. Runtime, connectors, artifacts and jobs

The repository currently has Supabase Edge Functions for brain/jobs/runtime/capabilities/connectors/artifacts/Product Studio/Offer Builder and an optional FastAPI control plane. Several client modules still call Supabase-specific functions directly.

The target is platform-neutral contracts with local, Vercel and optional Supabase adapters. Tool execution must enforce permission scopes, approval requirements, sandbox/resource limits and audit events. Connector credentials must be encrypted and scoped. Artifact upload/download must be authorized and validated. Durable background jobs need leases, checkpoints, retry/cancellation and recovery.

Do not delete or disable existing Supabase functions until their replacements are implemented, tested and deployed.

## 8. Android local inference

The Android app includes a native llama.cpp foundation. It supports GGUF and supported `.tgz`/`.tar.gz` archive import paths. Model files remain in private app storage and are not bundled into the APK. Device speed and supported model sizes depend on available memory, CPU and thermal limits.

Physical-device verification is required. Source inspection or a successful web build does not prove model import, inference, file chooser, keyboard, safe-area or process-recovery behavior on the target phone.

## 9. Verification and documentation

- [Master Implementation Plan](ULTRON-MASTER-IMPLEMENTATION-PLAN.md) is the authoritative implementation sequence, known-gap list and acceptance criteria.
- [Screen coverage](ULTRON-SCREEN-COVERAGE.md) is the canonical UI QA ledger.
- [Phone app guide](../apps/phone/README.md) documents the shared client and Android build.
- [Supabase guide](../supabase/README.md) documents current Supabase services and migrations.
- [Python backend guide](../ultron-backend/README.md) documents the optional control plane.

A feature is complete only after relevant automated tests and actual workflow verification. Record separately: source implemented, automated tests passed, deployment verified, browser workflow passed, Android emulator passed and physical-device passed. Do not mark a device/browser check complete from source inspection alone.
