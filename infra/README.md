# Ultran infrastructure

Infrastructure as code for the **cloud control plane only**. The local agent
runtime (`services/agent-core`) is never deployed by this module - it ships
inside the client binaries.

## Layout

```
infra/
├── terraform/       # Cloud resources: database, network, security groups
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
├── k8s/             # Workload manifests for the control plane
│   ├── api-deployment.yaml
│   └── api-service.yaml
└── docker/          # Build definitions
    ├── api.Dockerfile
    └── web.Dockerfile
```

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
