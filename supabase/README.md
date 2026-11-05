# ULTRON cloud infrastructure

## Architecture additions

- **Connector gateway metadata:** `ultron_connector_connections` is the central registry for provider connections, scopes, status, expiry, and Vault secret references. Provider credentials belong in Supabase Vault, never in tool definitions or ordinary metadata.
- **Artifacts:** `ultron_artifacts` indexes generated files stored in the private `ultron-private` Storage bucket. The `ultron-artifacts` Edge Function issues owner-scoped signed uploads, verifies uploaded objects before registration, lists artifacts, creates five-minute download URLs, and deletes both object and metadata. Maximum artifact size is 50 MB.
- **Background state replication:** `ultron_state_events` is an append-only, idempotent device event log keyed by device sequence. `ultron_state_snapshots` stores the latest versioned materialization. This is infrastructure only; it does not add a UI.
- **Self-improvement evaluation:** `ultron_tool_evaluations` records deterministic test/evaluation outcomes for versioned tools and skills. Existing tool specs, generated tools, skills, and capability proposals remain the source artifacts.
- **Maintenance:** `pg_cron` runs `ultron_enqueue_maintenance()` every five minutes. It requeues expired leases, terminates exhausted jobs, enqueues a health check and daily memory-consolidation work, and prunes completed/cancelled jobs older than 30 days.

## Current execution boundary

The maintenance scheduler enqueues durable work. It does not itself execute LLM-based memory consolidation or health diagnostics; those job types still need to be consumed by the ULTRON cloud worker. OAuth provider-specific authorization/callbacks and Vault secret lifecycle are likewise implemented by the gateway runtime, not by the metadata table alone.
