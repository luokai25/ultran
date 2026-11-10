# @ultron/web

> **Legacy surface.** The canonical public ULTRON web client is the
> APK-matched Vite app in `apps/phone`, hosted on Vercel at
> https://ultron-pied-gamma.vercel.app/. This Next.js surface forwards visitors
> to that canonical Vercel app.

The Ultron web console - a Next.js app for inspecting agent runs, browsing
connectors, managing capability grants, and reviewing usage and entitlements.

## Responsibilities

| Area | Detail |
| --- | --- |
| **Run inspector** | Projects the orchestrator's append-only event log into a timeline. Supports replay. |
| **Connector catalog** | Lists registry entries, their declared capabilities, and health. |
| **Grant management** | Surfaces capability requests for user approval; lists active grants. |
| **Usage & billing** | Renders the usage ledger and current entitlement. |

## Boundaries

The web app **never** runs inference and **never** calls the sandbox directly.
It talks to `services/agent-core` over the local IPC/HTTP boundary and to
`services/api` for cloud features. If the cloud is unreachable, the console
degrades to local-only mode.

## Getting started

```bash
pnpm --filter @ultron/web dev      # http://localhost:3000
pnpm --filter @ultron/web build
```

## Structure

```
src/
├── app/          # Next.js App Router routes
├── components/   # Web-specific composed components
└── lib/          # Client-side data access and state
```
