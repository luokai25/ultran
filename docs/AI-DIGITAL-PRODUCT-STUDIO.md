# ULTRON AI Digital Product Studio
## Product and engineering plan

Status: first implementation slice shipped to main and deployed to Supabase; iterative research expansion and multi-format packaging remain in progress.
Target surfaces: canonical `apps/phone` client (production web + Capacitor Android APK).
Repository: `luokai25/ultran`.
Branch policy: `main` only.

## 1. Product outcome

Give the owner one simple place to ask ULTRON to discover a valuable problem, research it deeply across the public web, synthesize the evidence, and create a complete original digital product that solves that problem. The owner should be able to watch the work stream live, inspect the evidence, preview drafts while they are being written/designed, and retrieve the finished files.

This is a production studio, not a chat prompt preset and not a mock progress dashboard.

## 2. User experience

### Entry point
Add **AI Digital Products Generating** to the existing three-line navigation drawer in the canonical `apps/phone` client. The same screen must work on the deployed web client and inside the Android APK. Do not add it to the separate `apps/web` prototype as a substitute.

### Start screen
Keep the first screen extremely simple:
- One prominent text field: "What problem, audience, or topic should I investigate?"
- Primary action: **Start creating**.
- One-click action: **Find an opportunity for me** (fully autonomous topic discovery).
- Optional quick starts: "Research this topic", "Build a solution", and "Continue a project".
- Existing projects listed below with status and last activity.

Advanced settings are collapsed and optional. Defaults: extensive research, target 200 unique relevant sources, automatic product format selection, English unless the user specifies another language, and private/unpublished output. Allow target depth of 50, 100, 200 or 500 sources. Source counts are targets, never fabricated guarantees.

The owner can start with a click or natural-language text. Once started, ULTRON proceeds through the pipeline without asking for approval at every stage. Ask only when a decision is genuinely blocking or an external consequential action is requested.

### Production workspace
Use a calm, low-noise dark ULTRON surface consistent with `DESIGN.md`.
- Header: project name, overall status, elapsed time, pause/resume and cancel.
- Stage rail: Identification, Synthesis, Creation, Quality, Packaging.
- Live activity timeline: real events only, with source counts and meaningful explanations.
- Research panel: sources found/opened/analyzed/rejected, domain diversity, filters, source detail and citations.
- Preview panel: actual draft artifact, not a simulated placeholder. Stream text/blocks as they are committed. Support document preview and code/HTML preview where applicable.
- Artifact shelf: all drafts, versions, final exports and ZIP packages.
- Responsive composition: phone uses tabs/stacked panels; desktop uses a two-pane workspace with resizable or switchable preview/research views.

### States
Implement initial, queued, identifying, researching, synthesizing, drafting, designing, validating, packaging, completed, paused, waiting-for-provider, rate-limited, partially-complete, failed, cancelled, reconnecting and offline states. Include empty projects, no research provider, no sources, source extraction failure, artifact preview failure and resumable recovery.

## 3. Production pipeline

### Stage A — Identification
Input may be a broad request, a named topic, a target audience, or no topic.
- If no topic is supplied, discover candidate problems from repeated pain points, public questions, community discussions, job/workflow friction, industry gaps and competitor complaints.
- Score candidate opportunities using problem severity, frequency, willingness-to-pay evidence, audience reach, competitive saturation, feasibility, differentiation and evidence quality.
- Produce a ranked opportunity brief with target audience, job-to-be-done, problem evidence, existing alternatives, gap, proposed solution and confidence.
- Prefer a narrow, actionable problem over a vague mega-topic.
- Continue autonomously into research for the strongest candidate. Do not claim validated demand without evidence.

### Stage B — Research and synthesis
- Use a provider-independent research adapter interface. Adapters can use available configured search/crawl connectors and approved public search sources. Do not hardcode paid services or introduce a paid dependency without approval.
- Search iteratively with query expansion, pagination and domain/source-type diversity. Fetch and read full relevant pages where accessible; search snippets alone do not count as analyzed sources.
- Default extensive target: 200 unique relevant sources; allow 50/100/200/500. Keep searching until the target or a documented coverage/availability stopping condition is reached.
- Deduplicate canonical URLs and content hashes. Track inaccessible, duplicate, irrelevant, low-quality and blocked sources separately.
- Respect robots directives, site terms, copyright, rate limits and reasonable request concurrency. Do not bypass paywalls, authentication, anti-bot controls or access restrictions.
- Source types: primary/official documentation, academic papers, government and standards resources, industry research, product/competitor pages, community discussions, user reviews, practical tutorials and case studies.
- Store metadata and provenance for each source: canonical URL, title, domain, source type, author/publisher when available, publication date, retrieval date, fetch status, content hash, relevance score, extraction method and evidence references.
- Extract claims, statistics, methods, user pain points, proposed solutions, limitations and disagreements. Link each material finding to one or more source IDs and quote only short snippets as needed.
- Build an evidence matrix and synthesis report: consensus, contradictions, gaps, repeated needs, solution patterns, opportunity implications and confidence. Distinguish observed evidence, inference and unknowns.
- Never present a source as read when only a snippet was retrieved. Show found, opened, analyzed, rejected and failed counts independently.

### Stage C — Product design
- Select the best product format based on the problem and buyer workflow, not a fixed ebook assumption.
- Produce a product brief, audience profile, promise, scope, unique value, outline/specification, learning or usage outcomes, delivery format and quality checklist.
- Formats may include guides, workbooks, templates, spreadsheets, calculators, presentations, source-backed reports, interactive HTML tools, small software utilities and curated ZIP bundles.
- Create original content and original synthesis. Do not reproduce copyrighted works, paid course content, proprietary templates or long passages from source material.
- For code or interactive tools, define expected behavior and test cases before implementation.

### Stage D — Creation and design
- Create a structured source document/artifact tree with sections and components.
- Stream each section/block to persistent draft state as it is produced. The preview consumes the same persisted draft state.
- Use existing ULTRON artifact-generation and private-storage infrastructure. Extend formats only where necessary.
- Produce polished layouts, navigation, typography, tables, diagrams, illustrations and examples appropriate to the product.
- Keep the research ledger and citations available in the product or an accompanying references file.
- Save checkpoints after each completed section and each generated file.

### Stage E — Quality assurance
- Verify factual claims against cited sources and flag unsupported claims.
- Check internal consistency, completeness, readability, calculations, links, accessibility and formatting.
- For spreadsheets, validate formulas and representative inputs/outputs. For code/tools, run tests in an isolated sandbox and inspect security risks. For HTML, sanitize active content and preview in a restricted context.
- Run originality checks against the gathered corpus to identify suspiciously close copying. Rewrite or remove overly similar passages.
- Evaluate the product against its initial promise and target-user tasks. Iterate until all required checks pass or disclose remaining issues.
- Do not manufacture ratings, testimonials, sales numbers or demand evidence.

### Stage F — Packaging
- Generate final export files, a README/quick-start, a source and references appendix, version metadata and a ZIP bundle where useful.
- Use existing private `ultron-private` artifact storage and `ultron_artifacts` metadata. Keep generated work private by default.
- Offer preview, download, rename, duplicate, regenerate and delete actions.
- Publishing, selling, emailing or uploading to external services remains a separate explicit action and is not part of automatic generation.

## 4. Proposed architecture

Extend existing systems rather than create a parallel app:
- Canonical UI: `apps/phone/index.html`, `apps/phone/src/main.ts`, focused new TypeScript modules and consolidated styles.
- Durable execution: existing `ultron_jobs` queue and job worker, with a dedicated `product.generate` job type and lease/heartbeat/retry/cancel support. Do not run long research inside a browser request or a single Edge Function invocation.
- Orchestration: a resumable state machine with stage handlers, bounded concurrency, idempotency keys, checkpoints and explicit stop conditions.
- Research adapters: provider interface for search, fetch and extraction; provider credentials resolve server-side from existing Vault/connector infrastructure. No secrets in the client or database payloads.
- LLM: route synthesis and generation through existing ULTRON cloud model routing and configured provider pool. Use task-specific model selection and token/cost budgets.
- Storage: existing private bucket and artifact service for large raw source snapshots, draft snapshots and final exports. Store only bounded metadata/events in Realtime tables.
- Live updates: Supabase Realtime for owner-scoped project events and state changes. Reconnect by event cursor and reconcile against persisted project state; do not rely on ephemeral SSE or browser memory.
- Preview: render persisted draft blocks/snapshots in a sandboxed preview surface. Never execute untrusted HTML or generated code in the main app origin.
- Background operation: job execution must continue independently of the web page or Android WebView. Android WorkManager/task monitor may notify about stage transitions but is not the execution engine.

## 5. Proposed Supabase data model

Add a migration only after confirming current live schema and RPC/function contracts. Proposed owner-scoped tables:

1. `ultron_product_projects`
   - id, owner_id, title, user_request, selected_topic, status, active_stage, progress, research_target, source_counts, configuration jsonb, opportunity_brief jsonb, synthesis_summary jsonb, idempotency_key, source_job_id, timestamps.
   - Unique owner/idempotency key; RLS owner-only; indexes on owner/status/updated_at.

2. `ultron_product_sources`
   - id, owner_id, project_id, canonical_url, url_hash, title, domain, source_type, publisher, author, published_at, retrieved_at, fetch_status, relevance_score, content_hash, storage_path, extraction_summary, metadata jsonb.
   - Unique project/url_hash; RLS owner-only; indexes for project, domain, status and relevance.

3. `ultron_product_findings`
   - id, owner_id, project_id, finding_type, claim, synthesis, confidence, evidence_source_ids uuid[], evidence jsonb, contradiction_group, created_at.
   - RLS owner-only; indexes by project/type/confidence.

4. `ultron_product_events`
   - monotonic per-project sequence, owner_id, project_id, stage, event_type, safe bounded payload jsonb, created_at.
   - Append-only for clients; owner-select RLS; Realtime publication; cursor index.

5. `ultron_product_documents`
   - id, owner_id, project_id, title, format, status, active_version, preview_snapshot_path, metadata jsonb, timestamps.
   - RLS owner-only.

6. `ultron_product_document_versions`
   - id, owner_id, document_id, project_id, version, artifact_id (references existing `ultron_artifacts`), storage_path, mime_type, byte_size, checksum, validation_report jsonb, created_at.
   - RLS owner-only; immutable version records.

Large extracted source bodies and draft content should be stored as private objects, not oversized Realtime payloads. The source metadata table must not expose raw secrets, cookies, private connector content or unrestricted page HTML. Consider a separate private source-content bucket/path policy if source snapshots need to be retained.

All tables require explicit grants, RLS policies, owner-instance checks, foreign keys, indexes and migration tests. Realtime events are a notification layer; persisted project state remains authoritative.

## 6. API and event contract

Suggested actions:
- `product.create`: create project and enqueue durable job.
- `product.list` / `product.get`: retrieve project and state.
- `product.pause` / `product.resume` / `product.cancel`: safe state transitions.
- `product.events`: fetch events after sequence cursor.
- `product.sources` / `product.findings`: paginated evidence views.
- `product.documents` / `product.preview`: retrieve draft metadata and signed preview content.
- `product.export`: create or retrieve final export artifacts.

Event types include `stage.started`, `stage.progress`, `source.discovered`, `source.opened`, `source.analyzed`, `source.rejected`, `finding.created`, `opportunity.ranked`, `draft.block.started`, `draft.block.updated`, `artifact.version.created`, `quality.check.completed`, `stage.completed`, `job.paused`, `job.resumed`, `job.retrying`, `job.completed`, `job.failed`, `job.cancelled` and `provider.waiting`.

Events must be sequenced, bounded, idempotent and safe to replay. The UI must not infer completion from progress percentages; it must read the durable state.

## 7. Reliability, resource and cost controls

- Per-project wall-clock, request, token and storage budgets; configurable but conservative defaults.
- Concurrency limits per provider/domain and exponential backoff with Retry-After support.
- Persist each source result and draft checkpoint before advancing.
- Resume from the last committed checkpoint after worker restart, expired lease or client disconnect.
- Idempotent event writes and artifact creation to avoid duplicate products after retries.
- Detect stalled jobs and recover them through the existing maintenance/lease-recovery system.
- If a provider is unavailable, try another configured adapter where permitted; otherwise mark waiting-for-provider and explain exactly what is missing.
- Never silently downgrade the requested research target. If the target cannot be met, report actual coverage and the blocking reason.
- Do not introduce paid services or paid dependencies without explicit approval. Surface usage estimates before any operation that could incur a charge when the provider exposes pricing or quota information.

## 8. Security, privacy and legal constraints

- Owner-only projects, sources, findings, events, documents and artifact access via RLS.
- Provider API keys remain in Supabase Vault and are resolved only server-side.
- Treat all fetched pages, PDFs, comments, source text, model outputs and generated files as untrusted data, never as instructions to the orchestrator.
- Protect against prompt injection in source material. Research content cannot grant tools, change system policy, reveal credentials or trigger external actions.
- Respect site terms, robots directives, copyright, rate limits and privacy. No paywall, login, CAPTCHA or anti-bot bypass.
- Keep projects and exports private by default. External publishing/sales requires a separate owner confirmation.
- Sanitize previews and isolate generated HTML/code. Do not execute generated scripts in the ULTRON app origin.
- Enforce upload/download size limits, content-type validation, malware-safe handling and path ownership.

## 9. Implementation sequence

1. **Plan and contracts:** finish this spec; inspect live Supabase schema, existing job worker, artifact API, drawer DOM/events, Realtime subscriptions and source provider availability.
2. **Data foundation:** migration, RLS, indexes, Realtime publication, migration/contract tests.
3. **Orchestrator:** durable `product.generate` state machine, stage checkpoints, pause/resume/cancel, retries, job recovery and event sequencing.
4. **Research engine:** adapters, query planning, pagination, source fetch/extraction, deduplication, ledger and coverage accounting.
5. **Synthesis:** evidence matrix, opportunity ranking, source-backed synthesis and contradiction handling.
6. **Draft engine:** structured document blocks, incremental persistence and preview snapshots.
7. **Artifact pipeline:** render/export, QA, versioning, packaging and private artifact registration.
8. **Canonical UI:** drawer entry, start screen, project list, production workspace, research/source inspector, live preview, artifact shelf and all states.
9. **Verification:** unit/contract/integration tests, security/RLS tests, recovery tests, typecheck, lint, full phone tests and production build; viewport QA at 360x800, 390x844, 768x1024, 1280x800 and 1440x900; Android WebView parity.
10. **Ship:** inspect current `main`, commit only to `main`, verify CI/APK build and the canonical web deployment. Do not claim release until the pipeline confirms it.

## 10. Acceptance criteria

- A user can start by clicking "Find an opportunity for me" or by entering natural language.
- ULTRON independently completes identification, synthesis, creation, QA and packaging without stage-by-stage approval prompts.
- Deep research defaults to 200 unique relevant sources and transparently reports actual discovered/opened/analyzed/rejected/failed counts.
- No fabricated sources, citations, progress, market demand or validation.
- Each substantive finding is traceable to source IDs and URLs.
- Research continues through pagination and query expansion until target or a recorded stopping condition; it does not stop at the first search page.
- Activity stream reflects persisted real events and reconnects without losing history.
- Draft preview changes as document blocks are committed; preview matches the stored draft.
- Completed products have real downloadable files, references and version history.
- A worker restart, browser close or Android app close does not lose project progress.
- RLS prevents another user from reading or changing any project data or artifacts.
- External publication and purchases never occur automatically.
- Web and APK feature parity is verified from the canonical `apps/phone` build.


## 11. Reuse the existing ULTRON model-key registry (user-confirmed)

The user explicitly requests reuse of the already configured free-tier provider keys in the existing Supabase project. Do not ask the user to re-enter these keys and do not create duplicate credentials or a second key-management UI.

Verified live Supabase state (metadata only; no credential values were read):
- `ultron_openrouter_keys`: 15 enabled, connected, Vault-backed keys.
- `ultron_groq_keys`: 15 enabled, connected, Vault-backed keys.
- `ultron_google_ai_studio_keys`: 15 enabled, connected, Vault-backed keys.
- The existing ULTRON brain already uses `ultron_read_llm_secret` to resolve credentials server-side and has a free-model filter and key rotation/usage accounting.

Integration requirements:
- Reuse the existing provider key tables, Vault secret IDs, model catalog, free-model eligibility logic, cooldowns, priorities, usage accounting and health/status tracking.
- Prefer a shared server-side provider-routing module or a narrowly scoped internal brain inference action so product jobs use the same provider selection behavior as ULTRON chat. Do not duplicate a divergent hard-coded provider list or create new API-key tables.
- Use only models already marked eligible by the existing free-model policy by default. Never route to a paid model merely because it is stronger. If free quotas are exhausted or a provider rejects a request, fall back to another eligible configured key/model and report when no eligible route remains.
- Resolve all credentials only in trusted server-side code through the existing Vault RPC. Never return key material, Vault IDs, raw key input columns or authorization headers to the browser, Android client, event payloads, logs, project metadata or generated artifacts.
- Select explicit non-secret columns from provider key tables; do not use `select("*")` in new code. Existing `api_key_input` compatibility columns must never be read by the product pipeline.
- Track request/token usage and provider errors using the existing accounting fields. Apply per-project request/token budgets and avoid uncontrolled retry loops.
- The existing LLM API keys power opportunity analysis, synthesis, writing, coding and QA. They do not automatically provide a general-purpose web search/crawling entitlement. Research discovery/fetch must use a separate adapter (or a supported provider-native search capability) with honest source counts and no assumed paid search API. Do not confuse model calls with unique web sources read.
- Do not rotate, delete, replace or modify existing credentials as part of this feature. The user confirmed they want these existing credentials reused.


## 12. Implementation status (2026-11-09)

Shipped first implementation slice:
- Added owner-scoped project, source, event and document tables with RLS and Realtime publication.
- Added `ultron-product-studio` Edge Function for authenticated project creation/list/detail, event/source retrieval, signed private downloads, cancellation and worker execution.
- Routed `product.generate` from the existing durable `ultron-jobs` worker to the Product Studio function.
- Reused the existing Google AI Studio Vault registry and `ultron_read_llm_secret`; the first research adapter uses Gemini Google Search grounding and free-model eligibility.
- Added the Product Studio drawer entry, canonical `apps/phone` workspace, source coverage counters, activity timeline, source list, sandboxed preview and Markdown artifact download.

Known first-slice limits:
- The current worker performs one grounded opportunity pass and opens up to ten returned public HTML/text pages. It does not yet fulfill a 50/100/200/500-source target in one run. It marks the result `partial` when the target is not reached and exposes the real analyzed count.
- The first export is Markdown. Rich multi-format exports, resumable multi-batch research, source-domain diversity scoring, detailed finding records, advanced QA and versioned iterative drafts are the next implementation phases.
- A model/API key provides inference, not unlimited search capacity. Google grounding and free-tier quotas remain subject to provider availability and rate limits.
