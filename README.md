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

### Enable real local-model reasoning

The Android shell is a chat client, not a bundled LLM. For actual language-model
responses, run Ollama and the Python control plane on a trusted computer or
local server, then enter that server's LAN address in **Settings → Brain
endpoint** in the phone app.

```bash
# Install Ollama separately, then fetch the model once:
ollama pull llama3.1:8b

# In the repository root:
cd ultran-backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

# Prefer local Ollama; Echo is an explicit degraded/offline fallback.
ULTRAN_BRAIN_BACKEND=ollama \
ULTRAN_BRAIN_MODEL=llama3.1:8b \
ULTRAN_BRAIN_FALLBACKS=echo \
python -m ultran_backend
```

The backend listens on `127.0.0.1:8080` by default. To reach it from a phone,
set `ULTRAN_HOST=0.0.0.0` and connect using the computer's LAN IP, but only on
a trusted network and with firewall access limited to your devices. Do not
expose this development backend directly to the public internet.

The separate TypeScript `@ultran/agent-core` now has an experimental Ollama
adapter and loopback-only `/models`, `/models/load`, and `/infer` endpoints.
That runtime is not yet wired into the phone chat or a complete tool-execution
orchestrator; model discovery, digest verification, and inference are implemented
but end-to-end agent actions remain unfinished.

---

## Deploy the API on Hetzner Cloud

Ultran now includes a single-server deployment baseline in
[`infra/hetzner`](infra/hetzner/README.md). It uses Ubuntu 24.04 LTS, Docker
Compose, and Caddy for automatic HTTPS. The API container runs as a non-root
user, has a read-only root filesystem, and stores its encrypted credential vault
on a persistent Docker volume. Only ports 80 and 443 are exposed by Compose;
the API's port 8080 stays private.

**This is deployment infrastructure, not a claim that a server is already
running.** No Hetzner VPS, DNS record, production encryption key, or live
service is provisioned by this repository change. Follow the full
[Hetzner operations guide](infra/hetzner/README.md) before exposing the API.

Quick outline:

1. Create an Ubuntu 24.04 VPS and attach a Hetzner Cloud Firewall.
2. Allow inbound TCP 22 only from your administration IP, plus TCP 80/443.
   Do not expose 8080, database ports, or model-server ports.
3. Install Docker Engine and Compose, harden SSH, enable security updates and
   fail2ban, and configure host firewall rules.
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
- [x] Connector SDK: manifest schema, validator, first three connectors (github, slack, files)
- [ ] Orchestrator: DAG planner, event log, replay
- [ ] Sandbox: WASM worker host, grant issuance
- [ ] Web console: run inspector and connector browser
- [ ] Mobile client: local brain pairing
- [ ] Monetization: usage ledger and entitlement verification

---

## Project Status

**Pre-alpha.** The repository contains working components and tests, including
a Python control plane, provider credential vault and verification, agent
runtime integrations, and an initial Hetzner deployment baseline. The full
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
