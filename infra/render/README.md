# Deploy Ultran on Render's Free Tier

Render is the current deployment target, with a strict **$0-only** requirement. The root `render.yaml` describes a free web service for testing the Ultran FastAPI control plane.

## Free-tier limits and safety

- The Blueprint uses Render's **Free** compute plan and creates no persistent disk.
- Free web services sleep after 15 minutes without inbound traffic and may take about a minute to wake.
- The filesystem is ephemeral. Data written locally, including SQLite state and credential records, can disappear on restart, spin-down, or redeploy.
- Render's free Postgres currently expires after 30 days, so do not treat it as durable long-term storage.
- **Treat this deployment as a demo/prototype only. Do not connect real provider credentials, store sensitive user data, or promise durable state on this free setup.**
- No paid service, persistent disk, database, or upgrade is authorized. Do not add billing information to get around account restrictions.

## Deploy

1. Open the Render dashboard and connect the GitHub repository `luokai25/ultran`.
2. Choose **New → Blueprint** and select the repository's `render.yaml` on branch `main`.
3. If prompted, set `ULTRAN_CREDENTIAL_ENCRYPTION_KEY` as a secret environment variable. Generate a Fernet key locally with Python and cryptography:

   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Keep the key private and never commit it or paste it into chat. Because free storage is ephemeral, the key alone does not make local credential data durable or production-safe.
4. Deploy, then verify `/v1/health` returns HTTP 200 and inspect the service logs.

## What this does not provide

This Blueprint deploys only the FastAPI API. It does not host local AI models, GPU inference, or the Android app. It does not configure a durable database, offsite backups, or external alerting. Production use with real accounts and credentials requires durable storage and a tested backup/restore plan; we will not silently switch to paid resources to obtain those.

## Current status

A committed Blueprint is configuration, not proof of a live service. The Render API returned HTTP 402 when service creation was attempted, stating that payment information is required. No service was created and no payment was made. If Render continues to block creation, use a genuinely no-card free host rather than adding a card.
