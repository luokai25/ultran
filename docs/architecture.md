```markdown
# ULTRON Architecture

> **Current topology:** single-instance personal assistant. Web and Android share one client. Supabase is the cloud runtime; the Python control plane is optional.

## 1. Product surfaces

| Surface | Implementation | Purpose |
| --- | --- | --- |
| Web | `apps/phone` deployed to Vercel | Public browser client |
| Android | `apps/phone/android` via Capacitor | Installable APK with native local inference and companion features |
| Connector SDK | `packages/connectors` | Shared connector manifests and validation |
| Cloud runtime | Supabase Edge Functions | Chat, provider routing, memory, jobs, capabilities, connectors, artifacts and Product Studio |
| Optional control plane | `ultron-backend` (FastAPI) | Agent sessions, background tasks and connector operations |

There is one client codebase. Do not create another web or mobile application for the same product.

## 2. Chat request flow

1. The browser or Android client submits a turn from `apps/phone`.
2. **ULTRON · Automatic** sends the request directly to the public `ultron-brain` Edge Function. The browser does not need a Supabase user session.
3. The Edge Function resolves the configured single ULTRON instance and reads eligible provider credentials from server-side Supabase Vault references.
4. The brain selects a model/key candidate, calls the provider and streams the response back to the client.
5. Conversation and memory state are persisted through the cloud runtime when available. Local Android conversations and local inference remain usable without network access.

The public Supabase publishable key identifies the project; it is not a provider credential. Provider keys and service-role credentials never belong in the client bundle.

## 3. Supabase cloud runtime

Active Edge Functions:

| Function | Responsibility |
| --- | --- |
| `ultron-brain` | Chat streaming, Automatic routing, provider key pools and model catalog |
| `ultron-jobs` | Durable background job processing |
| `ultron-runtime` | Runtime capability and memory operations |
| `ultron-capabilities` | Capability proposals, tool/skill lifecycle and self-improvement |
| `ultron-connectors` | Connector gateway and connection metadata |
| `ultron-artifacts` | Private artifact registration, upload and download |
| `ultron-product-studio` | Product research and generation |
| `ultron-offer-builder` | Durable Offer Builder workflow |

Postgres stores conversations, messages, memories, provider key metadata, durable jobs, device state, capabilities and product projects. Raw provider credentials are stored in Vault, not in public table columns.

Three scheduled jobs run the brain supervisor, cloud job worker and maintenance queue. The private `ultron-private` Storage bucket holds generated artifacts. Migration history is kept in `supabase/migrations`; do not delete applied migrations to make the folder look smaller.

## 4. Local Android inference

The Android app includes a native llama.cpp integration. It can import GGUF models, including split files, and `.tgz`/`.tar.gz` archives containing GGUF weights. Model files remain in private app storage and are not bundled into the APK.

The web client uses cloud inference. Android can use imported local models and continue basic local operation offline. CPU inference speed and available memory depend on the device and model size.

## 5. Optional Python control plane

`ultron-backend` is a FastAPI service used by agent sessions, background task execution and connector operations. It is not required for the primary Supabase chat path. Run it locally on `127.0.0.1:8080` or configure a reachable backend URL in the app when those features are needed.

The backend's built-in connector catalog is exported into `apps/phone/src/connectors.catalog.json`. Keep the catalog export test passing when connector manifests change.

## 6. Single-instance access model

The public client does not ask visitors to create accounts or sign in. The cloud brain resolves the one configured ULTRON instance server-side. Existing database ownership columns and the internal instance anchor are implementation details; they are not a visitor account system.

Do not move provider keys into frontend storage or remove the server-side Vault boundary. Public access should remain simple without exposing credentials or allowing visitors to modify the database directly.

## 7. Build and deployment

- Vercel Git integration deploys the shared `apps/phone` web client from `main`.
- `.github/workflows/android-release.yml` builds and publishes the Android APK.
- `.github/workflows/ci.yml` checks the phone client, connector SDK, Python backend and Supabase artifact formats.
- `.github/workflows/termux-bootstrap.yml` is the manual workflow for optional Android runtime archives.

Use [the root README](../README.md) for commands and [the phone guide](../apps/phone/README.md) for Android build details.
```