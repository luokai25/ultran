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

## Brain-independent capability layer

Every agent turn receives the same Ultran capability contract, regardless of
whether the active brain is Echo, Ollama, an OpenAI-compatible local runtime, or
a configured hosted provider. The contract keeps tool permissions, truthfulness,
untrusted-output handling, task decomposition, and delivery standards outside
the model itself.

Tasks are classified into quick, standard, deep, and critical modes. The runtime
uses bounded recent history and memory, lowers sampling temperature for complex
work, and performs an independent review pass for deep or high-impact tasks
when the first response came from a language model. If review fails, Ultran
keeps the usable first answer. The deterministic Echo fallback is not run
through a second review pass because it is not a generative language model.

This does not make every model equally intelligent. It gives each model the
same execution scaffolding and safety contract, while the selected model still
sets the ceiling for raw reasoning and knowledge. Real connector access, approval
checks, and sandbox rules remain enforced by the existing tool runtime.

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
the APK. The agent runtime can now opt into this tool set by including the virtual
connector ID `composio` in an agent's `tools` array. On each enabled turn,
Ultran creates a short-lived MCP session for that workspace, asks the agent's
configured brain to produce a schema-bound tool plan, validates the arguments,
and executes eligible read-only calls through the MCP gateway.

**Write and permission controls**

- Only tools classified as exactly `read` can run without a human decision.
- Any write, delete, execute, admin, network, or otherwise non-read capability
  is paused for explicit approval. Unknown tool capabilities are not treated as
  safe reads.
- Review pending requests with `GET /v1/connectors/composio/approvals`.
  The response includes the exact proposed tool and arguments.
- Approve with `POST /v1/connectors/composio/approvals/{approval_id}/approve`.
  Ultran reopens a workspace-specific session, revalidates the tool schema,
  checks the approved arguments have not changed, and executes once.
- Deny with `POST /v1/connectors/composio/approvals/{approval_id}/deny`.
  Approval requests expire after five minutes. Pending approvals are held in
  backend memory and are invalidated by a backend restart.

Approvals are per call, not blanket permission for a provider. A model cannot
approve its own write actions. Keep the backend behind real account
authentication before exposing these endpoints to untrusted users.

The existing local connectors continue to work without Composio.

**Deployment note:** the current workspace header is a local-development boundary,
not end-user authentication. Before exposing this API to multiple internet users,
Ultran must derive workspace IDs from authenticated accounts rather than trusting
a caller-supplied `X-Ultran-Workspace` header.
