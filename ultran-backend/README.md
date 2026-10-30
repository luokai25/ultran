# Ultran Backend

FastAPI control plane for Ultran agents, provider connections, MCP connectors,
credential storage, workspace operations, and deployment workflows.

## Local development

Requires Python 3.11 or newer.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
ULTRAN_ENV=dev python -m ultran_backend
```

The API listens on `127.0.0.1:8080` by default. Health and readiness endpoints
are available at `/v1/health` and `/v1/readiness`.

## Configuration

Configuration is read from environment variables. See the repository's
`infra/hetzner/.env.example` for the production deployment variables and
`ultran_backend/config.py` for the complete settings model.

Production requires `ULTRAN_CREDENTIAL_ENCRYPTION_KEY`. Generate a Fernet key
with the `cryptography` package and store it in a secret manager. Never commit
it or return it from an API endpoint. Persistent deployments must mount
`ULTRAN_DATA_DIR` on durable storage and back up the encrypted database and
its key separately.

## Tests

```bash
python -m pytest -q
```

Provider connection tests use mocked HTTP clients. They verify adapter behavior
without claiming that real provider accounts or API keys have been exercised.
