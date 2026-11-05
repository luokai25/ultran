# ULTRON cloud infrastructure

## Cloud LLM gateway

ULTRON uses five provider-specific key pools. The raw API keys are stored in Supabase Vault; the public tables contain only Vault UUID references, SHA-256 fingerprints and non-secret operational metadata.

| Provider | Table | API console |
|---|---|---|
| OpenRouter | `ultron_openrouter_keys` | https://openrouter.ai/settings/keys |
| Mistral | `ultron_mistral_keys` | https://console.mistral.ai/api-keys/ |
| Cerebras | `ultron_cerebras_keys` | https://cloud.cerebras.ai |
| Groq | `ultron_groq_keys` | https://console.groq.com/keys |
| Cohere | `ultron_cohere_keys` | https://dashboard.cohere.com/api-keys |

Add keys from the phone app's **LLM API KEYS → Ultron Supabase** panel, or insert a row directly in the provider table. For direct Table Editor entry, paste the raw key only into the `api_key_input` column and optionally set `label`; leave `owner_id`, `vault_secret_id` and `key_fingerprint` blank. A BEFORE trigger moves the key into Vault in the same transaction, clears `api_key_input`, fills the owner and fingerprint, and sets the row to `pending`. The minute supervisor verifies pending keys against the provider model-list endpoint and updates their status/models. Multiple keys per provider are supported. Never paste the raw key into any other column.

`ultron-brain` provides key management, model catalog, streaming chat, status and provider-directory actions. It rotates between enabled keys, prefers higher-priority/less-recently-used keys, marks 401/403 credentials invalid/expired, cools down 429 keys, and falls back to another key. Usage counters are updated from provider usage metadata when returned. Providers do not expose a uniform remaining-token API, so exact remaining quota cannot be promised; rate limits and exhausted quotas are detected from provider responses.

Automatic chat routing is free-tier constrained: OpenRouter IDs must end in `:free`; Groq, Cohere and Mistral use configured free-tier model allowlists. Cerebras keys can be stored and verified, but Cerebras currently offers a one-time $5 trial after adding a verified payment method, expiring after 30 days; it is deliberately excluded from automatic zero-cost routing. This is not a billing guarantee: provider plans, eligibility, quotas and terms can change. Mistral Free mode and Cohere trial keys have limited quotas and data-use conditions; check the provider's current account limits and terms before using them. Do not use a provider route for sensitive content unless its data policy is acceptable.

The public directory at https://github.com/raullenchai/free-llm-api-resources is refreshed daily and stored in `ultron_settings.free_provider_registry`. It discovers provider resources; it does not contain reusable API credentials. ULTRON cannot create provider accounts, complete identity checks, accept provider terms, or mint keys on the owner's behalf. When all supplied quotas are exhausted, the cloud brain remains available for maintenance but generation waits for a quota reset or another valid key.

## Prometheus goal loop

The shared phone/cloud agent prompt uses a resumable goal loop: define success criteria, split substantial work into verifiable milestones, inspect available models/keys/tools/skills/connectors and phone-vs-cloud capabilities, execute, verify, and checkpoint progress. Capability gaps trigger catalog discovery first, then versioned ULTRON-owned tool/skill creation and bounded evaluation. Failed steps are diagnosed and retried through alternate providers, keys, tools or smaller sub-tasks; the loop stops only on verified completion or a concrete blocker.

The cloud brain estimates task complexity from recent user turns and ranks eligible free models by approximate parameter scale and task-fit signals (reasoning, coding and vision). It then ranks provider-key candidates by model score, key priority and least-recent use, with fallback across up to eight candidates. This is a routing heuristic, not a benchmark or a guarantee of unlimited compute: model availability, provider quotas, hardware, permissions and external services remain real constraints. Durable run checkpoints and the job queue let work resume after an app restart.

## Scheduled cloud worker

Supabase Edge Functions are serverless, not a permanently running VM. `pg_cron` invokes `ultron-brain` every minute using a random internal secret stored in Vault and delivered only as a server-to-server header. The supervisor checks key health, refreshes the provider directory, and invokes `ultron-jobs` to claim durable work. The system job claimer uses `FOR UPDATE SKIP LOCKED` and an owner-scoped lease.

The internal worker can process health checks, memory consolidation, generated workflow runs and queued connector actions. Generated workflows can use public HTTPS requests, owner-scoped Supabase reads/writes, schema authoring, ULTRON RPCs, memory search/save and text/JSON transforms. Memory consolidation uses the same Vault-backed free model pool instead of a single `ULTRON_MODEL_API_KEY` environment variable. Connector writes require an explicit `ultron_tool_permissions` grant. Generated workflow writes (`database.insert`, `database.update`, `database.ddl`, `database.rpc`, and non-GET HTTP requests) likewise require an owner permission with `access_mode = 'allow'` and `require_confirmation = false`. Internal schema authoring uses the owner-parameterized `ultron_apply_schema_change_system` RPC; service-role execution remains owner-scoped.

## Crash-only checkpoints

Before ULTRON changes generated tools, tool specs, skills or capability proposals, `ultron-capabilities` and `ultron-runtime` request a checkpoint from the independent brain supervisor. The checkpoint stores the last-known-good version IDs and lifecycle states. A failed mutation marks the change as crashed; if a process disappears mid-change, the supervisor detects a stale in-progress marker after five minutes. Recovery restores prior lifecycle states, removes new drafts, rejects/disables newly introduced tool versions, archives new skills, disables new tool specs and cancels new proposals. A bounded failure ledger records the failed action, fingerprint and diagnostic; the same fingerprint is rejected on retry, and the last six lessons are supplied to the cloud model as untrusted diagnostic context so it can correct the implementation rather than blindly repeat it.

Recovery is triggered only by an internal mutation failure or a stale in-progress code-change marker. Missing keys, invalid credentials, 429s and exhausted provider quotas are `waiting_for_keys`/`degraded` states and never trigger rollback. Versioned source artifacts remain available for inspection.

This rollback covers ULTRON-authored database-backed tools, skills, specs and proposals. It does not automatically redeploy the Supabase Edge Function source code or push a GitHub revert; those source deployments remain governed by GitHub/CI.

## Other cloud infrastructure

- **Connector gateway metadata:** `ultron_connector_connections` is the central registry for provider connections, scopes, status, expiry and Vault secret references.
- **Artifacts:** `ultron_artifacts` indexes generated files stored in the private `ultron-private` Storage bucket. `ultron-artifacts` issues owner-scoped signed uploads, verifies objects before registration, lists artifacts, creates five-minute download URLs and deletes both object and metadata. Maximum artifact size is 50 MB.
- **Background state replication:** `ultron_state_events` is an append-only, idempotent device event log keyed by device sequence. `ultron_state_snapshots` stores the latest versioned materialization.
- **Self-improvement evaluation:** `ultron_tool_evaluations` records deterministic test/evaluation outcomes for versioned tools and skills. Existing generated tools, tool specs, skills and capability proposals remain the source artifacts.
- **Maintenance:** `pg_cron` runs `ultron_enqueue_maintenance()` every five minutes. It requeues expired leases, terminates exhausted jobs, enqueues health checks and daily memory-consolidation work, and prunes completed/cancelled jobs older than 30 days.

## Dashboard shortcuts

- Table Editor: https://supabase.com/dashboard/project/vshoxrtrfleptqxkrmtc/editor
- SQL Editor: https://supabase.com/dashboard/project/vshoxrtrfleptqxkrmtc/sql/new
- Vault: https://supabase.com/dashboard/project/vshoxrtrfleptqxkrmtc/integrations/vault/secrets

The provider table links above open each key pool. Use `api_key_input` for direct entry; the trigger transfers it into Vault and clears the field. The phone app form remains the easiest path because it verifies the provider immediately.
