# @ultran/api

The Ultran cloud control plane. **Entirely optional** - the product works
without it. This service exists only for the things a single device cannot do.

## What lives here

| Module | Responsibility |
| --- | --- |
| `src/sync/` | Device sync: the journal from L0, replayed against a server. |
| `src/auth/` | Device identity, session issuance, entitlement signing. |
| `src/marketplace/` | Paid connector SKUs and offline-verifiable purchase receipts. |
| `src/billing/` | Stripe / IAP adapters, webhook verification, idempotency. |

## Design constraints

1. **Never on the agent hot path.** A run must complete with this service
   offline. Anything that would block a run belongs in `agent-core`.
2. **No content, only counters.** Metering ships `{meter, amount}` tuples, not
   prompts, tool arguments, or results.
3. **Idempotent by construction.** Every mutating endpoint takes an
   idempotency key; webhooks are verified and de-duplicated.
4. **Entitlements are signed server-side** and verified offline by the client,
   so the client never needs to call home to know what it is allowed to do.

## Endpoints (planned)

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/v1/health` | GET | Liveness. |
| `/v1/devices` | POST | Register a device, return a challenge. |
| `/v1/sync` | POST | Push a batch of journal operations. |
| `/v1/usage` | POST | Ingest meter readings (counters only). |
| `/v1/entitlements` | GET | Fetch the signed entitlement for a device. |
| `/v1/catalog` | GET | List connector SKUs. |
| `/v1/webhooks/stripe` | POST | Billing events, signature-verified. |

## Getting started

```bash
pnpm --filter @ultran/api dev      # http://localhost:8080
pnpm --filter @ultran/api build
```

## Structure

```
src/
├── index.ts      # HTTP server bootstrap
├── sync/         # journal ingest and conflict resolution
├── auth/         # device identity and session tokens
├── marketplace/  # connector SKUs and receipts
└── billing/      # payment provider adapters
```
