# Ultran on Hetzner Cloud

This is the first production deployment target for the Ultran API. It uses a
single Ubuntu LTS VPS, Docker Compose, and Caddy for automatic HTTPS. It is
intentionally separate from `infra/terraform`, which currently provisions AWS
resources.

## What this deploys

- FastAPI control plane in a non-root container.
- Caddy reverse proxy with automatic TLS certificates.
- API reachable only through the proxy; port 8080 is not published.
- Persistent Docker volume for the encrypted credential database.
- Read-only container filesystem, dropped Linux capabilities, no-new-privileges,
  health checks, and restart policies.

This does not deploy the web frontend or a GPU model server. Keep inference on
hosted providers initially; add a separate model host only when there is a
measured need.

## Server baseline

Create an Ubuntu 24.04 LTS server in a Hetzner location close to the expected
users. For an initial API-only deployment, start with 2 vCPU and 4 GB RAM; this
is a starting point, not a performance guarantee. Do not buy a GPU server for
the API control plane.

Use an SSH key at server creation. Do not enable password SSH login. Create a
non-root operator account and keep the provider's recovery console available.

Before deployment, configure the Hetzner Cloud Firewall:
- Inbound TCP 22 only from your trusted administration IP.
- Inbound TCP 80 and 443 from the internet.
- No public inbound rules for 8080, 5432, 11434, or other internal services.
- Outbound HTTPS and DNS permitted for updates, image pulls, certificate
  issuance, and model-provider APIs.

If your administration IP changes, update the firewall rule before closing the
existing SSH session.

## Host hardening

On the server:
1. Apply Ubuntu security updates and enable unattended security upgrades.
2. Install Docker Engine and the Compose plugin from Docker's official apt
   repository.
3. Enable UFW with default-deny incoming; allow SSH, HTTP, and HTTPS only.
4. Install and enable fail2ban for SSH.
5. Use SSH keys, disable root SSH login and password authentication after
   confirming key-based login in a second terminal.
6. Keep the host clock synchronized and monitor disk space.

Do not enable UFW before confirming the SSH allow rule. Keep Hetzner's firewall
as the outer network boundary as well.

## Provision the VPS with Terraform

The adjacent `terraform/` directory provisions the Hetzner server and Cloud
Firewall. It also creates a non-root operator account, installs unattended
security updates and fail2ban, and enables a host firewall. The Cloud Firewall
allows SSH only from the administrator's IPv4 CIDR and exposes HTTP/HTTPS.

Install Terraform 1.6+ and set the Hetzner API token in your local shell:

```bash
export HCLOUD_TOKEN="YOUR_HETZNER_CLOUD_API_TOKEN"
cd infra/hetzner/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with:
- Your public IPv4 address in CIDR form (usually `x.x.x.x/32`).
- Your SSH **public** key (never the private key).
- A suitable Hetzner location and server type.

Then review before creating anything:

```bash
terraform init
terraform fmt -check
terraform validate
terraform plan -out=ultran.tfplan
terraform show ultran.tfplan
```

Only after reviewing the plan, apply it:

```bash
terraform apply ultran.tfplan
terraform output
```

The output gives the server IPv4 address. Point the API DNS A record at it.
Connect as the non-root operator shown in `admin_user`. Cloud-init installs
Docker Engine, the Compose plugin, unattended security updates, fail2ban, and
UFW during first boot. Verify them with `docker --version`,
`docker compose version`, `systemctl status fail2ban`, and `sudo ufw status`,
then follow **First deployment** below. Log out and back in once so the operator
session picks up Docker group membership.

Keep `HCLOUD_TOKEN`, `terraform.tfvars`, Terraform state, and plan files
private. The repository ignores Terraform state and plan files; never force-add
them. The server has Hetzner automated backups enabled, but that is not a
substitute for encrypted, off-server backups of the credential volume and its
Fernet key. Review the plan carefully: Terraform can create billable resources.

## First deployment

Clone the repository on the server at `/opt/ultran`, then:

```bash
cd ultran/infra/hetzner
cp .env.example .env
chmod 600 .env
```

Edit `.env`:
- Set `ULTRAN_DOMAIN` to a DNS name whose A record points to this server.
- Set `ACME_EMAIL` to an address for TLS certificate notices.
- Set `ULTRAN_CORS_ORIGINS` to the exact HTTPS origin(s) of the web app.
- Generate the Fernet key on the server after Python/cryptography is available,
  then put it in `.env`. Do not paste it into chat, commit it, or put it in
  shell history.

Generate the key without printing it into a shell command history:

```bash
python3 - <<'PY'
from cryptography.fernet import Fernet
from pathlib import Path
p = Path(".env")
key = Fernet.generate_key().decode()
text = p.read_text()
text = text.replace("ULTRAN_CREDENTIAL_ENCRYPTION_KEY=", f"ULTRAN_CREDENTIAL_ENCRYPTION_KEY={key}")
p.write_text(text)
p.chmod(0o600)
print("Encryption key written to .env. Store a separate secure backup now.")
PY
```

Then build and start:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api caddy
```

Verify `https://YOUR_DOMAIN/v1/health` returns HTTP 200 and confirm that
`http://SERVER_IP:8080` is not reachable from the public internet.

## Backups and recovery

The named `ultran-data` volume contains the SQLite credential vault. Back up
the database consistently, encrypt backups before they leave the server, and
store at least one copy outside the VPS. A backup on the same server is not a
disaster-recovery plan.

Back up these items together:
- The SQLite database from the `ultran-data` volume.
- The Fernet encryption key from the secret store.
- The deployment `.env` file, excluding any unrelated temporary secrets.
- The exact Git commit deployed.

Keep the encryption key in a separate secret manager or offline encrypted
recovery store, not beside the backup. Test restoration to a fresh volume before
calling the backup process reliable. Set a retention policy (for example,
daily backups for 7 days and weekly backups for 4 weeks) and alert on failed
backup jobs or low disk space.

## Automated encrypted off-server backups

The Terraform bootstrap installs Restic. The repository includes a daily
systemd backup timer that takes a transactionally consistent SQLite snapshot,
then sends the vault database and deployment environment file to an encrypted
Restic repository. The example configuration is
[`restic.env.example`](restic.env.example).

Use a separate off-server target such as a Hetzner Storage Box or another
SFTP-compatible backup host. Create the remote repository account and install
an SSH key for root on the VPS. Pin the provider's SSH host key in
`/root/.ssh/known_hosts`; do not disable SSH host-key checking.

On the VPS, clone the repository to `/opt/ultran` and configure:

```bash
install -d -m 0700 /etc/ultran
install -m 0600 /opt/ultran/infra/hetzner/restic.env.example /etc/ultran-backup.env
install -m 0600 /dev/null /etc/ultran-restic-password
```

Generate a long random Restic repository password and place it in
`/etc/ultran-restic-password` using a secure method. Store a separate recovery
copy offline. Edit `/etc/ultran-backup.env` with the real SFTP repository
address and password-file path. Ensure root's SSH client can reach the backup
host with the pinned host key and private key.

Initialize the remote repository once:

```bash
set -a
. /etc/ultran-backup.env
set +a
restic init
```

Install and enable the timer:

```bash
chmod 0755 /opt/ultran/infra/hetzner/backup.sh
install -m 0644 /opt/ultran/infra/hetzner/systemd/ultran-backup.service /etc/systemd/system/
install -m 0644 /opt/ultran/infra/hetzner/systemd/ultran-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ultran-backup.timer
systemctl start ultran-backup.service
systemctl status ultran-backup.service
```

The timer runs daily at approximately 02:30 server time, with a randomized
delay. Retention is 7 daily, 4 weekly, and 6 monthly snapshots. Check recent
runs with `journalctl -u ultran-backup.service` and verify remote snapshots
with `restic snapshots`.

For a recovery drill, restore the latest snapshot to a separate directory
first, inspect the database and environment file, and verify that the Fernet
key decrypts a test credential. Never overwrite the live database during the
first restore test. A backup is not proven until a restore has succeeded.

## Updates and rollback

Deploy a reviewed commit from `main`:

```bash
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
docker compose logs --since=10m api caddy
```

Do not use unattended automatic application deploys for production. Apply
Ubuntu security updates automatically, but deploy application changes after CI
passes. Keep the previous image available until the new version passes health
checks. Database schema changes must remain backward-compatible across a
rollback window.

## Operations checklist

- [ ] Hetzner Cloud Firewall and host firewall both deny unneeded inbound ports.
- [ ] SSH key login verified; root/password SSH disabled.
- [ ] Automatic security updates and fail2ban enabled.
- [ ] DNS A record points to the VPS; HTTPS certificate issued.
- [ ] Production encryption key generated, backed up separately, and never
      committed.
- [ ] CORS restricted to the real web origin.
- [ ] API health check passes; port 8080 is private.
- [ ] Encrypted off-server backups scheduled and restore-tested.
- [ ] Disk, memory, CPU, container restarts, HTTPS expiry, and backup failures
      monitored.
- [ ] Deployed commit recorded and rollback procedure tested.

## Important limitations before launch

The current vault is SQLite-backed and suited to a single API instance with a
persistent disk. Do not run multiple API replicas against this volume. Before
horizontal scaling, move credentials and transactional state to a managed
database with explicit encryption and migration design. This deployment guide
does not claim that a VPS has been created or that the service is live; those
steps require the Hetzner account, server details, and DNS control.
