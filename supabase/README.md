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

Add keys from the phone app's **LLM API KEYS → Ultron Supabase** panel. Select a provider, paste a key, and save. The gateway verifies the credential against the provider's model-list endpoint before storing it. Multiple keys per provider are supported. Do not paste plaintext keys into the Supabase Table Editor; the tables intentionally have no client-side write grant and do not contain the secret value.

`ultron-brain` provides key management, model catalog, streaming chat, status and provider-directory actions. It rotates between enabled keys, prefers higher-priority/less-recently-used keys, marks 401/403 credentials invalid/expired, cools down 429 keys, and falls back to another key. Usage counters are updated from provider usage metadata when returned. Providers do not expose a uniform remaining-token API, so exact remaining quota cannot be promised; rate limits and exhausted quotas are detected from provider responses.

Automatic chat routing is free-tier constrained: OpenRouter IDs must end in `:free`; Cerebras, Groq, Cohere and Mistral use the configured free-tier model allowlists. This is not a billing guarantee: provider plans, eligibility, quotas and terms can change. Mistral's free Experiment mode can involve data-use conditions; the app warns before saving a Mistral key. Do not use a provider route for sensitive content unless its data policy is acceptable.

The public directory at https://github.com/raullenchai/free-llm-api-resources is refreshed daily and stored in `ultron_settings.free_provider_registry`. It discovers provider resources; it does not contain reusable API credentials. ULTRON cannot create provider accounts, complete identity checks, accept provider terms, or mint keys on the owner's behalf. When all supplied quotas are exhausted, the cloud brain remains available for maintenance but generation waits for a quota reset or another valid key.

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

Use the app key form to add credentials. Table Editor is for inspecting metadata; it is deliberately not a raw-key entry point.
