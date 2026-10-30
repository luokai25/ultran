"""Safe connectivity probes for supported OpenAI-compatible model providers.

A probe only requests the provider's model catalogue. It never returns or logs
credentials, and it does not trigger a billable generation.
"""
from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Any

from .errors import DependencyUnavailable, ValidationFailed

PROVIDER_BASE_URLS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "together-ai": "https://api.together.xyz/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "fireworks-ai": "https://api.fireworks.ai/inference/v1",
    "cerebras": "https://api.cerebras.ai/v1",
    "mistral": "https://api.mistral.ai/v1",
    "xai": "https://api.x.ai/v1",
}

@dataclass(frozen=True)
class ProviderProbe:
    provider: str
    ok: bool
    status: str
    models_count: int = 0
    latency_ms: int = 0
    detail: str = ""

    def public(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "ok": self.ok,
            "status": self.status,
            "models_count": self.models_count,
            "latency_ms": self.latency_ms,
            "detail": self.detail,
        }


def probe_provider(provider: str, api_key: str, *, client=None, timeout_s: float = 12.0) -> ProviderProbe:
    base = PROVIDER_BASE_URLS.get(provider)
    if not base:
        raise ValidationFailed(
            "This provider does not yet support the OpenAI-compatible connection probe.",
            details={"provider": provider},
        )
    if not api_key or len(api_key.strip()) < 8:
        raise ValidationFailed("A valid API key is required.")
    if client is None:
        import httpx
        client = httpx.Client(timeout=timeout_s)
    started = monotonic()
    try:
        response = client.get(
            f"{base}/models",
            headers={"Authorization": f"Bearer {api_key.strip()}", "Accept": "application/json"},
        )
    except Exception as exc:  # noqa: BLE001
        raise DependencyUnavailable(
            "Provider could not be reached.",
            details={"provider": provider},
        ) from exc
    elapsed = max(0, int((monotonic() - started) * 1000))
    if response.status_code in (401, 403):
        return ProviderProbe(provider, False, "unauthorized", latency_ms=elapsed,
                             detail="The provider rejected this API key.")
    if response.status_code >= 400:
        return ProviderProbe(provider, False, "provider_error", latency_ms=elapsed,
                             detail=f"Provider returned HTTP {response.status_code}.")
    try:
        body = response.json()
    except Exception as exc:  # noqa: BLE001
        raise DependencyUnavailable("Provider returned an invalid response.",
                                    details={"provider": provider}) from exc
    rows = body.get("data", []) if isinstance(body, dict) else []
    if not isinstance(rows, list):
        rows = []
    return ProviderProbe(provider, True, "connected", models_count=len(rows),
                         latency_ms=elapsed, detail="API key accepted; model catalogue reachable.")
