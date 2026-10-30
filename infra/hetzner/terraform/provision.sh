#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

command -v terraform >/dev/null 2>&1 || {
  echo "Terraform 1.6+ is required. Install it before provisioning." >&2
  exit 1
}
: "${HCLOUD_TOKEN:?Export HCLOUD_TOKEN in this shell; never put it in terraform.tfvars}"

if [[ ! -f terraform.tfvars ]]; then
  echo "Missing terraform.tfvars. Copy terraform.tfvars.example and fill in your SSH public key and admin IPv4 CIDR." >&2
  exit 1
fi

terraform init -input=false
terraform fmt -check -recursive
terraform validate
terraform plan -input=false -out=ultran.tfplan
terraform show ultran.tfplan

echo
echo "Review the plan above. Creating a Hetzner server and enabling backups may incur charges."
read -r -p 'Type CREATE ULTRAN VPS to apply this exact plan: ' confirmation
if [[ "${confirmation}" != "CREATE ULTRAN VPS" ]]; then
  echo "Provisioning cancelled. No resources were created."
  exit 0
fi

terraform apply -input=false ultran.tfplan
echo
echo "Server provisioned. Save these outputs and point your API DNS A record to server_ipv4:"
terraform output
