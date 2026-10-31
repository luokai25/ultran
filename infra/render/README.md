# Deploy Ultran on Render

Render is the active hosted deployment target for Ultran's FastAPI control plane. The root render.yaml Blueprint describes the service; deploy it from the Render dashboard after connecting the GitHub repository.

## What the Blueprint configures

- Docker service built from ultran-backend/Dockerfile with ultran-backend/ as the build context.
- Frankfurt region and automatic deploys from main.
- Paid Starter plan because persistent disks are not available on Render's free web-service plan.
- A 1 GB persistent disk mounted at /srv/ultran/.ultran-data for the encrypted credential vault.
- /v1/health as the health-check endpoint.
- Production environment settings, with the credential-encryption key intentionally left for secure dashboard entry.

This deploys the backend API only. It does not deploy a GPU model host or the Android application.

## Deploy steps

1. In the Render dashboard, connect the GitHub account and select luokai25/ultran.
2. Create a new Blueprint instance from the repository's render.yaml, with branch main.
3. Before exposing the service to real users, add ULTRAN_CREDENTIAL_ENCRYPTION_KEY as a secret environment variable. Generate a valid Fernet key locally:

   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Run this on a trusted local machine with cryptography installed. Store the value in a password manager or other secure backup, then enter it directly into Render's dashboard. Do not commit it, put it in render.yaml, or send it in chat. Keep the same key across redeployments; rotating it requires a deliberate credential re-encryption/migration plan.

4. Deploy the service and wait for Render's health check to pass.
5. Open the generated onrender.com service URL and verify /v1/health returns HTTP 200.
6. Check service logs for startup errors. Test credential encryption/decryption and configured provider integrations with non-production test credentials before relying on the service.

## Data durability and recovery

The mounted disk preserves the SQLite data directory across deploys and restarts, but it is not a substitute for independent backups. Configure a scheduled backup to a separate storage provider and alert on failures. Back up the encryption key separately from the database. Test restoring both together before production use. The current Blueprint does not create an offsite backup destination or alert integration.

Do not run multiple API instances against this SQLite file. If horizontal scaling or multiple concurrent writers become necessary, migrate state to managed PostgreSQL and test the migration before scaling the service.

## Monitoring and security

- Use Render's service health checks, logs, events, and metrics for operational monitoring.
- Add external uptime checks and failure notifications; platform logs alone do not guarantee anyone notices an outage.
- Keep secrets in Render's environment settings and rotate credentials if exposure is suspected.
- Keep auto-deploy enabled only when main CI checks are trustworthy; review CI status and deployment events after pushes.
- Restrict dashboard access to trusted maintainers and periodically review environment variables and access.
- Document and rehearse rollback and restore procedures.

## Current status

The Blueprint and documentation are repository configuration, not evidence that a live service exists. A Render workspace must be explicitly selected and the repository connected before creating cloud resources. After deployment, verify the actual service URL, environment settings, health, persistence, and backup restore path.
