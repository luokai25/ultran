# @ultran/agent-core

The local agent runtime. This service is the heart of Ultran and runs
**on the user's device**, not in the cloud.

## Why a separate process

Model loading dominates startup and holds gigabytes of memory. Isolating the
runtime from the UI keeps the client responsive and lets the brain be tested,
restarted, and profiled independently of any frontend.

## Owned layers

| Layer | Module | Responsibility |
| --- | --- | --- |
| L1 | `src/brain/` | Model lifecycle and inference supervision. |
| L3 | `src/sandbox/` | Isolated tool execution under capability grants. |
| L4 | `src/orchestrator/` | Plan, act, reflect loop, run state, replay. |
| L5 | `src/monetization/` | Meter emission and entitlement gating. |

## Surface

Exposes a local HTTP/IPC API on `127.0.0.1:7700` by default:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/health` | GET | Liveness plus loaded-model summary. |
| `/runs` | GET | List run summaries. |
| `/runs` | POST | Start a new run from a goal. |
| `/runs/:id` | GET | Run summary. |
| `/runs/:id/events` | GET | Stream the run event log (SSE). |
| `/grants` | GET/POST | List and approve capability grants. |

## Communication rules

- **Inbound only from loopback.** The listener binds `127.0.0.1` and rejects
  non-local origins. There is no remote path into the sandbox.
- **Never trusts the client.** The orchestrator validates every request
  against the active grant set; the UI cannot widen capabilities by asking.

## Structure

```
src/
├── main.ts              # Process entry, HTTP surface
├── brain/               # L1 - model loader, backends, embeddings
├── sandbox/             # L3 - supervisor, grants, worker protocol
├── orchestrator/        # L4 - planner, dispatcher, memory, event log
└── monetization/        # L5 - meters, entitlements, policy gate
```

## Getting started

```bash
pnpm --filter @ultran/agent-core dev
pnpm --filter @ultran/agent-core build
pnpm --filter @ultran/agent-core start
```
