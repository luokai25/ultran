# ULTRON local-only migration

**Decision date:** 2026-11-11  
**Status:** Migration required; Supabase deletion is NOT yet safe.  
**Canonical branch:** `main` only  
**Canonical client:** `apps/phone` (existing Vite + Capacitor Android application)

## Product decision

ULTRON is to become a standalone application. It must not require, call, authenticate against, or store application data in Supabase, Vercel Functions, a hosted ULTRON API, a Python control-plane server, or any other server operated for ULTRON.

Internet access is direct from the device to the service the user chooses (AI provider APIs, public web/search APIs, and user-authorized connector providers). Those third-party services are not ULTRON servers. Offline local models and local tools must remain available without internet.

Do not create a replacement backend, hosted database, serverless function layer, or cloud queue as part of this migration.

## Target topology

- **Android app:** primary product; the existing Capacitor application and native Android modules remain the only client.
- **Local inference:** existing llama.cpp integration; preserve GGUF and supported .tgz/.tar.gz import workflows.
- **Direct provider adapters:** make requests from the device to provider APIs. Keep provider-specific request, response, streaming, model discovery, verification, timeout, cancellation, and error handling in tested adapters.
- **Credentials:** provider keys stored only in Android Keystore-backed encrypted storage on Android. Web development builds may use an encrypted local vault, but no server-side key pool. Never commit keys or place them in build-time public variables.
- **Persistence:** local transactional database for conversations, attachments, settings, memory, semantic graph, skills, task runs, checkpoints, and generated artifacts. Provide export/import and migration from existing local browser storage.
- **Execution:** local foreground task engine with resumable checkpoints. Android background execution must use appropriate platform APIs and honestly report when OS battery/background limits pause work.
- **Connectors:** direct OAuth/provider integrations where feasible. If a connector provider requires a hosted callback, classify it as unsupported for standalone mode rather than quietly adding an ULTRON server.
- **Artifacts:** private app storage, Android share sheet, and explicit export/import. No cloud bucket or signed upload URLs.
- **Web:** optional development/preview surface only. The shipped Android app must not depend on a hosted web frontend.

## Required migration sequence

### Gate 0 — Baseline and preservation
- Record the current `main` SHA and preserve a recoverable source snapshot.
- Inventory every Supabase SDK import, URL, function invocation, storage bucket, realtime channel, auth/session flow, migration, cron job, and database dependency.
- Inventory Vercel API routes and Python server dependencies.
- Export any user data that must survive before any cloud project is deleted.

### Gate 1 — Local foundations
- Make local persistence authoritative and transactional.
- Migrate conversations, attachments, memory, semantic relations, skills, settings, task ledger/checkpoints, and artifacts.
- Add backup/export/import and migration tests.
- Ensure app restart, process death, offline use, and storage quota failures are handled.

### Gate 2 — Direct model providers
- Replace the Vercel Brain route with direct device-to-provider adapters.
- Support the providers already represented in the UI: OpenRouter, Mistral, Cerebras, Groq, Cohere, and Google AI Studio; add other providers only with tested adapters.
- Verify keys directly against provider endpoints and discover compatible models.
- Normalize streaming, usage, errors, cancellation, retry, and rate-limit behavior.
- Never silently splice a fallback answer into an already displayed response.
- Confirm Android networking works on the target device; do not assume browser CORS behavior proves native-device support.

### Gate 3 — Local tools and jobs
- Replace Supabase runtime/capability calls with local tool implementations.
- Replace durable cloud jobs with a local queue, persisted checkpoints, retries, cancellation, and recovery.
- Keep dangerous actions approval-gated and scope device permissions to the action.
- Remove any feature that cannot work without a server instead of preserving a misleading dead UI.

### Gate 4 — Connectors and product features
- Replace cloud connector gateway calls with direct supported integrations or mark unsupported hosted-callback flows clearly.
- Move Product Studio/Offer Builder execution to local workflows using direct public web/provider APIs.
- Move artifact storage to local files and export/share workflows.
- Remove cloud realtime subscriptions and use local event updates.

### Gate 5 — Remove infrastructure
Only after Gates 0-4 pass:
- Remove `@supabase/supabase-js`, all Supabase URL/key configuration, auth/session UI, cloud sync code, cloud runtime/jobs/capability/artifact/connector/Product Studio clients, Vercel Brain routes, and Python server dependencies that are no longer used.
- Remove Supabase functions, migrations, cron and deployment workflows from the repository only after replacement coverage is verified and data export is complete.
- Remove Vercel project/deployment dependencies and secrets.
- Keep GitHub Actions as the build pipeline only; it builds and publishes the APK and does not host ULTRON runtime services.

### Gate 6 — Release acceptance
- CI: typecheck, lint, all unit/integration tests, web bundle build, Android release APK build.
- Android: install and launch on a physical device; test fresh install, upgrade, local model import, GGUF inference, .tgz import, offline chat, provider key add/verify/remove, direct provider streaming, memory persistence, task recovery, artifact export, permissions, and app restart.
- Network audit: confirm no requests to Supabase, Vercel ULTRON endpoints, or an ULTRON-owned backend.
- Data audit: confirm no secrets or user data are sent anywhere except the selected third-party provider/API explicitly needed for the action.
- Publish the tested APK through the existing GitHub Actions release workflow.

## Supabase deletion gate

**Do not delete Supabase until all of the following are true:**
1. The replacement APK builds successfully from `main`.
2. The physical-device acceptance tests above pass.
3. All data worth retaining has been exported and verified.
4. Repository search and runtime network inspection show no remaining required Supabase calls.
5. No production feature still depends on Supabase storage, auth, realtime, functions, cron, or database state.
6. The owner has the final backup and has confirmed the deletion step.

When these checks pass, tell the owner explicitly that it is safe to delete project `vshoxrtrfleptqxkrmtc`. Until then, keep the project intact; deleting it early would turn unfinished migration work into data loss and broken features.

## Current baseline (2026-11-11)

- Current `main`: `18240db5d2b0fca196634855de3d1c9d5dc20e85`.
- Existing Android local inference foundation and local encrypted provider-key vault are present in source; GGUF and supported archive import paths exist.
- Chat and key verification previously called `https://ultron-pied-gamma.vercel.app/api/ultron-brain`; see the Gate 2 status below for the replacement.
- Current app still imports Supabase and uses cloud auth/sync, Supabase runtime/capabilities/jobs/artifacts/connectors/Product Studio, and cloud realtime.
- Current Android release workflow exists and publishes APKs from `main`.
- Latest observed CI at the baseline commit is failing: 8 phone tests and 1 Deno stream-preflight leak test. The phone typecheck and lint steps passed; the web build was skipped because tests failed. Fix and re-run these checks before claiming a green build.
- No migration gate has passed yet. No project deletion is authorized by this document alone.

## Gate 2 status (implemented, not yet device-verified)

- `apps/phone/src/provider-adapters.ts` verifies keys, lists models and streams chat directly against OpenRouter, Mistral, Cerebras, Groq, Cohere (v2 chat) and Google AI Studio. `cloud-llm.ts` no longer calls any ULTRON server.
- Android uses `UltronProviderHttpPlugin` (HTTPS only, provider host allowlist, request-header allowlist, cancellable streaming). A development browser uses `fetch` and is subject to each provider's CORS policy.
- A failure after tokens were already shown never falls through to another provider.
- Automated coverage: adapter, SSE decoding, error mapping, Java host allowlist parity. **Still required before Gate 2 can pass:** add one real key per provider on an Android device, confirm verify, model discovery, streaming and Stop for each, and run the Android release workflow.
- `api/ultron-brain.ts` and the Supabase code are untouched and still present; they are removed under Gates 3–5.
