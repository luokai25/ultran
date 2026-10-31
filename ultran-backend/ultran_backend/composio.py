"""Composio gateway integration for hosted OAuth connections and MCP sessions.

Composio owns provider OAuth, token exchange, refresh, and tool execution.
Ultran only stores its project API key in server configuration and scopes each
Composio user to a stable, workspace-derived identifier.
"""
from __future__ import annotations

import hashlib
from typing import Any

from .errors import DependencyUnavailable, ValidationFailed


def composio_user_id(workspace_id: str) -> str:
    """Return a stable opaque Composio user ID without leaking workspace names."""
    normalized = (workspace_id or "").strip()
    if not normalized or len(normalized) > 128:
        raise ValidationFailed("A valid workspace is required.")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]
    return f"ultran_{digest}"


class ComposioGateway:
    """Small adapter around the official Composio Python SDK."""

    def __init__(self, api_key: str = "", callback_url: str = "") -> None:
        self._api_key = api_key.strip()
        self._callback_url = callback_url.strip()
        self._client: Any | None = None

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    def _sdk(self):
        if not self.configured:
            raise DependencyUnavailable(
                "Composio is not configured yet. Add ULTRAN_COMPOSIO_API_KEY to the backend environment."
            )
        if self._client is None:
            try:
                from composio import Composio
            except ImportError as exc:
                raise DependencyUnavailable(
                    "The Composio SDK is not installed. Install the backend dependencies."
                ) from exc
            self._client = Composio(api_key=self._api_key)
        return self._client

    def create_session(self, workspace_id: str) -> dict[str, Any]:
        """Create a workspace-scoped Composio session exposed over MCP."""
        client = self._sdk()
        try:
            session = client.sessions.create(
                user_id=composio_user_id(workspace_id),
                mcp=True,
            )
            mcp = getattr(session, "mcp", None)
            url = getattr(mcp, "url", None)
            headers = getattr(mcp, "headers", None)
            if not url or not isinstance(headers, dict):
                raise DependencyUnavailable(
                    "Composio created a session but did not return a usable MCP endpoint."
                )
            return {
                "session_id": getattr(session, "session_id", None),
                "mcp": {"url": url, "headers": headers},
            }
        except DependencyUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise DependencyUnavailable("Composio could not create a session.") from exc


    def _workspace_pool(self, workspace_id: str):
        """Open an isolated MCP pool for one workspace; never share session headers."""
        from .mcp import McpClientPool, ServerSpec

        session = self.create_session(workspace_id)
        mcp = session["mcp"]
        pool = McpClientPool()
        pool.register(
            ServerSpec(
                id="composio",
                name="Composio connected accounts",
                transport="http",
                url=mcp["url"],
                headers=mcp["headers"],
                trust_level="third_party",
                timeout_s=20.0,
                connect_timeout_s=10.0,
            ),
            connect=True,
        )
        return pool

    def list_tools(self, workspace_id: str) -> list[dict[str, Any]]:
        """Discover tools from this workspace's own short-lived Composio session."""
        pool = self._workspace_pool(workspace_id)
        try:
            return [tool.as_dict() for tool in pool.list_tools()]
        finally:
            pool.close()

    def invoke_read_tool(
        self, workspace_id: str, tool_name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Invoke only explicitly read-only tools through Ultran's MCP policy gateway."""
        from .mcp import GrantStore, ToolGateway

        pool = self._workspace_pool(workspace_id)
        try:
            spec = pool.find_tool(f"composio.{tool_name}")
            if spec.capabilities != frozenset({"read"}) or spec.requires_approval:
                raise ValidationFailed(
                    "This Composio action is not eligible for unattended execution.",
                    details={"tool": spec.id, "capabilities": sorted(spec.capabilities)},
                )
            gateway = ToolGateway(
                pool,
                grants=GrantStore(),
                require_grants=True,
                wall_ms=20_000,
                egress_bytes=2 * 1024 * 1024,
            )
            grant = gateway.issue_grant(
                workspace_id, spec.id, capabilities=("read",), ttl_s=60, single_use=True
            )
            outcome = gateway.invoke(
                spec.id,
                arguments or {},
                workspace_id=workspace_id,
                grant=grant,
                capabilities=("read",),
                timeout_s=20.0,
            )
            return outcome.as_dict()
        finally:
            pool.close()

    def authorize(self, workspace_id: str, toolkit: str) -> dict[str, str]:
        """Create a hosted Connect Link for one provider toolkit."""
        slug = (toolkit or "").strip().lower()
        if not slug or len(slug) > 80 or not slug.replace("_", "").replace("-", "").isalnum():
            raise ValidationFailed("Invalid Composio toolkit slug.")
        client = self._sdk()
        try:
            session = client.sessions.create(user_id=composio_user_id(workspace_id))
            kwargs = {}
            if self._callback_url:
                kwargs["callback_url"] = self._callback_url
            request = session.authorize(slug, **kwargs)
            redirect_url = getattr(request, "redirect_url", None)
            if not isinstance(redirect_url, str) or not redirect_url.startswith("https://"):
                raise DependencyUnavailable("Composio returned an invalid authorization link.")
            return {"toolkit": slug, "redirect_url": redirect_url}
        except (ValidationFailed, DependencyUnavailable):
            raise
        except Exception as exc:  # noqa: BLE001
            raise DependencyUnavailable(f"Composio could not start authorization for {slug}.") from exc

    def list_connections(self, workspace_id: str) -> list[dict[str, Any]]:
        """Return redacted connection metadata only; never request credential values."""
        client = self._sdk()
        try:
            response = client.connected_accounts.list(user_ids=[composio_user_id(workspace_id)])
            rows = getattr(response, "items", response)
            if not isinstance(rows, (list, tuple)):
                rows = []
            safe = []
            for account in rows:
                toolkit = getattr(getattr(account, "toolkit", None), "slug", None)
                safe.append({
                    "id": getattr(account, "id", None),
                    "toolkit": toolkit,
                    "status": getattr(account, "status", None),
                    "created_at": str(getattr(account, "created_at", "")) or None,
                })
            return safe
        except Exception as exc:  # noqa: BLE001
            raise DependencyUnavailable("Composio connections could not be listed.") from exc

    def revoke(self, workspace_id: str, connected_account_id: str) -> None:
        account_id = (connected_account_id or "").strip()
        if not account_id.startswith("ca_") or len(account_id) > 128:
            raise ValidationFailed("Invalid connected account ID.")
        # Never let a caller revoke another workspace's account by guessing its ID.
        owned_ids = {row.get("id") for row in self.list_connections(workspace_id)}
        if account_id not in owned_ids:
            from .errors import NotFound
            raise NotFound("connected account was not found in this workspace")
        client = self._sdk()
        try:
            client.connected_accounts.revoke(account_id)
        except Exception as exc:  # noqa: BLE001
            raise DependencyUnavailable("Composio could not revoke this connection.") from exc
