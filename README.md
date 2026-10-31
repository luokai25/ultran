# Ultran

**A local-first AI agent platform.** Local inference is the long-term target. The
Android shell does not bundle model weights; full language-model reasoning
requires a linked local runtime or a configured hosted model provider. Ultran's
cloud control plane is optional for local-only use, but is required for shared
workspaces and hosted agent services.

Ultran is a monorepo for building and operating autonomous agents that think
locally, reach the outside world only through capability-scoped connectors,
and can be monetized without the billing system ever sitting in the hot path.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#project-status)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-339933.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-f69220.svg)](https://pnpm.io)

---

## Why

Most agent platforms are thin clients over someone else's inference API. That
means your prompts, your files, and your tool calls leave your machine by
default, and your agent stops working when the network does.

Ultran inverts the default:

- **Local inference is preferred.** The Python control plane tries a local
  Ollama model by default and falls back to a deterministic Echo responder when
  no model is available. The Android APK does not bundle model weights.
- **Tools are sandboxed.** Every side effect happens in an isolated worker
  under a signed, expiring capability grant.
- **The cloud is a service, not a dependency.** Sync, marketplace, and billing
  degrade to local-only mode when unreachable.
- **Runs are replayable.** One append-only event log is the source of truth for
  every run — for debugging, audit, and crash recovery.

---

## Architecture at a Glance

```
┌────────────────────────────────────────────────────────────────┐
│  L5  MONETIZATION      entitlements · metering · marketplace   │
├────────────────────────────────────────────────────────────────┤
│  L4  ORCHESTRATOR      planner · dispatcher · memory · replay  │
├────────────────────────────────────────────────────────────────┤
│  L3  TOOL SANDBOX      grants · isolation · limits · audit     │
├────────────────────────────────────────────────────────────────┤
│  L2  CONNECTOR REGISTRY manifests · discovery · credentials    │
├────────────────────────────────────────────────────────────────┤
│  L1  BRAIN RUNTIME     model loader · inference · embeddings   │
├────────────────────────────────────────────────────────────────┤
│  L0  DEVICE & STORAGE  state · model cache · vault · journal   │
└────────────────────────────────────────────────────────────────┘
```

Dependencies point **downward only**. Read the full design in
[docs/architecture.md](docs/architecture.md).

---

## Repository Layout

| Path | Purpose |
| --- | --- |
| [`apps/mobile`](apps/mobile) | React Native (Expo) client — the pocket console. |
| [`apps/web`](apps/web) | Next.js web console — runs, connectors, billing. |
| [`services/api`](services/api) | Cloud control plane: sync, auth, marketplace, billing. |
| [`services/agent-core`](services/agent-core) | Local brain runtime + orchestrator. Runs on-device. |
| [`packages/connectors`](packages/connectors) | Connector SDK, manifest schema, built-in connectors. |
| [`packages/ui`](packages/ui) | Shared design system across web and mobile. |
| [`infra`](infra) | Terraform, Kubernetes manifests, container definitions. |
| [`docs`](docs) | Architecture, ADRs, and operational guides. |

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 20.11 | LTS recommended |
| pnpm | ≥ 9 | `corepack enable && corepack prepare pnpm@9 --activate` |
| Python | ≥ 3.11 | Only for `services/agent-core` native backends |
| Docker | ≥ 24 | Optional, for containerized sandbox workers |

### Install & run

```bash
git clone https://github.com/luokai25/ultran.git
cd ultran
corepack enable
pnpm install

# Everything in watch mode
pnpm dev

# Or a single workspace
pnpm --filter @ultran/web dev
pnpm --filter @ultran/api dev
```

### Common tasks

```bash
pnpm build        # build every workspace, topologically
pnpm test         # run the test suites
pnpm typecheck    # strict TS across the monorepo
pnpm lint         # lint every workspace
pnpm format       # prettier
```

### Connect a local model

The Android build is configured to bundle the CPU inference runtime from
llama.cpp at a pinned upstream commit. In the app, open Settings → On-device AI
model and import a single-file GGUF model from device storage. Ultran copies it into
private app storage; model weights are not bundled in the APK and are not
downloaded automatically. The initial runtime targets arm64-v8a and
x86_64, uses a 2,048-token context and up to four CPU threads, and is intended
to start with 1B–3B Q4 quantized models. Larger models can be slow or exceed
available RAM. This first native runtime is CPU-only; GPU acceleration and
streamed native token callbacks remain future optimizations.

A local Ollama-compatible runtime is still supported as an optional bridge.
Configure its localhost or private-LAN address and installed model in Settings
→ Local model endpoint. Inference goes directly from the app to that runtime,
not through the Ultran backend.

For hosted agents, Composio and shared workspaces, the optional Python control
plane can still run separately. Set ULTRAN_BRAIN_BACKEND=ollama and
ULTRAN_BRAIN_MODEL=llama3.1:8b before starting the backend. It listens on
127.0.0.1:8080 by default. To reach it from a phone, set ULTRAN_HOST=0.0.0.0
and connect using the computer's LAN IP, but only on a trusted network and
with firewall access limited to your devices. Do not expose this development
backend directly to the public internet.

### Connect Google and other services through Composio

Composio OAuth is brokered by the backend. Set `ULTRAN_COMPOSIO_API_KEY` in
`infra/hetzner/.env` on the private API host (see the deployment guide), then
restart the API. The Android app reads only the backend's redacted configured
status and starts OAuth authorization; it must never contain the Composio
project key. Connected accounts are scoped to the Ultran workspace, and
write-capable actions remain approval-gated. For a single-owner installation,
keep the backend endpoint private to your own deployment and use a unique owner
workspace; do not disable approval checks or embed service credentials in the
APK.

### Persistent agent memory

Agents, settings, usage totals, sessions, and bounded chat transcripts are stored
in SQLite under `ULTRAN_DATA_DIR/agents.sqlite3` and restored on backend restart.
Background agent runs are available through `POST /v1/tasks` (HTTP 202), with `GET /v1/tasks`, `GET /v1/tasks/{task_id}`, `GET /v1/tasks/{task_id}/events` (reconnectable server-sent events; use `?stream=false` for a bounded event snapshot), `POST /v1/tasks/{task_id}/cancel`, and `POST /v1/tasks/{task_id}/retry`. Task events persist in the encrypted `agent_task_events` table (latest 500 per task), so clients can reconnect with `?after=<event-sequence>` and recover the execution timeline, including tool activity and artifact creation. Tasks can continue an existing agent session by including `session_id`. Tasks persist in `ULTRAN_DATA_DIR/agent_tasks.sqlite3`; queued work resumes after restart, while work interrupted mid-execution is marked `interrupted` and requires an explicit retry. Failed tasks also require a manual retry, rather than being blindly replayed after a possible partial side effect. Only queued tasks can be cancelled. Retries are capped at five attempts, and each tool write still uses the normal human-approval gate. Task messages, events, and results are encrypted at rest when `ULTRAN_CREDENTIAL_ENCRYPTION_KEY` is configured. The phone composer includes a Background mode that queues a run and renders its live event stream in the conversation. Agent Workspace can launch a parallel team of 2–5 enabled agents against a shared objective; each agent runs independently with its own tools, memory, approvals and task history. Completed runs can be selected and synthesized by a coordinator agent. The Agent Workspace screen lists recent runs and generated artifacts, refreshes active status periodically, and exposes queued-task cancellation and explicit retry for failed or interrupted runs.

Agents now support durable, workspace-scoped long-term memories in the `agent_memories` table. Add a memory with `POST /v1/agents/{agent_id}/memories`, list it with `GET /v1/agents/{agent_id}/memories`, remove one with `DELETE /v1/agents/{agent_id}/memories/{memory_id}`, or clear the workspace memory set with `DELETE /v1/agents/{agent_id}/memories`. Send `X-Ultran-Workspace` to scope memories; each workspace is isolated. Up to 100 memories per agent/workspace are stored, and the most relevant bounded set is included as explicitly untrusted reference context on later chats. Memory content is encrypted at rest when `ULTRAN_CREDENTIAL_ENCRYPTION_KEY` is configured. Clearing a chat transcript does not erase long-term memories; delete or clear memories explicitly.

MCP human approvals are persisted separately in `ULTRAN_DATA_DIR/approvals.sqlite3`. Pending requests survive a backend restart, decisions and expiry are retained for audit, and the approval gate continues to reject expired, mismatched, or already-decided requests. Composio pending-call arguments are stored in `ULTRAN_DATA_DIR/composio_approvals.sqlite3` only when the encryption key is configured, and are Fernet-encrypted at rest. The databases are created with restrictive file permissions; keep `ULTRAN_DATA_DIR` on persistent storage and include it in backups.

When `ULTRAN_CREDENTIAL_ENCRYPTION_KEY` is configured, agent system prompts and
message contents are Fernet-encrypted at rest using that same operator-managed
key. Production requires this key; back it up securely because losing it makes
stored credentials and encrypted agent memory unrecoverable. Keep the data
 directory private and include it in your encrypted backup plan.

Composio-backed requests can now re-plan for up to three bounded steps after
successful read-only results (for example, search a mailbox, fetch a matching
message, then summarize it). The total tool-call budget still applies, repeated
actions are not re-run, and a pending human approval stops the chain immediately.
Tool output is passed back as untrusted data, never as agent instructions.

The separate TypeScript `@ultran/agent-core` now has an experimental Ollama
adapter and loopback-only `/models`, `/models/load`, and `/infer` endpoints.
That runtime is not yet wired into the phone chat or a complete tool-execution
orchestrator; model discovery, digest verification, and inference are implemented
but end-to-end agent actions remain unfinished.

---

## Deploy the API on Hetzner Cloud

Ultran now includes a single-server deployment baseline and Terraform provisioning
in [`infra/hetzner`](infra/hetzner/README.md). It uses Ubuntu 24.04 LTS, Docker
Compose, and Caddy for automatic HTTPS. Terraform creates the VPS, restricted
Cloud Firewall, non-root operator account, and initial host hardening. The API container runs as a non-root
user, has a read-only root filesystem, and stores its encrypted credential vault
on a persistent Docker volume. Only ports 80 and 443 are exposed by Compose;
the API's port 8080 stays private.

**This is deployment infrastructure, not a claim that a server is already
running.** No Hetzner VPS, DNS record, production encryption key, or live
service is provisioned by this repository change. Follow the full
[Hetzner operations guide](infra/hetzner/README.md) before exposing the API.

Quick outline:

1. Set `HCLOUD_TOKEN` in your local environment and prepare
   `infra/hetzner/terraform/terraform.tfvars` using its example file.
2. Review and apply the Terraform plan to create an Ubuntu 24.04 VPS and
   restricted Hetzner Cloud Firewall. SSH is allowed only from your admin IP.
3. Connect as the non-root operator, install Docker Engine and Compose, and
   verify the host hardening completed successfully.
4. Point an API DNS A record at the VPS, copy
   `infra/hetzner/.env.example` to `.env`, and set the domain, ACME email,
   and exact web-app CORS origins.
5. Generate the Fernet credential-encryption key on the server and back it up
   securely outside the VPS. Never commit it or paste it into chat.
6. Start the stack with `docker compose up -d --build`, then verify HTTPS,
   health checks, private API access, backup restoration, and monitoring.

The SQLite credential vault is designed for one API instance with persistent
storage. Do not scale this Compose service horizontally until the vault and
transactional state have been migrated to a shared database. The current
deployment guide also covers encrypted off-server backups, recovery, updates,
and rollback.

## Core Concepts

<details>
<summary><b>Brain runtime</b> — how inference is supervised</summary>

The runtime is a supervisor around pluggable backends (`llama.cpp`, MLX,
ONNX Runtime, and an opt-in remote fallback). It owns model lifecycle:
download, checksum verification, quantization, loading, LRU eviction, and
token budgeting. All inference streams; nothing blocks the event loop.
A model never loads without a verified content hash.
</details>

<details>
<summary><b>Connector registry</b> — how capabilities are declared</summary>

A connector is a package with a manifest: an ID, a semver version, a list of
capabilities (`repo:read`, `issue:write`), an auth spec, JSON-schema tool
definitions, and an egress allow-list. The registry validates that every tool
only references declared capabilities and hosts, probes health, and brokers
credentials as opaque handles — the sandbox never sees a raw secret.
</details>

<details>
<summary><b>Agent orchestrator</b> — how a goal becomes a run</summary>

A loop of observe → plan → act → reflect. The planner builds a DAG of steps
and replans after each observation. The dispatcher runs ready nodes in
parallel where the DAG allows. Memory is three-tiered: working context,
episodic run log, and a local semantic vector store. Every state transition
is appended to the run's event log.
</details>

<details>
<summary><b>Tool sandbox</b> — how side effects are contained</summary>

Each invocation happens in an isolated worker (WASM for pure functions,
container for network/filesystem work). Grants are signed, short-lived, and
single-use. Filesystem is read-only by default, network is limited to the
manifest's egress allow-list, and CPU, memory, and wall clock are capped.
Every call is audited with argument and result hashes.
</details>

<details>
<summary><b>Monetization layer</b> — how usage becomes revenue</summary>

Meters are emitted as events (`tokens.in`, `tool.calls`), folded into an
idempotent usage ledger, and checked against a signed, offline-verifiable
entitlement. The policy gate returns `allow`, `deny`, or `degrade` — so a
budget overrun can downgrade to a smaller local model instead of failing the
run. Billing adapters (Stripe, in-app purchase) are pluggable. No personal
content ever leaves the device for metering.
</details>

---

## Roadmap

- [x] Monorepo skeleton and workspace tooling
- [x] Architecture specification
- [ ] Brain runtime: llama.cpp backend + model cache verification
- [x] Connector SDK: manifest schema, validator, registry, and ten provider manifests (GitHub, Slack, files, Notion, Discord, Telegram, Google Drive, OpenAI, Anthropic, Ollama)
- [ ] Complete and verify provider execution adapters and in-app credential authorization
- [ ] Orchestrator: DAG planner, event log, replay
- [ ] Sandbox: WASM worker host, grant issuance
- [ ] Web console: run inspector and connector browser
- [ ] Mobile client: local brain pairing
- [ ] Monetization: usage ledger and entitlement verification

---

## Project Status

**Pre-alpha.** The repository contains working components and tests, including
a Python control plane, provider credential vault and verification, agent
runtime integrations, and an initial Render deployment blueprint. The full
product is not production-ready: hosted infrastructure has not been provisioned,
and end-to-end operational verification, broader runtime integration, and
production hardening remain in progress. Expect breaking changes until
`v0.1.0`.

---

## Contributing

1. Read [`docs/architecture.md`](docs/architecture.md) — layer boundaries are
   load-bearing and changes that cross them need an ADR.
2. Keep changes focused and coordinate edits against the latest `main`.
3. Keep commits conventional (`feat:`, `fix:`, `chore:`, `docs:`).
4. `pnpm typecheck && pnpm test` must pass before considering a change ready.

Architectural decisions are recorded as ADRs in the decision log at the end of
the architecture document.

---

## Security

Please **do not** open public issues for vulnerabilities. Report them privately
via GitHub's [private vulnerability reporting](https://github.com/luokai25/ultran/security/advisories/new).

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE). See [`NOTICE`](NOTICE)
for attribution.

---

<sub>Ultran — think local, act deliberately.</sub>


### Dynamic tools and file artifacts

Ultran exposes a unified, searchable tool catalog at `GET /v1/tools/catalog`.
It combines native file-generation tools, workspace connector manifests, and
tools discovered from enabled MCP servers. Use `query`, `source`, `limit` (up
to 500 per page), and `offset` instead of injecting the full catalog into an
agent prompt. MCP discovery is paginated at `GET /v1/mcp/tools` (up to 5,000
entries per page). Agents receive only a small task-relevant subset.

Native artifact generation supports PDF, PowerPoint (`pptx`), Word (`docx`),
Excel (`xlsx`), HTML, Markdown, text, CSV, JSON, and SVG. The Office/PDF
formats use maintained document libraries, with dependency-light fallbacks.
Create artifacts via `POST /v1/artifacts`; list them via `GET /v1/artifacts`;
preview and download URLs are returned per artifact. Files and metadata are
workspace-scoped and stored below `ULTRAN_DATA_DIR/artifacts`. HTML content is
sanitized before preview, and preview responses use a restrictive sandbox CSP.
Agent chat recognizes explicit file-generation requests and creates the
requested artifact from the generated answer. The phone client presents
preview and download actions alongside tool activity.

MCP-backed agents can use dynamically discovered, explicitly read-only tools
from MCP servers enabled in their workspace. Each unattended call receives a
short-lived, single-use, read-scoped grant and passes schema, egress, timeout,
and audit enforcement. Write, delete, execute, and admin tools remain behind
the human grant and approval flow.

Agent chat also has a streaming endpoint at `POST /v1/agents/{agent_id}/chat/stream`.
It emits server-sent events for planning, tool discovery, tool starts/completions,
artifact creation, approval waits, errors, and the final result. The phone client
uses this stream to show live run activity, then keeps a compact execution
history with in-app artifact previews and downloads. The regular JSON chat route
remains available for older clients and integrations.

## Built-in terminal (Termux upstream)

Ultran vendors the official Termux `terminal-emulator` and `terminal-view` Android library modules from upstream commit `8629e632fcb95da272221be327db653fb24befe`. The current integrated shell is Android `/system/bin/sh` in Ultran’s private app sandbox. This does not yet install Termux’s package bootstrap or Linux utilities. See `apps/phone/android/termux-upstream/UPSTREAM.md`.
