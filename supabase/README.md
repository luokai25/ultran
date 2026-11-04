# ULTRON Supabase backend

This Supabase project is a private, single-owner backend for the ULTRON Android assistant. It is separate from every Luo Chat Supabase project. It is not a public service and is not intended to support public registration or multiple human accounts.

## Architecture boundaries

- The phone remains local-first. Core inference, local files, and offline tools must continue working without Supabase.
- Supabase stores encrypted/sensitive application state only behind authenticated access and database-enforced row policies: conversations, messages, long-term memory, memory relations, documents, task state, tool approvals/audit records, model profiles, settings, and device sync cursors.
- Supabase Realtime is enabled for conversations, messages, tasks, tool runs, memory items, and per-owner settings.
- The `ultron-private` Storage bucket is private. Object paths must begin with the owner's Auth UUID.
- pgvector is enabled. The initial embedding columns use 384 dimensions; the embedding model is recorded separately. Generation models remain model-agnostic and run locally or on a separately configured inference host.
- Provider credentials must never be stored in plaintext in these tables or shipped in the APK. `credential_ref` is an opaque reference for a server-side secret store.
- ULTRON may create, version and run owner-scoped cloud workflow tools and skills autonomously. Android device actions, external communications, payments and destructive operations retain their explicit action policies.

## Single-owner security

The database contains one singleton row in `public.ultron_instance`. That row is deliberately not seeded by a client. Until it is provisioned, all ULTRON data policies deny access, even for authenticated accounts.

Before creating the ULTRON login:

1. Open the project's Supabase Dashboard.
2. Go to **Authentication → Sign In / Providers**.
3. Disable **Allow new users to sign up**.
4. Disable **Allow anonymous sign-ins**.
5. Keep only the email/password sign-in method needed by the private owner account.
6. Create/invite the one owner account from the dashboard. Do not build an open sign-up screen into ULTRON.

After that account exists, copy its UUID from **Authentication → Users** and run this once in the project's SQL Editor, replacing the placeholder:

```sql
insert into public.ultron_instance (owner_id, display_name)
values ('OWNER-AUTH-USER-UUID', 'ULTRON');
```

The insert is intentionally unavailable to `anon` and `authenticated` clients. Provision it only from the trusted dashboard SQL Editor or another server-side administrative context. The singleton constraint prevents a second owner row.

Never expose the Supabase `service_role` or secret key in Android, web client code, Git, or chat. Client access uses the publishable key plus the authenticated owner's session and RLS.

## Migrations

The SQL files in `migrations/` are the source-controlled migration history for this backend. They correspond to the migrations already applied to the dedicated ULTRON project. Apply future schema changes as new timestamped migrations, and run Supabase Security and Performance Advisors after changes.


## Autonomous capability loop

The `ultron-runtime` Edge Function is the default operational runtime for reusable tools and skills. It is deployed with JWT verification enabled and uses the authenticated owner's session and RLS context. It supports versioned ULTRON-authored workflows, public HTTP requests, owner-scoped database operations, semantic memory search, skill management and tool execution history.

The `ultron-capabilities` Edge Function and `ultron_generated_tools` tables remain as a legacy archive for Python source drafts, infrastructure proposals, checkpoints and historical audit records. New operational tools must use `ultron_tool_specs` and the Supabase-native workflow runtime; new skills use `ultron_skills`. The phone's capability console shows both the legacy records and the active cloud tool/skill registries.

ULTRON can author Supabase public-schema code through `database.ddl`, backed by `ultron_apply_schema_change`, and call its own Postgres functions through `database.rpc`. Schema authoring supports creating and altering ULTRON-owned tables, views, indexes and invoker SQL functions. Destructive DROP/TRUNCATE operations and SECURITY DEFINER functions are not part of the autonomous schema path. Every applied schema statement records a hash and preview in the capability event history.

## Supabase-first tool and skill architecture (2026-11-04)

ULTRON uses a shared two-runtime model. Supabase is the default for capabilities that benefit from persistent state, cross-model access, internet connectivity, or server-side execution. Android remains the default for capabilities that require the phone, local files, local inference, or offline operation.

### Placement catalogue

| Capability family | Default location | Reason / implementation |
| --- | --- | --- |
| Long-term memory, semantic search, memory relations and knowledge graph | Supabase | Shared across every model and device; Postgres + pgvector + Realtime |
| Conversations, task ledger, agent checkpoints, run history and settings | Supabase | Durable state, resumable work and cross-session continuity |
| Skills and learned procedures | Supabase | Versioned shared library; phone caches and injects relevant skills into local and remote model context |
| Reusable ULTRON-authored workflow tools | Supabase Edge Function | Versioned declarative workflows run through `ultron-runtime`; execution records go to `ultron_tool_runs` |
| Public internet APIs and web retrieval | Supabase Edge Function | Cloud connectivity works even when the phone model is local; use `http.request` workflow steps |
| Owner-scoped database operations | Supabase | Postgres is the authoritative persistent data layer |
| OAuth connectors and third-party integrations | Supabase / connector gateway | Provider credentials and sessions belong in the server-side connector layer; tool definitions stay shared |
| Document indexing, embeddings and search | Supabase | Store document metadata/chunks and vector indexes centrally; upload content only when intended |
| Background orchestration and resumable plans | Supabase | Durable task/run state; use queues or a worker for work beyond Edge Function limits |
| File creation, archive operations and project coding | Android by default; cloud worker when available | Native file access and Termux-compatible tools are local; heavy server-side conversion needs a dedicated worker |
| Local GGUF model download, loading and inference | Android | Hardware-aware, offline-capable and no cloud GPU dependency |
| Voice, microphone, notifications, app launch, phone actions and device controls | Android | Requires native Android APIs and device permissions |
| Local project checkout, shell commands, Git and build tools | Android | Operates on the phone's approved workspace; cloud repository operations can later use a connector |
| Model-independent identity, reasoning policy and tool contracts | Shared code + Supabase configuration | Same contracts across local and remote models |

### Cloud workflow runtime

`ultron-runtime` is a JWT-verified Supabase Edge Function. It stores and runs versioned ULTRON-authored workflow tools. A tool is a JSON workflow, not a Python process. Supported operations are `http.request`, `database.select`, `database.insert`, `database.update`, `memory.search`, `memory.save`, `text.template` and `json.pick`. Workflow tools can be created, versioned, listed, executed and archived by ULTRON. Public HTTP calls are supported; authenticated provider APIs should use the connector gateway rather than embedding credentials in workflow definitions.

The `ultron_skills` table stores versioned agent-created and evidence-distilled skills. The phone loads relevant cloud skills before inference, records usage, and syncs verified local distillations back to Supabase. The `ultron_tool_specs` table stores versioned active workflows. Both tables have owner-scoped RLS and Realtime. Execution history is stored in `ultron_tool_runs` and shown in the capability console.

The previous `ultron_generated_tools` Python-source draft lifecycle remains for compatibility and inspection. It is not the default creation path and does not execute Python. New operational tools should use `ultron_tool_specs` and the Supabase-native workflow runtime.

### Autonomy model

ULTRON may create, revise (by publishing a new version), run and archive ordinary workflow tools and skills without a separate approval step. The capability console displays these tools, their workflow source, version hash, run counts, last-run status, execution input/output, failures and shared skills. Phone-only operations continue to execute on Android; Supabase-native workflows execute in the cloud. External communications, payments and destructive data operations retain their existing explicit confirmation behavior.


### Shared semantic memory

ULTRON's deterministic 96-dimensional feature-hash vectors are now mirrored to `ultron_memory_items.local_embedding`. Supabase exposes `ultron_match_local_memories`, a cosine-similarity RPC protected by the caller's owner RLS context and backed by an HNSW index. The Android client synchronizes memory vectors in batches and retrieves relevant cloud memories before both local and remote inference. If cloud access is unavailable, the existing on-device retrieval path remains available. The model embedding column remains separate for future neural embedding providers.


### Autonomous Supabase code authoring

ULTRON can create and alter its own Supabase public-schema objects through the `database.ddl` workflow operation, backed by `ultron_apply_schema_change`. It can create tables, views, indexes and invoker SQL functions, then call its own `ultron_*` Postgres functions with `database.rpc`. The schema authoring function checks the authenticated ULTRON owner, records the applied statement hash and preview in capability events, and keeps destructive DROP/TRUNCATE operations outside the autonomous path. New public functions created by the postgres owner do not receive PUBLIC or anon execution by default; ULTRON can explicitly grant execution to authenticated. This lets ULTRON write real database-side code without putting service credentials in the Android app.
