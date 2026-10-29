# Ultran Architecture

> **Status:** Draft · v0.1 · Last updated 2026-10-29
>
> Ultran is a **local-first agent platform**. The AI brain runs on the user's
> own device; the cloud is optional and only exists to coordinate, sync, and
> bill. This document describes the layered design and the contracts between
> layers.

---

## 1. Design Principles

| Principle | Consequence |
| --- | --- |
| **Local-first** | Inference, memory, and tool execution default to the device. No network round-trip is required for the core agent loop. |
| **Cloud-optional** | Every cloud feature (sync, marketplace, billing) degrades gracefully to a local-only mode. |
| **Capability-scoped** | Connectors and tools declare capabilities. The orchestrator grants nothing that was not explicitly declared. |
| **Deny by default** | The tool sandbox starts with zero permissions and widens only via signed grants. |
| **Deterministic replay** | Every run is recorded as an event log that can be replayed for debugging and audit. |
| **Model-agnostic** | The brain runtime abstracts the inference backend (llama.cpp, MLX, ONNX, remote providers). |
| **Money is a layer, not a feature** | Monetization is cross-cutting: it observes usage and issues entitlements; it never leaks into business logic. |

---

## 2. Layered View

```
┌──────────────────────────────────────────────────────────────────────┐
│  L5  MONETIZATION LAYER                                              │
│      entitlements · metering · billing adapters · marketplace        │
├──────────────────────────────────────────────────────────────────────┤
│  L4  AGENT ORCHESTRATOR                                              │
│      planner · dispatcher · run state · memory manager · replay      │
├──────────────────────────────────────────────────────────────────────┤
│  L3  TOOL SANDBOX                                                    │
│      capability grants · process isolation · resource limits · audit │
├──────────────────────────────────────────────────────────────────────┤
│  L2  CONNECTOR REGISTRY                                              │
│      manifests · discovery · health · credential brokerage           │
├──────────────────────────────────────────────────────────────────────┤
│  L1  LOCAL AI BRAIN RUNTIME                                          │
│      model loader · inference engine · tokenizer · embeddings        │
├──────────────────────────────────────────────────────────────────────┤
│  L0  DEVICE & STORAGE                                                │
│      local state · model cache · encrypted vault · sync journal      │
└──────────────────────────────────────────────────────────────────────┘
```

Dependencies point **downward only**. A layer may call the layer directly
below it; it must never reach upward. Cross-cutting concerns (telemetry,
logging, tracing) are injected, not imported.

---

## 3. Layer Contracts

### L1 — Local AI Brain Runtime (`services/agent-core/src/brain`)

The runtime is a supervisor around one or more **inference backends**.

```ts
interface BrainRuntime {
  load(model: ModelRef, opts: LoadOptions): Promise<ModelHandle>;
  infer(handle: ModelHandle, req: InferenceRequest): AsyncIterable<Token>;
  embed(texts: string[], model?: ModelRef): Promise<Float32Array[]>;
  unload(handle: ModelHandle): Promise<void>;
  health(): Promise<BrainHealth>;
}
```

**Responsibilities**

- Model lifecycle: download, verify checksum, quantize, load, evict on LRU.
- Backend adapters: `llama.cpp` (CPU/GPU), `MLX` (Apple silicon), `ONNX
  Runtime` (cross-platform embeddings), `remote` (opt-in cloud fallback).
- Token budgeting and context-window management.
- Structured output: constrained decoding against a JSON schema.
- Embedding cache backed by the local vector store.

**Invariants**

1. No inference call blocks the event loop; all backends stream.
2. A model is never loaded without a verified content hash.
3. The runtime never makes a network call unless the backend is `remote`
   **and** the user has enabled cloud fallback.

---

### L2 — Connector Registry (`packages/connectors`)

A **connector** is a declarative package that teaches the agent about an
external system (GitHub, Gmail, Slack, Postgres, a filesystem path…).

```ts
interface ConnectorManifest {
  id: string;                    // "github"
  version: string;               // semver
  displayName: string;
  capabilities: Capability[];    // ["repo:read", "issue:write"]
  auth: AuthSpec;                // oauth2 | pat | none | mtls
  tools: ToolSchema[];           // JSON-schema described
  egress: EgressRule[];          // allow-listed hosts
}
```

**Registry responsibilities**

- **Discovery** — scan built-in, workspace, and marketplace sources.
- **Validation** — reject manifests whose tools reference undeclared
  capabilities or egress hosts.
- **Health** — probe connectors on a schedule; surface degraded state.
- **Credential brokerage** — hand the sandbox a *handle*, never a secret.
  Tokens live in the encrypted vault (L0) and are injected at call time.

**Resolution order:** workspace override → built-in → marketplace.
Two connectors with the same `id` never load simultaneously.

---

### L3 — Tool Sandbox

Every tool invocation crosses a process boundary. The sandbox is the only
place where side effects are permitted.

```
Orchestrator ──invoke(toolId, args, grant)──▶ Sandbox Supervisor
                                                   │
                                    ┌──────────────┴──────────────┐
                                    ▼                             ▼
                              Worker (WASM)                 Worker (container)
                              pure functions                network + fs
```

**Enforcement**

| Control | Mechanism |
| --- | --- |
| Capability | Signed grant JWT, short TTL, single-use per run |
| Filesystem | Bind mounts, read-only by default |
| Network | Egress allow-list from the manifest; DNS pinned |
| CPU / memory | cgroup (Linux), job objects (Windows), task policy (macOS) |
| Wall clock | Hard timeout with SIGKILL escalation |
| Audit | Every call appended to the run log with args hash + result hash |

**Grant model.** The orchestrator requests capabilities; the user (or a
standing policy) approves. Approvals are stored as revocable, expiring
grants. A tool that requests an undeclared capability fails closed.

---

### L4 — Agent Orchestrator (`services/agent-core/src/orchestrator`)

The orchestrator is the brain's executive function.

```
Observe ─▶ Plan ─▶ Act ─▶ Reflect ─┐
   ▲                               │
   └───────────────────────────────┘
```

**Components**

- **Planner** — decomposes a goal into a DAG of steps. The plan is
  re-evaluated after every observation (replanning is first-class).
- **Dispatcher** — executes ready nodes in the DAG, parallel where the DAG
  allows, serialized where capabilities conflict.
- **Memory Manager** — three tiers:
  - *Working* — the current context window.
  - *Episodic* — the run log, replayable.
  - *Semantic* — the local vector store, retrieved by similarity.
- **Run State** — an append-only event log. The single source of truth for
  a run; the UI is a projection of it.
- **Replay** — re-execute a run against recorded tool responses for
  deterministic debugging.

**Tool selection** is two-stage: the registry filters by capability, then
the model ranks by semantic fit against the goal. This keeps the tool
list in the prompt small regardless of how many connectors are installed.

---

### L5 — Monetization Layer

Monetization **observes** the system; it does not sit in the hot path.

```
            ┌────────────────────────────────────────┐
            │           Monetization Layer           │
            │                                        │
 Run events │  Metering ──▶ Usage Ledger            │
 ───────────┼─▶ Entitlements ──▶ Policy Gate         │
            │  Billing Adapter ──▶ Stripe / IAP      │
            │  Marketplace ──▶ Connector SKUs        │
            └────────────────────────────────────────┘
```

**Concepts**

- **Meter** — a named, monotonic counter (`tokens.in`, `tool.calls`,
  `connector.minutes`). Meters are emitted as events, never incremented
  inline.
- **Usage Ledger** — append-only, idempotent, keyed by `(run_id, meter)`.
  Reconciliation is a fold over the ledger.
- **Entitlement** — a signed statement of what a plan allows,
  e.g. `{ plan: "pro", limits: { tokens: 2_000_000 }, features: ["sync"] }`.
  Entitlements are cached locally and verified offline.
- **Policy Gate** — consulted before an expensive action. It answers
  `allow | deny | degrade`. A `degrade` decision lets the orchestrator
  swap to a smaller local model instead of failing the run.
- **Marketplace** — paid connectors are SKUs. Purchase issues an offline-
  verifiable entitlement; the connector manifest stays public.

**Rules**

1. The core agent loop never blocks on a billing network call.
2. Offline usage accrues locally and reconciles on reconnect.
3. Entitlement checks are pure functions of a signed blob + local clock.
4. No personal content leaves the device for metering — only counters.

---

## 4. Repository Layout

```
ultran/
├── apps/
│   ├── mobile/          # React Native (Expo) client
│   └── web/             # Next.js console
├── services/
│   ├── api/             # Sync, auth, marketplace, billing (edge-ready)
│   └── agent-core/      # Brain runtime + orchestrator (runs locally)
├── packages/
│   ├── connectors/      # Connector SDK + built-in manifests
│   └── ui/              # Shared design system
├── infra/               # Terraform, Kubernetes, container definitions
└── docs/                # Architecture and ADRs
```

**Why `agent-core` is a service, not a library:** it is a long-lived
process with its own lifecycle (model loading is expensive). The mobile
and web clients talk to it over a local IPC/HTTP boundary, which keeps the
UI responsive and makes the brain independently testable.

---

## 5. Data Flow — A Single Turn

1. **Input** arrives from `apps/web` or `apps/mobile`.
2. **Orchestrator** appends `run.started` to the event log.
3. **Planner** asks the **brain** for a plan, constrained to the tools whose
   capabilities the user has already granted.
4. For each tool node, the **sandbox** is invoked with a scoped grant. The
   **registry** supplies the connector's adapter and egress rules.
5. Results return as observations; the planner may replan.
6. The **monetization layer** folds emitted meters into the usage ledger and
   checks the entitlement budget. On `degrade`, the planner is told the
   effective model ceiling.
7. **Output** is streamed to the client; `run.completed` closes the log.

---

## 6. Trust Boundaries

| Boundary | Crossing mechanism |
| --- | --- |
| Client ↔ agent-core | Local IPC with origin attestation |
| agent-core ↔ sandbox | Signed grant + process isolation |
| Sandbox ↔ internet | Manifest egress allow-list, pinned DNS |
| Device ↔ cloud | mTLS, device-bound key, user-consented payloads |
| Cloud ↔ billing provider | Webhook signature verification, idempotency keys |

---

## 7. Failure Modes & Mitigations

| Failure | Mitigation |
| --- | --- |
| Model fails to load | Fall back to the next model in the tier list; surface a degraded banner. |
| Tool times out | Kill worker, mark node failed, let the planner replan around it. |
| Connector auth expires | Pause the run, prompt for re-auth, resume from checkpoint. |
| Cloud unreachable | Continue locally; queue sync ops in the journal. |
| Entitlement check offline | Use the cached signed entitlement; reconcile later. |
| Runaway loop | Step budget + cost budget enforced by the dispatcher. |

---

## 8. Non-Goals (v0.1)

- Multi-user collaboration inside a single run.
- Server-side inference as a first-class product.
- Arbitrary code execution outside the sandbox.
- Cross-device live hand-off of an in-flight run.

---

## 9. Open Questions

1. **Grant UX.** How much capability prompting is tolerable before users
   blind-approve? Proposal: ship with curated "trust profiles."
2. **Model distribution.** Direct download vs. torrent-style peer assist for
   multi-GB weights.
3. **Marketplace trust.** Do paid connectors require reproducible builds
   signed by Ultran, or is publisher signing sufficient?
4. **Ledger compaction.** At what run volume do we snapshot the usage ledger?

---

## 10. Decision Log

| ID | Decision | Rationale |
| --- | --- | --- |
| ADR-001 | Monorepo with pnpm + Turborepo | Shared types across client, service, and SDK without publish cycles. |
| ADR-002 | `agent-core` as a standalone process | Model loading dominates startup; isolate from UI lifecycle. |
| ADR-003 | Capability grants over allow-all tools | Least privilege is the only defensible default for local agents. |
| ADR-004 | Append-only event log as run truth | Enables replay, audit, and crash recovery from one mechanism. |
| ADR-005 | Monetization as an observer layer | Keeps billing failures from breaking the agent loop. |
