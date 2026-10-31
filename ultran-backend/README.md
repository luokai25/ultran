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

## Composio connections (optional)

Ultran can use Composio's hosted OAuth and MCP gateway for cloud services. Composio
handles provider authorization, token exchange, refresh, and upstream tool execution;
Ultran does not receive provider OAuth tokens.

1. Create a free project at https://platform.composio.dev.
2. Add the project API key to the backend environment as `ULTRAN_COMPOSIO_API_KEY`.
3. Restart the backend. Check `GET /v1/connectors/composio/status`.
4. Start an OAuth flow with `POST /v1/connectors/composio/authorize/{toolkit}`.
   The response contains a hosted `redirect_url` for the app to open in the system browser.
5. List connected accounts with `GET /v1/connectors/composio/connections`.
6. Create a workspace-scoped MCP session with `POST /v1/connectors/composio/session`.

The session and account records are scoped to an opaque ID derived from the
Ultran workspace. The backend returns only redacted connection metadata. The
Composio project key must remain on the backend and must never be bundled into
the APK. The existing local connectors continue to work without Composio.

**Deployment note:** the current workspace header is a local-development boundary,
not end-user authentication. Before exposing this API to multiple internet users,
Ultran must derive workspace IDs from authenticated accounts rather than trusting
a caller-supplied `X-Ultran-Workspace` header.
