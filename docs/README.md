# Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](architecture.md) | The actual web, Android, Supabase and optional Python runtime topology |
| [Screen coverage](ULTRON-SCREEN-COVERAGE.md) | Canonical client screen and state inventory |
| [Product Studio](AI-DIGITAL-PRODUCT-STUDIO.md) | Research and digital-product generation workflow |
| [Offer Builder](ULTRON-OFFER-BUILDER.md) | Durable product-generation stages and worker behavior |
| [Prometheus runtime](ultron-prometheus-runtime.md) | Background reasoning, memory and self-improvement loop |
| [Constitution](constitution/IMPLEMENTATION_MAP.md) | Mapping the owner-provided ULTRON source to implementation |
| [Mobile inference](airllm-mobile-engine.md) | Low-memory local model execution design |
| [Google Workspace connector](GOOGLE-WORKSPACE-CONNECTOR.md) | Connector setup and behavior |

## Start here

1. Read [Architecture](architecture.md).
2. Read [the phone app guide](../apps/phone/README.md).
3. Read [Supabase cloud infrastructure](../supabase/README.md).
4. Read [the optional Python backend guide](../ultron-backend/README.md).

The Vercel web app and Android APK share the same `apps/phone` client. There is no separate Next.js or Expo app.
