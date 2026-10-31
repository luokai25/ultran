# Ultran infrastructure

Infrastructure for Ultran's hosted control plane. **Render is the active deployment target.** The local-first agent runtime can still run on user devices or a separately managed model host.

## Layout

- render.yaml: Render Blueprint for the FastAPI control plane
- infra/render/: Render deployment and operations guide
- infra/hetzner/: retained reference only, not the active target
- infra/terraform/: existing AWS reference architecture
- infra/k8s/ and infra/docker/: Kubernetes manifests and shared Docker definitions

## Deploy to Render

Start with [the Render deployment guide](render/README.md) and the root-level [Render Blueprint](../render.yaml). The Blueprint configures the FastAPI Docker service in Frankfurt, deploys from main, adds a persistent disk for the encrypted credential vault, and uses /v1/health as the health check.

Important operational notes:

- A persistent disk requires a paid Render web-service plan and is mounted at /srv/ultran/.ultran-data. Do not downgrade to an ephemeral instance while expecting SQLite data to survive.
- Set ULTRAN_CREDENTIAL_ENCRYPTION_KEY as a secret in the Render dashboard. Generate a valid Fernet key locally with Python cryptography; do not commit it or paste it into chat. Back it up securely because losing it can make stored credentials unrecoverable.
- Confirm the backend health endpoint works after deployment. A successful image build is not proof that production credentials, provider integrations, or recovery procedures work.
- Render-managed deploys, HTTPS, service logs, and platform metrics replace the VPS-level Caddy/systemd setup. Offsite database/key backups and alert routing still need explicit configuration and restore testing.
- The Render connector must be connected and the correct workspace explicitly selected before creating or changing cloud resources.

## Legacy infrastructure

The hetzner/ directory remains as a reference only; it is not the active deployment path. The existing terraform/ directory is an AWS-oriented reference architecture and must not be applied as if it provisions Render resources.

## Security guardrails

- Keep API keys and encryption keys in Render environment secrets or a dedicated secret manager, never in Git or Terraform variables.
- Use least-privilege credentials and rotate any secret that may have been exposed.
- Verify persistent storage, backups, restore procedures, health checks, and deployment rollback before treating the service as production-ready.
