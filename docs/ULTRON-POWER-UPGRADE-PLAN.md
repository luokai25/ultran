# ULTRON Power Upgrade Plan

**Status:** Phase 1 local MCP persistence complete; native MCP manager and public-endpoint preflight added to the shared client; Phase 2 cloud bridge next  
**Repository:** `luokai25/ultran`  
**Integration rule:** work directly on `main`; preserve the existing local-first architecture  
**Cost rule:** reuse the current Supabase, Vercel, Cloudflare and existing provider integrations; no new paid service or dependency without explicit approval.

## Product objective

Turn ULTRON into a dependable personal AI operating system: one identity and memory layer, one capability registry, one policy-enforced execution path, and a set of local/cloud workers that can research, create, code, automate and deliver work across the Android app and web client.

The system must remain model-independent. OpenAI-compatible, Google, Groq, OpenRouter, local Ollama and future model providers supply reasoning; ULTRON owns identity, planning, tools, permissions, memory, execution, verification and delivery.

## Existing implementation confirmed on 2026-11-09

This is not a greenfield MCP project. The repository already contains:

- A Python MCP client runtime with **stdio and Streamable HTTP transports**, protocol handshake, paginated tool discovery, connection health, manifest hashing/pinning and failure isolation.
- A policy gateway with tool schemas, capability filtering, signed grants, approval gates, payload/time budgets, URL egress allow-lists and audit metadata.
- MCP servers projected into the existing connector registry, so built-in and MCP tools can share the same catalog and execution contract.
- A read-only MCP server mode that lets external MCP hosts inspect ULTRON without granting them the ability to register servers, issue grants or approve actions.
- A built-in connector catalog and a Composio-hosted OAuth/MCP integration.
- A Supabase connector connection table with owner-scoped RLS, plus an authenticated Supabase Edge Function for the Composio flow.
- Supabase-backed cloud jobs, maintenance scheduling, skills/tool specs, generated-tool lifecycle, memory and artifact infrastructure.

### Gaps found

1. **MCP runtime state is not cloud-shared.** The current durable registry lives with the authenticated backend in SQLite; Supabase connector rows represent Composio accounts, not a cross-device cloud registry of arbitrary MCP endpoints and their manifests.
2. **Native MCP manager is implemented in the shared phone/web client, with remaining lifecycle gaps.** The Connectors screen can register a public HTTPS Streamable HTTP endpoint, keep an optional bearer token in the encrypted backend registry, probe/reload tools, display health and manifest hashes, inspect tool schemas/capabilities, remove servers and review recent calls. Remaining work: server editing, manifest pin/review, grant/approval controls and a cloud-shared registry. Stdio stays a backend/local-runtime feature and is not exposed as arbitrary command execution from the phone.
3. **Production API owner authentication — CI verified, production configuration still required.** FastAPI requires a live Supabase bearer session on non-health routes, verifies the user through Supabase Auth, checks the RLS-backed singleton owner, ignores caller-selected workspace headers and fails closed when auth is unavailable. The phone client attaches its owner session to API requests and task event streams. Production requires `ULTRON_SUPABASE_URL` and `ULTRON_SUPABASE_PUBLISHABLE_KEY` in the private server `.env`; verify the deployed health check after configuration. Latest CI covers owner auth and workspace isolation.
4. **Cloud and local execution have different capabilities.** Cloud Edge Functions cannot spawn arbitrary stdio processes. The cloud MCP bridge should support remote Streamable HTTP only; stdio remains a local runtime capability.

## Current security implementation

- **Committed to `main`:** FastAPI owner-session middleware, Supabase Auth verification, RLS-backed singleton-owner verification, production workspace pinning, and bearer propagation from the phone client.
- **Deployment prerequisite:** set `ULTRON_SUPABASE_URL` and `ULTRON_SUPABASE_PUBLISHABLE_KEY` in `infra/hetzner/.env` before restarting a production API. The publishable key is not a service-role secret. Never add a service-role key to the phone app.
- **Verification:** latest CI passes the production-auth regression tests. The API must not be exposed publicly until the deployment environment is configured and the new build passes its health check.

Google Workspace setup guide: [`GOOGLE-WORKSPACE-CONNECTOR.md`](GOOGLE-WORKSPACE-CONNECTOR.md).

## Target architecture

### 1. ULTRON Core
- Single identity and system instruction layer, separate from any model provider.
- Task classifier and planner that selects quick, standard, deep or critical execution.
- Model router with health-aware provider fallback, context budgets and cost limits.
- Structured tool-call contract; model output never directly grants itself permission.

### 2. Unified Capability Gateway
One registry and one policy pipeline for:
- Built-in native connectors.
- Remote MCP servers over Streamable HTTP.
- Local MCP servers over stdio or HTTP.
- Composio-managed OAuth toolkits.
- Future OpenAPI/REST adapters and ULTRON-authored skills.

Every tool must expose a validated schema, declared capabilities, auth requirements, exact egress hosts, trust level, version and owner/workspace scope. Unknown capabilities default to approval-required, never read-only.

### 3. Durable connector control plane
- Persist server definitions, connection metadata, trust decisions, pinned manifest hashes and discovered tool schemas.
- Encrypt endpoint headers, environment values and OAuth credentials at rest. Never store raw secrets in public tables or return them to the client.
- Separate metadata from secret material; use the existing encrypted credential vault or a dedicated server-side secret store.
- Persist grants, approval decisions and tool-call audit events with owner/workspace scope.
- Health checks and probes must not execute write-capable tools.

### 4. Cloud MCP bridge
- Supabase-authenticated owner identity, enforced server-side.
- Remote Streamable HTTP transport only; no arbitrary command execution or stdio in Edge Functions.
- Strict hostname/port allow-list, DNS/IP private-range checks, redirect revalidation, request and response size limits, timeouts and per-connector rate limits.
- OAuth and API credentials remain server-side.
- RLS on every exposed table; no service-role key in the APK or browser.
- Writes, deletes, execution and admin actions require a fresh, exact, expiring approval.

### 5. Agent and skill system
- ULTRON remains the supervisor; specialist agents are scoped workers, not competing identities.
- Skills are versioned, signed/hashed packages with declared tools, inputs, outputs and permissions.
- Generated tools move through draft → static validation → sandbox tests → evaluation → approval → active → rollback/retire.
- No generated code can grant itself permissions or directly access secrets.
- Use existing job queue and worker infrastructure rather than creating a second scheduler.

### 6. Memory and knowledge
- Hot memory: current conversation, active task state and short-lived working context.
- Warm memory: owner-approved facts, preferences, project decisions and recent task summaries.
- Cold memory: indexed documents, artifacts, tool traces and historical knowledge.
- Retrieval must be owner-scoped, source-aware and capable of honoring corrections/deletions.
- Memory consolidation runs as a bounded background job with evidence and provenance.

### 7. Autonomy and delivery
- Plan → execute → verify → repair/retry within explicit budgets → deliver artifact and summary.
- Long tasks run through the existing durable Supabase queue.
- User-visible status must reflect real job state; no fake progress or silently disappearing work.
- Destructive or external side-effect actions pause for human approval.
- Maintenance, stale-lease recovery, memory consolidation and health checks remain background operations.

### 8. Android and web experience
The canonical client remains `apps/phone`, shared by the web client and Capacitor APK. Add a native MCP manager to the existing Connectors area, not a separate competing connector system.

Required MCP manager states:
- Empty, configured, connecting, healthy, failed and quarantined servers.
- Add/edit endpoint, transport, authentication method and exact allowed hosts.
- Probe/handshake and discovered tool inventory.
- Manifest hash/pin changes with explicit trust review.
- Per-tool capability display, enable/disable, grant and approval state.
- Credential connected/expired/revoked states with masked metadata only.
- Recent tool-call audit, latency and failure details.
- Responsive layouts, keyboard/focus handling and Android safe-area support.

## Delivery phases and acceptance criteria

### Google Workspace connector — implemented; awaiting owner credential
- **Implemented:** add one Google Super OAuth connection to the phone connector catalog. It routes through the existing owner-authenticated Supabase Edge Function and Composio gateway.
- **Implemented:** one account can expose Gmail, Calendar, Drive, Docs, Sheets, Contacts, Tasks and Meet tools through a single toolkit. Tool schemas are discovered dynamically from the provider.
- Google credentials are never pasted into chat or shipped in the APK. The owner signs in on Google's own OAuth consent page. The Composio project key is kept in Supabase Vault.
- **Implemented:** the agent's local tool router recognizes Google Workspace service requests and routes discovery/invocation through the shared connector gateway. External writes remain permission-gated; the model cannot grant itself write permissions.
- Current blocker before live connection: the Supabase owner settings report that the Composio gateway key is not configured. The owner must create a free Composio project key and enter it in the ULTRON Connectors screen before the Google OAuth button can create a connection.


### Phase 1 — durable MCP foundation
1. **Implemented:** SQLite-backed native MCP server registry. Public server definitions persist across restarts; environment values and HTTP headers are encrypted with the existing Fernet credential key. Secret-bearing definitions fail closed when encryption is not configured. Environment-defined servers remain authoritative over persisted UI registrations.
2. Persist and restore safe server definitions on restart; reject persistence of secret-bearing config when encryption is unavailable.
3. Persist grant signing material safely so a restart does not silently invalidate every legitimate grant; keep expiry, revocation and single-use checks.
4. Make tool-call audit history durable with bounded retention and secret redaction.
5. Add tests for restart recovery, encryption-required behavior, tamper detection, grant expiry/revocation/single-use and audit redaction.
6. Preserve the existing MCP protocol, connector projection and permission pipeline.

**Exit criteria:** local server definitions, encrypted credentials, persistent grants and bounded audit retention have regression tests. The latest full CI run passes. Remaining hardening: pin resolved DNS addresses to the actual HTTP connection and add a dedicated durable cloud registry in Phase 2.

### Phase 2 — authenticated cloud MCP bridge
**Next implementation target.** First close the critical FastAPI production authentication gap described in the audit. Then design the cloud registry and remote Streamable HTTP bridge with strict egress protections before enabling endpoint invocation.
1. Add owner-scoped Supabase schema for remote MCP server metadata and discovered tools.
2. Add authenticated Edge Function operations for register, probe, list, enable/disable and invoke.
3. Implement Streamable HTTP client with SSRF-safe egress and strict resource limits.
4. Persist grants, approvals and audit events in Supabase.
5. Add RLS and security/performance advisor verification.

**Exit criteria:** a user can register a remote HTTP MCP endpoint from the phone, probe it, see its tools and invoke a read-only tool without exposing credentials; write tools pause for exact approval.

### Phase 3 — canonical connector manager
1. **Partially implemented:** the shared `apps/phone` Connectors screen now includes Composio OAuth plus a native remote MCP manager.
2. **Implemented:** register a public HTTPS endpoint, optionally supply a bearer token (cleared from the form and stored in the encrypted backend registry), handshake, inspect discovered tool schemas/capabilities, probe, view health/manifest hash and remove a server.
3. **Implemented:** Google OAuth completion is detected automatically after the browser consent flow; connector search and category filters remain visible; write actions are disabled until an exact tool is explicitly granted.
4. **Implemented:** recent MCP call metadata is displayed and refreshed every five seconds while the Connectors screen is open. The source audit is durable in the backend SQLite store.
5. Remaining: edit server definitions, pin/review manifest changes, manage per-tool MCP grants/approvals in the UI, unify cloud MCP records, and expose a safe local-stdio manager only in an appropriate desktop/local-runtime context.
6. Keep all current connector actions and the existing Composio flow working; complete responsive and Android regression tests.

**Exit criteria:** every visible control works; the same feature works in web and APK; no secret is stored in browser/local storage; manifest trust and grants are reviewable.

### Phase 4 — agent supervisor and skill lifecycle
1. Add explicit multi-step task plans and specialist worker delegation.
2. Route all tools through the same capability gateway.
3. Improve sandboxed skill/tool generation, test/evaluation, approvals, activation and rollback.
4. Add run traces and recovery for interrupted jobs.

### Phase 5 — memory and proactive operation
1. Complete hot/warm/cold memory retrieval and consolidation.
2. Connect project files and approved sources to grounded retrieval.
3. Add proactive task suggestions and scheduled maintenance using existing cron/queue infrastructure.
4. Keep autonomous work bounded, observable and interruptible.

### Phase 6 — research, creation and delivery
1. Add reusable research, browser, coding, document, spreadsheet, image, voice and media workflows through registered connectors.
2. Improve the existing product studio and artifact pipeline.
3. Require source/evidence validation before delivery and provide downloadable artifacts through private storage.

### Phase 7 — hardening and release
1. Run full phone, backend, Supabase security and Android build suites.
2. Review all auth, RLS, secret, SSRF, egress, permission and approval boundaries.
3. Verify the production web deployment and signed APK release assets.
4. Publish a capability matrix showing what is live, local-only, cloud-only, unavailable or awaiting credentials.

## Connector strategy

Prefer this order:
1. Existing ULTRON native capabilities and local tools.
2. Existing Supabase, GitHub, Vercel and Cloudflare integrations for development/deployment.
3. Firecrawl/Exa/Browser Use for research and browsing, subject to user-connected credentials and terms.
4. Existing Composio OAuth gateway for supported SaaS accounts.
5. Direct remote MCP or OpenAPI connectors where a provider is not covered.
6. Voice/media/document integrations only when configured and their cost is understood.

An external ChatGPT connector is not automatically an ULTRON connector. ULTRON must connect through its own secure API, MCP endpoint, OAuth flow or supported provider adapter. The ElevenLabs MCP registry is specific to ElevenLabs agents; Plugin Creator creates ChatGPT plugins, not ULTRON MCP servers.

## Security invariants

- Never put provider secrets, service-role keys, signing keys or GitHub tokens in the APK, frontend bundle, logs, commits or model context.
- Rotate any credential that has been pasted into chat, a repository instruction or an otherwise exposed plaintext file.
- Never trust a model-proposed capability, connector manifest or tool result as authorization.
- Default unknown tools to approval-required.
- Bind grants, approvals, connector records and audit events to the authenticated owner and workspace.
- Block loopback, private, link-local and metadata IP ranges for cloud egress; revalidate redirects and resolved addresses.
- Use RLS on every exposed Supabase table and verify policies with Supabase advisors.
- Keep destructive operations and external side effects behind exact, expiring, single-action approvals.

## Audit notes and known operational checks

- Supabase migrations currently include the connector metadata, cloud skills/tool specs, durable job queue, maintenance scheduler, brain memory and product-studio worker foundations.
- Active cron jobs observed: brain supervisor every minute, cloud job worker every minute and maintenance queue every five minutes.
- Security advisor currently reports leaked-password protection disabled; enable it in Supabase Auth settings.
- Performance advisor currently reports unused indexes. Do not remove them just because the project is young; re-check after real query volume.
- Android release workflow run #1070 completed successfully and published a signed APK asset: https://github.com/luokai25/ultran/releases/download/android-v3.0.4-b1070/ultron-3.0.4.apk. This release was built from commit 1af9e62, before the current MCP registry commits.

## Working rule

Implement one phase at a time, verify it with tests and live checks, commit directly to `main`, and do not claim deployment or device verification unless it has actually succeeded.
