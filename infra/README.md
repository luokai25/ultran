# Ultran infrastructure

Infrastructure as code for Ultran's hosted control plane. The repository keeps
its original AWS reference architecture separate from the active Hetzner VPS
deployment target. The local-first agent runtime can still run on user devices
or a separately managed model host.

## Layout

```
infra/
├── hetzner/         # Active single-VPS API deployment
│   ├── terraform/   # VPS, firewall, SSH operator, cloud-init hardening
│   ├── systemd/    # Scheduled encrypted off-server backups
│   ├── compose.yaml
│   ├── Caddyfile
│   └── backup.sh
├── terraform/       # Existing AWS reference architecture
├── k8s/             # Kubernetes workload manifests
└── docker/          # Shared Docker build definitions
```

## Hetzner deployment (active target)

The initial production target is a single Ubuntu 24.04 VPS provisioned with
Terraform under [`hetzner/`](hetzner/README.md). It creates a restricted
Hetzner Cloud Firewall, a non-root SSH operator, host firewall rules, fail2ban,
automatic security updates, Docker Engine and Compose. Docker Compose runs the
FastAPI service behind Caddy with automatic HTTPS.

The deployment guide includes:
- Persistent encrypted SQLite credential storage and key recovery.
- Encrypted Restic backups to an off-server SFTP repository, with a daily
  systemd timer and tested-restore instructions.
- Health checks, deployment/rollback steps, and operational security checks.

The infrastructure is **not live yet**. A Hetzner account, project API token,
SSH public key, administrator IP/CIDR, and DNS name are still needed before
provisioning. Keep the Hetzner token in an environment variable or secret
manager, never in Terraform variables or Git.

## Existing AWS reference

The original `terraform/` directory remains an AWS-oriented reference design
for VPC, private subnets, and an encrypted RDS database. It is not the active
Hetzner deployment path and must not be applied as if it provisions Hetzner.

## Environments

| Environment | Purpose | Lifetime |
| --- | --- | --- |
| `dev` | Shared integration; may be unstable. | Persistent |
| `staging` | Pre-production mirror; migrations rehearsed here first. | Persistent |
| `prod` | Live control plane. | Persistent |

## Workflow

```bash
cd infra/terraform
terraform init -backend-config=env/prod.backend.hcl
terraform plan  -var-file=env/prod.tfvars -out=prod.tfplan
terraform apply prod.tfplan
```

State lives in a versioned, encrypted bucket with locking. **Never** apply to
production outside CI, and never commit a `.tfstate` (it is in `.gitignore`
for a reason).

## Guardrails

- Every resource is tagged `Project=ultran`, `Environment=<env>`, `ManagedBy=terraform`.
- Databases are private-subnet only; no public ingress.
- The API service account holds no storage or database admin rights.
- Secrets come from the platform secret manager, never from `.tfvars`.
