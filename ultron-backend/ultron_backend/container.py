"""Application container: one place that wires every service together."""

from __future__ import annotations

from dataclasses import dataclass

from .agents import AgentService
from .artifacts import ArtifactService
from .billing import BillingService
from .brain import BrainRuntime
from .builder import BuilderService
from .config import Settings
from .composio import ComposioGateway
from .connectors import ConnectorRegistry, CredentialVault, load_catalog
from .connectors.registry import mcp_connector_id
from .deploy import DeployService
from .forge import ForgeService
from .mcp import ApprovalGate, GrantStore, McpClientPool, ServerSpec, ToolGateway
from .mcp.registry_store import McpServerStore
from .sandbox import ToolSandbox
from .workspace import AvatarService, VoiceService
from .tasks import AgentTaskService


@dataclass
class Container:
    settings: Settings
    registry: ConnectorRegistry
    vault: CredentialVault
    sandbox: ToolSandbox
    brain: BrainRuntime
    agents: AgentService
    tasks: AgentTaskService
    artifacts: ArtifactService
    avatar: AvatarService
    voice: VoiceService
    builder: BuilderService
    forge: ForgeService
    billing: BillingService
    deploys: DeployService
    #: MCP connector runtime (v2). ``registry`` is bound to these two.
    mcp_pool: McpClientPool
    mcp_gateway: ToolGateway
    mcp_server_store: McpServerStore
    composio: ComposioGateway

    @classmethod
    def build(cls, settings: Settings | None = None) -> Container:
        settings = settings or Settings.from_env()
        registry = ConnectorRegistry(load_catalog())
        vault = CredentialVault(
            db_path=settings.data_dir / "credentials.sqlite3" if settings.credential_encryption_key else None,
            encryption_key=settings.credential_encryption_key or None,
        )
        sandbox = ToolSandbox(
            registry,
            vault,
            cpu_ms_budget=settings.sandbox_cpu_ms_budget,
        )
        brain = BrainRuntime.from_settings(settings)

        # The MCP runtime is built before the registry is handed out, because the
        # registry is the single answer to "what can Ultron call?" and it must
        # already know how to route an MCP connector when the first request lands.
        # Dynamic server registrations are restored from the encrypted local registry.
        mcp_server_store = McpServerStore(
            settings.data_dir / "mcp_servers.sqlite3",
            encryption_key=settings.credential_encryption_key or None,
        )
        mcp_pool = McpClientPool()
        mcp_gateway = ToolGateway(
            mcp_pool,
            grants=GrantStore(
                default_ttl_s=settings.mcp_grant_ttl_s,
                db_path=str(settings.data_dir / "mcp_grants.sqlite3"),
                encryption_key=settings.credential_encryption_key or None,
            ),
            approvals=ApprovalGate(
                ttl_s=settings.mcp_approval_ttl_s,
                db_path=str(settings.data_dir / "approvals.sqlite3"),
            ),
            wall_ms=settings.mcp_wall_ms,
            egress_bytes=settings.mcp_egress_bytes,
            require_grants=settings.mcp_require_grants,
            audit_db_path=str(settings.data_dir / "mcp_audit.sqlite3"),
        )
        registry.attach_mcp(mcp_pool, mcp_gateway)
        for spec in mcp_server_store.list():
            mcp_pool.register(spec, replace=True)
        # Environment configuration wins over persisted UI registrations.
        for spec in _configured_servers(settings):
            mcp_pool.register(spec, replace=True)
        registry.sync_mcp()

        composio = ComposioGateway(
            api_key=settings.composio_api_key,
            callback_url=settings.composio_callback_url,
            db_path=settings.data_dir / "composio_approvals.sqlite3",
            encryption_key=settings.credential_encryption_key,
        )

        artifacts = ArtifactService(settings.data_dir / "artifacts")
        agents = AgentService(
            brain, sandbox, vault, composio=composio, artifact_service=artifacts,
            db_path=settings.data_dir / "agents.sqlite3",
            encryption_key=settings.credential_encryption_key,
        )
        billing = BillingService(default_monthly_tokens=settings.free_plan_monthly_tokens)

        def execute_agent_task(agent_id: str, message: str, **kwargs):
            result = agents.chat(agent_id, message, **kwargs)
            billing.meter(kwargs.get("workspace_id", "local"), result["tokens_in"] + result["tokens_out"])
            return result

        tasks = AgentTaskService(
            settings.data_dir / "agent_tasks.sqlite3", execute_agent_task,
            encryption_key=settings.credential_encryption_key,
        )
        return cls(
            settings=settings,
            registry=registry,
            vault=vault,
            sandbox=sandbox,
            brain=brain,
            agents=agents,
            tasks=tasks,
            artifacts=artifacts,
            avatar=AvatarService(),
            voice=VoiceService(),
            builder=BuilderService(),
            forge=ForgeService(),
            billing=billing,
            deploys=DeployService(root=settings.data_dir / "deploys"),
            mcp_pool=mcp_pool,
            mcp_gateway=mcp_gateway,
            mcp_server_store=mcp_server_store,
            composio=composio,
        )

    # ------------------------------------------------------------------ #
    def register_mcp_server(self, spec: ServerSpec, *, connect: bool = True) -> dict:
        """Persist a server, handshake it, and project it into the registry."""
        self.mcp_server_store.save(spec)
        self.mcp_pool.register(spec, replace=True)
        if connect and spec.enabled:
            self.mcp_pool.connect(spec.id, raise_on_error=False)
        self.registry.sync_mcp()
        return self.mcp_pool.status(spec.id)

    def unregister_mcp_server(self, server_id: str) -> None:
        self.mcp_pool.unregister(server_id)
        self.mcp_server_store.delete(server_id)
        connector_id = mcp_connector_id(server_id)
        if connector_id in self.registry:
            self.registry.unregister(connector_id)

    def probe_mcp_server(self, server_id: str) -> dict:
        status = self.mcp_pool.probe(server_id)
        self.registry.sync_mcp()
        return status

    def close(self) -> None:
        self.tasks.close()
        self.mcp_pool.close()

    # ------------------------------------------------------------------ #
    def seed_default_workspace(self, workspace_id: str = "local") -> None:
        """Enable a handful of free, keyless connectors so a fresh workspace is usable."""
        for connector_id in ("ollama", "redis", "arxiv", "web-search"):
            if connector_id in self.registry:
                self.registry.enable(workspace_id, connector_id)
        # MCP servers are enabled for the workspace as soon as they are registered:
        # registering one is already an explicit admin action.
        for manifest in self.registry.mcp_connectors():
            self.registry.enable(workspace_id, manifest.id)


def _configured_servers(settings: Settings) -> list[ServerSpec]:
    """Servers declared in ``ULTRON_MCP_SERVERS`` (a JSON array).

    Config-as-code is the cheap path: a team can commit its MCP servers next to
    the rest of the workspace config instead of clicking them in.
    """
    raw = (settings.mcp_servers_json or "").strip()
    if not raw:
        return []
    import json

    try:
        rows = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(rows, list):
        return []
    specs: list[ServerSpec] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            specs.append(ServerSpec.from_dict(row))
        except (KeyError, ValueError):
            continue
    return specs
