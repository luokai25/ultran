"""Local AI brain runtime - offline-first, provider-agnostic.

Two backends ship in the box:

``echo``
    A deterministic, dependency-free planner. It needs no model download and no
    network, so the workspace is fully usable (and fully testable) on a machine
    that has never seen an API key. This is the default.

``ollama``
    Delegates to a local Ollama daemon over HTTP. Nothing leaves the host.

``openai``
    Any OpenAI-compatible chat endpoint you run yourself: llama.cpp's
    ``llama-server``, LM Studio, vLLM, LocalAI. Same local-first guarantee.

Backends compose. :class:`FailoverBackend` walks an ordered chain with per-backend
retries and a circuit breaker, and the chain always bottoms out at ``echo`` -
so the brain keeps answering even when every model runtime is down. No single
daemon is a leash on the agent.

The runtime owns token accounting as well: every turn reports ``tokens_in`` and
``tokens_out`` estimated by the tokeniser, so billing can meter usage without
trusting a provider's self-report.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol, Sequence

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


class OpenAICompatBackend:
    """Talks to a self-hosted OpenAI-compatible ``/v1/chat/completions`` server."""

    name = "openai"

    def __init__(
        self, endpoint: str, timeout_s: float = 30.0, api_key: str | None = None, client=None
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.timeout_s = timeout_s
        self.api_key = api_key
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
            "temperature": temperature,
            "stream": False,
        }
        client = self._get_client()
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        try:
            resp = client.post(f"{self.endpoint}/v1/chat/completions", json=payload, headers=headers)
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
        choices = data.get("choices") or []
        if not choices:
            raise DependencyUnavailable(
                "local model runtime returned no choices", details={"endpoint": self.endpoint}
            )
        choice = choices[0] or {}
        content = (choice.get("message") or {}).get("content") or ""
        usage = data.get("usage") or {}
        return BrainReply(
            content=content,
            tokens_in=usage.get("prompt_tokens") or sum(estimate_tokens(m.content) for m in messages),
            tokens_out=usage.get("completion_tokens") or estimate_tokens(content),
            model=model,
            backend=self.name,
            finish_reason=choice.get("finish_reason") or "stop",
            raw=data,
        )


@dataclass
class _Circuit:
    """Per-backend breaker state: closed -> open (cooling down) -> half-open."""

    failures: int = 0
    opened_at: float | None = None
    last_error: str = ""
    served: int = 0


class FailoverBackend:
    """Ordered chain of backends with retries and a circuit breaker.

    Only :class:`DependencyUnavailable` triggers failover - a validation error is
    the caller's bug and would fail identically everywhere. After
    ``failure_threshold`` consecutive failures a backend is skipped for
    ``cooldown_s``; the next call after that is a single half-open probe. Time and
    sleep are injectable so the behaviour is testable without real waiting.
    """

    name = "failover"

    def __init__(
        self,
        backends: Sequence[BrainBackend],
        *,
        retries: int = 1,
        backoff_s: float = 0.2,
        failure_threshold: int = 3,
        cooldown_s: float = 30.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not backends:
            raise ValueError("FailoverBackend needs at least one backend")
        if retries < 0 or failure_threshold < 1 or cooldown_s < 0:
            raise ValueError("retries >= 0, failure_threshold >= 1 and cooldown_s >= 0 required")
        self.backends = list(backends)
        self.retries = retries
        self.backoff_s = backoff_s
        self.failure_threshold = failure_threshold
        self.cooldown_s = cooldown_s
        self._clock = clock
        self._sleep = sleep
        self._circuits = {id(b): _Circuit() for b in self.backends}
        self.failovers = 0

    def _is_open(self, backend: BrainBackend) -> bool:
        c = self._circuits[id(backend)]
        if c.opened_at is None:
            return False
        if self._clock() - c.opened_at >= self.cooldown_s:
            return False  # half-open: let one probe through
        return True

    def _record_failure(self, backend: BrainBackend, exc: Exception) -> None:
        c = self._circuits[id(backend)]
        c.failures += 1
        c.last_error = str(exc)
        if c.failures >= self.failure_threshold:
            c.opened_at = self._clock()

    def _record_success(self, backend: BrainBackend) -> None:
        c = self._circuits[id(backend)]
        c.failures = 0
        c.opened_at = None
        c.last_error = ""
        c.served += 1

    def complete(
        self, messages: list[BrainMessage], *, model: str, temperature: float
    ) -> BrainReply:
        attempts: list[dict[str, Any]] = []
        for index, backend in enumerate(self.backends):
            if self._is_open(backend):
                attempts.append({"backend": backend.name, "skipped": "circuit open"})
                continue
            for attempt in range(self.retries + 1):
                try:
                    reply = backend.complete(messages, model=model, temperature=temperature)
                except DependencyUnavailable as exc:
                    self._record_failure(backend, exc)
                    attempts.append({"backend": backend.name, "error": exc.message})
                    if attempt < self.retries and not self._is_open(backend):
                        self._sleep(self.backoff_s * (2**attempt))
                        continue
                    break
                self._record_success(backend)
                if index > 0 or attempts:
                    self.failovers += 1
                    reply.raw = {**reply.raw, "failover_attempts": attempts}
                return reply
        raise DependencyUnavailable("every brain backend is unavailable", details={"attempts": attempts})

    def status(self) -> list[dict[str, Any]]:
        out = []
        for b in self.backends:
            c = self._circuits[id(b)]
            out.append(
                {
                    "backend": b.name,
                    "state": "open" if self._is_open(b) else "closed",
                    "consecutive_failures": c.failures,
                    "served": c.served,
                    "last_error": c.last_error,
                }
            )
        return out


class BrainRuntime:
    """Front door for agent inference."""

    def __init__(self, backend: BrainBackend, *, default_model: str = "llama3.1:8b") -> None:
        self.backend = backend
        self.default_model = default_model
        self.calls = 0
        self.tokens_in = 0
        self.tokens_out = 0

    @staticmethod
    def _make_backend(kind: str, settings) -> BrainBackend:
        if kind == "ollama":
            return OllamaBackend(settings.brain_endpoint, settings.brain_timeout_s)
        if kind == "openai":
            return OpenAICompatBackend(
                settings.brain_openai_endpoint,
                settings.brain_timeout_s,
                api_key=settings.brain_openai_api_key or None,
            )
        return EchoBackend()

    @classmethod
    def from_settings(cls, settings) -> "BrainRuntime":
        primary = cls._make_backend(settings.brain_backend, settings)
        fallbacks = [cls._make_backend(k, settings) for k in settings.brain_fallbacks]
        backend: BrainBackend = primary
        if fallbacks:
            chain = [primary, *fallbacks]
            # The floor: the offline planner always answers, whatever else is down.
            if not any(isinstance(b, EchoBackend) for b in chain):
                chain.append(EchoBackend())
            backend = FailoverBackend(
                chain,
                retries=settings.brain_retries,
                failure_threshold=settings.brain_breaker_threshold,
                cooldown_s=settings.brain_breaker_cooldown_s,
            )
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
        backend_override: BrainBackend | None = None,
    ) -> BrainReply:
        if not 0.0 <= temperature <= 2.0:
            raise ValidationFailed("temperature must be between 0 and 2")
        backend = backend_override or self.backend
        reply = backend.complete(
            messages, model=model or self.default_model, temperature=temperature
        )
        self.calls += 1
        self.tokens_in += reply.tokens_in
        self.tokens_out += reply.tokens_out
        return reply

    def stats(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "backend": self.name,
            "model": self.default_model,
            "calls": self.calls,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
        }
        if isinstance(self.backend, FailoverBackend):
            out["failovers"] = self.backend.failovers
            out["chain"] = self.backend.status()
        return out
