# ULTRON Supabase backend

This Supabase project is a private, single-owner backend for the ULTRON Android assistant. It is separate from every Luo Chat Supabase project. It is not a public service and is not intended to support public registration or multiple human accounts.

## Architecture boundaries

- The phone remains local-first. Core inference, local files, and offline tools must continue working without Supabase.
- Supabase stores encrypted/sensitive application state only behind authenticated access and database-enforced row policies: conversations, messages, long-term memory, memory relations, documents, task state, tool approvals/audit records, model profiles, settings, and device sync cursors.
- Supabase Realtime is enabled for conversations, messages, tasks, tool runs, memory items, and per-owner settings.
- The `ultron-private` Storage bucket is private. Object paths must begin with the owner's Auth UUID.
- pgvector is enabled. The initial embedding columns use 384 dimensions; the embedding model is recorded separately. Generation models remain model-agnostic and run locally or on a separately configured inference host.
- Provider credentials must never be stored in plaintext in these tables or shipped in the APK. `credential_ref` is an opaque reference for a server-side secret store.
- Tool permissions default to `deny`; tool execution must still require the app's approval gate.

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
