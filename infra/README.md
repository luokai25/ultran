# Ultran infrastructure

Infrastructure for Ultran's hosted control plane. **Render Free is the attempted $0 deployment target.** The local-first agent runtime can also run on user devices or a separately managed model host.

## Layout

- `render.yaml`: Render Free Blueprint for the FastAPI control plane
- `infra/render/`: Render deployment and operations guide
- `infra/hetzner/`: retained reference only, not the active target
- `infra/terraform/`: existing AWS reference architecture
- `infra/k8s/` and `infra/docker/`: Kubernetes manifests and shared Docker definitions

## $0 deployment policy

Read [the Render guide](render/README.md) and the root-level [Render Blueprint](../render.yaml). The Blueprint uses the Free plan, Frankfurt region, automatic deploys from `main`, and `/v1/health` as the health check.

- No paid plan, persistent disk, paid database, or upgrade without explicit approval.
- Render Free filesystems are ephemeral, services sleep when idle, and free Postgres databases expire after 30 days. This configuration is suitable only for a prototype; do not store real provider credentials or sensitive durable data.
- Keep the credential-encryption key in the platform's secret settings, never in Git or chat. Encryption does not compensate for missing durable storage and backups.
- Verify health and logs after deployment. A successful image build is not proof that integrations or recovery work.
- The Render service-creation API returned HTTP 402 requiring payment information. No service was created. If the account keeps blocking free creation, switch to a genuinely no-card free provider rather than adding billing information.

## Legacy infrastructure

The `hetzner/` directory remains reference-only. The `terraform/` directory is an AWS-oriented reference architecture and must not be applied as if it provisions Render resources.

## Security guardrails

- Keep API keys and encryption keys in platform secrets or a dedicated secret manager, never in Git.
- Do not use this ephemeral prototype for production user data or real provider credentials.
- Any future durable deployment must include a free-tier-compatible persistence design, backups, restore testing, health checks, and rollback procedures before being considered production-ready.
