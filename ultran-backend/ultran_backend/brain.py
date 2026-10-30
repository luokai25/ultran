"""Local AI brain runtime - offline-first, provider-agnostic.

Two backends ship in the box:

``echo``
    A deterministic, dependency-free planner. It needs no model download and no
    network, so the workspace is fully usable (and fully testable) on a machine
    that has never seen an API key. This is the default.

``ollama``
    Delegates to a local Ollama daemon over HTTP. Nothing leaves the host.

The runtime owns token accounting as well: every turn reports ``tokens_in`` and
``tokens_out`` estimated by the tokeniser, so billing can meter usage without
trusting a provider's self-report.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from .errors import DependencyUnavailable, ValidationFailed

_WORD_RE = re.compile(r"[A-Za-z0-9_'-]+")


def estimate_tokens(text: str) -> int:
    """Cheap, deterministic token estimate (~1 token per 4 chars, min 1)."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def words(text: str) -> list[str]:
    return _WORD_RE.findall(text or "")


@dataclass
class BrainMessage:
    role: str
    content: str


@dataclass
class BrainReply:
    content: str
    tokens_in: int
    tokens_out: int
    model: str
    backend: str
    finish_reason: str = "stop"
    raw: dict[str, Any] = field(default_factory=dict)


class BrainBackend(Protocol):
    name: str

    def complete(self, messages: list[BrainMessage], *, model: str, temperature: float) -> BrainReply: ...


class EchoBackend:
    """Deterministic local planner used when no model is installed.

    It is not trying to be a language model. It produces a *structured, stable*
    reply that reflects the actual request: the detected intent, the tools it was
    offered, and a concrete next action. That makes agent behaviour reproducible
    in tests while still being genuinely useful as a scaffolding brain.
    """

    name = "echo"

    _INTENTS = (
        ("deploy", ("deploy", "release", "ship", "publish")),
        ("build", ("build", "scaffold", "generate", "create", "make")),
        ("sell", ("charge", "invoice", "price", "monetize", "billing", "revenue")),
        ("research", ("search", "find", "research", "look up", "investigate")),
        ("automate", ("connect", "automate", "sync", "webhook", "trigger")),
        ("explain", ("why", "what", "how", "explain", "describe")),
    )

    def _classify(self, text: str) -> str:
        low = text.lower()
        for intent, needles in self._INTENTS:
            if any(n in low for n in needles):
                return intent
        return "converse"

    def complete(
        self, messages: list[BrainMessage], *, model: str, temperature: float
    ) -> BrainReply:
        if not messages:
            raise ValidationFailed("messages must not be empty")
        last = next((m.content for m in reversed(messages) if m.role == "user"), "")
        system = next((m.content for m in messages if m.role == "system"), "")
        intent = self._classify(last)
        tool_hint = ""
        offered = sorted({w for w in words(system) if "_" in w})
        if offered:
            tool_hint = f" Available actions: {', '.join(offered[:6])}."

        body = (
            f"Intent: {intent}. "
            f"I read {len(words(last))} words in your request and will act on it locally "
            f"with {model}.{tool_hint}"
        )
        if intent == "deploy":
            body += (
                " Plan: validate the manifest, dry-run the file diff, then promote with a "
                "release id I can roll back to."
            )
        elif intent == "build":
            body += (
                " Plan: pick the closest template, scaffold the file tree, then typecheck "
                "before exposing a preview."
            )
        elif intent == "sell":
            body += (
                " Plan: meter the work against your plan allowance, then write an "
                "idempotent ledger entry so a retry cannot double-charge."
            )
        elif intent == "research":
            body += " Plan: resolve a search connector, run the query, then cite what came back."
        elif intent == "automate":
            body += " Plan: bind the connector, verify the credential, then wire the trigger."
        elif intent == "explain":
            body += " Here is the direct answer, grounded in what this workspace can actually reach."
        else:
            body += " Tell me the outcome you want and I will pick the tools to get there."

        return BrainReply(
            content=body,
            tokens_in=sum(estimate_tokens(m.content) for m in messages),
            tokens_out=estimate_tokens(body),
            model=model,
            backend=self.name,
        )


class OllamaBackend:
    """Talks to a local Ollama daemon; never leaves the host."""

    name = "ollama"

    def __init__(self, endpoint: str, timeout_s: float = 30.0, client=None) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.timeout_s = timeout_s
        self._client = client

    def _get_client(self):
        if self._client is not None:
            return self._client
        import httpx

        return httpx.Client(timeout=self.timeout_s)

    def complete(
        self, messages: list[BrainMessage], *, model: str, temperature: float
    ) -> BrainReply:
        payload = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": False,
            "options": {"temperature": temperature},
        }
        client = self._get_client()
        try:
            resp = client.post(f"{self.endpoint}/api/chat", json=payload)
        except Exception as exc:  # noqa: BLE001 - normalised below
            raise DependencyUnavailable(
                "local model runtime is unreachable", details={"endpoint": self.endpoint}
            ) from exc
        if resp.status_code >= 400:
            raise DependencyUnavailable(
                "local model runtime returned an error",
                details={"status": resp.status_code, "endpoint": self.endpoint},
            )
        data = resp.json()
        content = (data.get("message") or {}).get("content", "")
        return BrainReply(
            content=content,
            tokens_in=data.get("prompt_eval_count") or sum(estimate_tokens(m.content) for m in messages),
            tokens_out=data.get("eval_count") or estimate_tokens(content),
            model=model,
            backend=self.name,
            raw=data,
        )


class BrainRuntime:
    """Front door for agent inference."""

    def __init__(self, backend: BrainBackend, *, default_model: str = "llama3.1:8b") -> None:
        self.backend = backend
        self.default_model = default_model
        self.calls = 0
        self.tokens_in = 0
        self.tokens_out = 0

    @classmethod
    def from_settings(cls, settings) -> "BrainRuntime":
        if settings.brain_backend == "ollama":
            backend: BrainBackend = OllamaBackend(settings.brain_endpoint, settings.brain_timeout_s)
        else:
            backend = EchoBackend()
        return cls(backend, default_model=settings.brain_model)

    @property
    def name(self) -> str:
        return self.backend.name

    def complete(
        self,
        messages: list[BrainMessage],
        *,
        model: str | None = None,
        temperature: float = 0.4,
    ) -> BrainReply:
        if not 0.0 <= temperature <= 2.0:
            raise ValidationFailed("temperature must be between 0 and 2")
        reply = self.backend.complete(
            messages, model=model or self.default_model, temperature=temperature
        )
        self.calls += 1
        self.tokens_in += reply.tokens_in
        self.tokens_out += reply.tokens_out
        return reply

    def stats(self) -> dict[str, Any]:
        return {
            "backend": self.name,
            "model": self.default_model,
            "calls": self.calls,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
        }
