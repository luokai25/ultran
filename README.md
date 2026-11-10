```markdown
# ULTRON

ULTRON is a personal AI workspace with one shared client for the web and Android. It combines local model execution on Android with a Supabase-powered cloud brain.

- **Web:** [ultron-pied-gamma.vercel.app](https://ultron-pied-gamma.vercel.app/)
- **Android:** APK releases are published from GitHub Actions; signing is enabled when release signing secrets are configured.
- **Source:** [luokai25/ultran](https://github.com/luokai25/ultran)
- **Hosting:** Vercel for the web client; Supabase for cloud data, Edge Functions, Vault and scheduled workers.

This is a single-instance personal app, not a multi-user SaaS. Visitors do not create accounts or sign in to use the public client. The backend resolves the single ULTRON instance. Provider credentials remain in Supabase Vault and are never shipped to the browser or APK.

## What is in the app

- Streaming chat with **ULTRON · Automatic** cloud routing and imported local-model selection.
- Android-local inference through the bundled llama.cpp runtime, with GGUF and `.tgz`/`.tar.gz` model imports.
- Conversation history, persistent memory and model profiles.
- Provider key management backed by Supabase Vault.
- Connector catalog and optional Python control plane for agent sessions, background tasks and connector operations.
- File artifacts and the AI Product Studio / Offer Builder background workflow.
- Android companion, voice and task-monitor integrations.

The web client and Android APK use the same source and UI: `apps/phone`. There is no separate Next.js or Expo client.

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/phone` | Canonical Vite client and Capacitor Android app |
| `packages/connectors` | Shared connector manifest and SDK |
| `supabase/functions` | Cloud brain, jobs, memory/capabilities, connectors, artifacts and Product Studio |
| `supabase/migrations` | Database schema and migration history |
| `supabase/tests` | Edge-function contract tests |
| `ultron-backend` | Optional Python control plane used by agent workspace and connector operations |
| `docs` | Product, architecture, runtime and screen documentation |
| `.github/workflows` | CI, Android release and Termux runtime build workflows |

## Local development

Requirements: Node.js 20+, pnpm 9+, Python 3.11+ for the optional control plane, and JDK 17 / Android SDK for local APK builds.

```bash
pnpm install
pnpm dev
```

Build and verify:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Run the optional Python control plane:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e "ultron-backend[dev]"
python -m ultron_backend
```

The Python service listens on `127.0.0.1:8080` by default. Core cloud chat does not depend on it; the app uses it for agent workspace and connector operations when a backend URL is configured.

## Deployment and releases

- Pushing to `main` deploys the canonical web client through the existing Vercel Git integration.
- Changes under `apps/phone` trigger the Android release workflow. The workflow builds, signs when signing secrets are configured, and publishes the APK.
- `termux-bootstrap.yml` builds optional Android runtime archives when manually dispatched.
- Supabase Edge Functions and migrations are maintained in `supabase/`; scheduled brain, job and maintenance workers run inside Supabase.

Do not deploy the web client through Cloudflare. Vercel is the canonical web host.

## Supabase services

The active Edge Functions are `ultron-brain`, `ultron-jobs`, `ultron-runtime`, `ultron-capabilities`, `ultron-connectors`, `ultron-artifacts`, `ultron-product-studio` and `ultron-offer-builder`.

Provider keys belong in Supabase Vault. Only the public publishable project key may be present in the client. Never commit secrets or paste them into source files.

## Documentation

Start with [Architecture](docs/architecture.md), [the phone app guide](apps/phone/README.md), [Supabase cloud infrastructure](supabase/README.md), [the Python control plane](ultron-backend/README.md), [screen coverage](docs/ULTRON-SCREEN-COVERAGE.md) and the [documentation index](docs/README.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
```