```markdown
# ULTRON client

This is the only ULTRON client. It is a Vite + TypeScript web app and the source bundled into the Capacitor Android APK.

## Production

- Web: https://ultron-pied-gamma.vercel.app/
- Android: GitHub Actions publishes APK releases from `main`.
- Cloud: Supabase project `vshoxrtrfleptqxkrmtc`.

Vercel serves this app directly. Do not route it through Cloudflare or deploy a second web frontend.

## Main capabilities

- Streaming cloud chat with ULTRON Automatic model routing.
- Android-local llama.cpp inference and GGUF / `.tgz` model imports.
- Conversation history, memory, model library and provider key management.
- Connector catalog, agent workspace and background tasks.
- Private artifacts and AI Product Studio / Offer Builder.
- Android companion, voice and task-monitor integrations.

## Source layout

- `index.html` — app shell, navigation, chat and feature screens
- `src/main.ts` — app startup, chat orchestration and screen wiring
- `src/cloud-llm.ts` — direct Supabase brain requests and streaming
- `src/cloud-sync.ts` — Supabase project configuration and optional state sync
- `src/styles.css`, `src/chatgpt-ui.css` — shared web and Android styling
- `src/ultron-persona.ts` — stable ULTRON identity and response presentation
- `android/` — native Capacitor project, llama.cpp integration and companion services

## Local development

Requirements: Node.js 20+, pnpm 9+.

```bash
pnpm install
pnpm dev
```

Build and verify:

```bash
pnpm --filter @ultron/connectors build
pnpm --filter @ultron/phone typecheck
pnpm --filter @ultron/phone lint
pnpm --filter @ultron/phone test
pnpm --filter @ultron/phone build
```

## Android APK

The release workflow is `.github/workflows/android-release.yml`. It builds the Vite app, syncs Capacitor, generates Android assets, builds the native llama.cpp integration and publishes the APK. Local builds require JDK 17 and Android SDK platform 34 / build-tools 34.0.0.

```bash
pnpm --filter @ultron/phone build
pnpm --filter @ultron/phone cap:sync
cd apps/phone/android
gradle assembleRelease
```

## Cloud and optional backend

Primary cloud chat calls the Supabase `ultron-brain` Edge Function directly. Visitors do not need to sign in. Provider credentials are loaded server-side from Supabase Vault.

The optional Python control plane in `ultron-backend` provides agent sessions, background task execution and connector operations. It is not required for primary chat. See [its README](../../ultron-backend/README.md).

Keep API keys out of this repository, browser storage, Vercel frontend variables and the APK.
```