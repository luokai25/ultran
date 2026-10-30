"""Safe API-key probes for supported model providers.

The probe requests only the provider's model catalogue. It never returns the
credential and never triggers a billable model generation.
"""
from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Any

from .errors import DependencyUnavailable, ValidationFailed

# provider -> (catalogue URL, auth header, additional headers)
PROVIDER_PROBES: dict[str, tuple[str, str, dict[str, str]]] = {
    "openai": ("https://api.openai.com/v1/models", "Authorization", {}),
    "groq": ("https://api.groq.com/openai/v1/models", "Authorization", {}),
    "openrouter": ("https://openrouter.ai/api/v1/models", "Authorization", {}),
    "together-ai": ("https://api.together.xyz/v1/models", "Authorization", {}),
    "deepseek": ("https://api.deepseek.com/v1/models", "Authorization", {}),
    "fireworks-ai": ("https://api.fireworks.ai/inference/v1/models", "Authorization", {}),
    "cerebras": ("https://api.cerebras.ai/v1/models", "Authorization", {}),
    "mistral": ("https://api.mistral.ai/v1/models", "Authorization", {}),
    "xai": ("https://api.x.ai/v1/models", "Authorization", {}),
    "google-ai-studio": (
        "https://generativelanguage.googleapis.com/v1beta/models",
        "x-goog-api-key",
        {},
    ),
    "anthropic": (
        "https://api.anthropic.com/v1/models",
        "x-api-key",
        {"anthropic-version": "2023-06-01"},
    ),
    "cohere": ("https://api.cohere.com/v1/models", "Authorization", {}),
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
    probe = PROVIDER_PROBES.get(provider)
    if not probe:
        raise ValidationFailed(
            "This provider does not yet support connection verification.",
            details={"provider": provider},
        )
    secret = (api_key or "").strip()
    if len(secret) < 8:
        raise ValidationFailed("A valid API key is required.")
    if client is None:
        import httpx
        client = httpx.Client(timeout=timeout_s)

    url, auth_header, extra_headers = probe
    auth_value = f"Bearer {secret}" if auth_header == "Authorization" else secret
    started = monotonic()
    try:
        response = client.get(
            url,
            headers={**extra_headers, auth_header: auth_value, "Accept": "application/json"},
        )
    except Exception as exc:  # noqa: BLE001
        raise DependencyUnavailable(
            "Provider could not be reached.",
            details={"provider": provider},
        ) from exc

    elapsed = max(0, int((monotonic() - started) * 1000))
    if response.status_code in (401, 403):
        return ProviderProbe(
            provider, False, "unauthorized", latency_ms=elapsed,
            detail="The provider rejected this API key.",
        )
    if response.status_code >= 400:
        return ProviderProbe(
            provider, False, "provider_error", latency_ms=elapsed,
            detail=f"Provider returned HTTP {response.status_code}.",
        )
    try:
        body = response.json()
    except Exception as exc:  # noqa: BLE001
        raise DependencyUnavailable(
            "Provider returned an invalid response.",
            details={"provider": provider},
        ) from exc

    rows = body.get("data", body.get("models", [])) if isinstance(body, dict) else []
    if not isinstance(rows, list):
        rows = []
    return ProviderProbe(
        provider, True, "connected", models_count=len(rows), latency_ms=elapsed,
        detail="API key accepted; model catalogue reachable.",
    )
