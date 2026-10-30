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

## First deployment

Clone the repository on the server, then:

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
