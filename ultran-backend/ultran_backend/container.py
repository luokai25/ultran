"""Application container: one place that wires every service together."""

from __future__ import annotations

from dataclasses import dataclass

from .agents import AgentService
from .billing import BillingService
from .brain import BrainRuntime
from .builder import BuilderService
from .config import Settings
from .connectors import ConnectorRegistry, CredentialVault, load_catalog
from .deploy import DeployService
from .forge import ForgeService
from .sandbox import ToolSandbox
from .workspace import AvatarService, VoiceService


@dataclass
class Container:
    settings: Settings
    registry: ConnectorRegistry
    vault: CredentialVault
    sandbox: ToolSandbox
    brain: BrainRuntime
    agents: AgentService
    avatar: AvatarService
    voice: VoiceService
    builder: BuilderService
    forge: ForgeService
    billing: BillingService
    deploys: DeployService

    @classmethod
    def build(cls, settings: Settings | None = None) -> "Container":
        settings = settings or Settings.from_env()
        registry = ConnectorRegistry(load_catalog())
        vault = CredentialVault()
        sandbox = ToolSandbox(
            registry,
            vault,
            cpu_ms_budget=settings.sandbox_cpu_ms_budget,
        )
        brain = BrainRuntime.from_settings(settings)
        return cls(
            settings=settings,
            registry=registry,
            vault=vault,
            sandbox=sandbox,
            brain=brain,
            agents=AgentService(brain, sandbox),
            avatar=AvatarService(),
            voice=VoiceService(),
            builder=BuilderService(),
            forge=ForgeService(),
            billing=BillingService(default_monthly_tokens=settings.free_plan_monthly_tokens),
            deploys=DeployService(root=settings.data_dir / "deploys"),
        )

    # ------------------------------------------------------------------ #
    def seed_default_workspace(self, workspace_id: str = "local") -> None:
        """Enable a handful of free, keyless connectors so a fresh workspace is usable."""
        for connector_id in ("ollama", "redis", "arxiv", "web-search"):
            if connector_id in self.registry:
                self.registry.enable(workspace_id, connector_id)
