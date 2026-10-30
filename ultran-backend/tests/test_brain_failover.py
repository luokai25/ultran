"""OpenAI-compatible backend, failover chain, circuit breaker and settings."""

from __future__ import annotations

import pytest

from ultran_backend.brain import (
    BrainMessage,
    BrainReply,
    BrainRuntime,
    EchoBackend,
    FailoverBackend,
    OllamaBackend,
    OpenAICompatBackend,
)
from ultran_backend.config import Settings
from ultran_backend.errors import DependencyUnavailable, ValidationFailed


def user(text: str = "hi") -> list[BrainMessage]:
    return [BrainMessage("user", text)]


class _Resp:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _Client:
    def __init__(self, response=None, raises: Exception | None = None):
        self.response, self.raises, self.calls = response, raises, []

    def post(self, url, json=None, headers=None):
        self.calls.append((url, json, headers or {}))
        if self.raises:
            raise self.raises
        return self.response


class _Flaky:
    """Backend that fails ``fail_times`` times, then answers."""

    def __init__(self, name: str, fail_times: int = 10**9):
        self.name, self.fail_times, self.calls = name, fail_times, 0

    def complete(self, messages, *, model, temperature):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise DependencyUnavailable(f"{self.name} down")
        return BrainReply(f"from {self.name}", 1, 1, model, self.name)


class _Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def chain(*backends, **kw):
    kw.setdefault("sleep", lambda _s: None)
    return FailoverBackend(list(backends), **kw)


# ------------------------------------------------------- openai-compatible


def test_openai_posts_to_chat_completions_and_parses_usage():
    client = _Client(
        _Resp(
            200,
            {
                "choices": [{"message": {"content": "yo"}, "finish_reason": "length"}],
                "usage": {"prompt_tokens": 9, "completion_tokens": 4},
            },
        )
    )
    reply = OpenAICompatBackend("http://h/", client=client).complete(
        user(), model="m", temperature=0.3
    )
    assert client.calls[0][0] == "http://h/v1/chat/completions"
    assert client.calls[0][1]["temperature"] == 0.3
    assert client.calls[0][2] == {}
    assert (reply.content, reply.tokens_in, reply.tokens_out) == ("yo", 9, 4)
    assert reply.finish_reason == "length"
    assert reply.backend == "openai"


def test_openai_falls_back_to_token_estimates():
    client = _Client(_Resp(200, {"choices": [{"message": {"content": "abcdefgh"}}]}))
    reply = OpenAICompatBackend("http://h", client=client).complete(
        user("abcd"), model="m", temperature=0.1
    )
    assert (reply.tokens_in, reply.tokens_out) == (1, 2)


@pytest.mark.parametrize(
    "client",
    [
        _Client(raises=OSError("refused")),
        _Client(_Resp(503, {})),
        _Client(_Resp(200, {"choices": []})),
    ],
)
def test_openai_failures_become_dependency_unavailable(client):
    with pytest.raises(DependencyUnavailable):
        OpenAICompatBackend("http://h", client=client).complete(user(), model="m", temperature=0.1)


# ------------------------------------------------------------- failover


def test_failover_uses_primary_when_healthy():
    a, b = _Flaky("a", 0), _Flaky("b", 0)
    reply = chain(a, b).complete(user(), model="m", temperature=0.1)
    assert reply.backend == "a" and b.calls == 0


def test_failover_falls_through_to_next_backend():
    a, b = _Flaky("a"), _Flaky("b", 0)
    fb = chain(a, b, retries=0)
    reply = fb.complete(user(), model="m", temperature=0.1)
    assert reply.backend == "b"
    assert reply.raw["failover_attempts"] == [{"backend": "a", "error": "a down"}]
    assert fb.failovers == 1


def test_retry_recovers_without_failing_over():
    a = _Flaky("a", fail_times=1)
    reply = chain(a, EchoBackend(), retries=1).complete(user(), model="m", temperature=0.1)
    assert reply.backend == "a" and a.calls == 2


def test_backoff_doubles_between_retries():
    slept: list[float] = []
    a = _Flaky("a", fail_times=2)
    chain(a, retries=2, backoff_s=0.5, sleep=slept.append, failure_threshold=99).complete(
        user(), model="m", temperature=0.1
    )
    assert slept == [0.5, 1.0]


def test_validation_errors_do_not_fail_over():
    class Bad:
        name = "bad"

        def complete(self, messages, *, model, temperature):
            raise ValidationFailed("caller bug")

    b = _Flaky("b", 0)
    with pytest.raises(ValidationFailed):
        chain(Bad(), b).complete(user(), model="m", temperature=0.1)
    assert b.calls == 0


def test_all_down_raises_with_attempt_log():
    with pytest.raises(DependencyUnavailable) as err:
        chain(_Flaky("a"), _Flaky("b"), retries=0).complete(user(), model="m", temperature=0.1)
    assert [a["backend"] for a in err.value.details["attempts"]] == ["a", "b"]


def test_empty_chain_is_rejected():
    with pytest.raises(ValueError):
        FailoverBackend([])


# ------------------------------------------------------- circuit breaker


def test_breaker_opens_then_skips_then_half_opens():
    clock = _Clock()
    a, b = _Flaky("a", fail_times=3), _Flaky("b", 0)
    fb = chain(a, b, retries=0, failure_threshold=3, cooldown_s=30, clock=clock)

    for _ in range(3):
        fb.complete(user(), model="m", temperature=0.1)
    assert a.calls == 3
    assert fb.status()[0]["state"] == "open"

    fb.complete(user(), model="m", temperature=0.1)  # skipped, no new call to a
    assert a.calls == 3

    clock.now = 31  # cooldown elapsed: one half-open probe, a has recovered
    reply = fb.complete(user(), model="m", temperature=0.1)
    assert reply.backend == "a" and a.calls == 4
    status = fb.status()[0]
    assert status["state"] == "closed" and status["consecutive_failures"] == 0


def test_failed_half_open_probe_reopens_the_breaker():
    clock = _Clock()
    a = _Flaky("a")
    fb = chain(a, EchoBackend(), retries=0, failure_threshold=1, cooldown_s=10, clock=clock)
    fb.complete(user(), model="m", temperature=0.1)
    clock.now = 11
    fb.complete(user(), model="m", temperature=0.1)  # probe fails
    assert a.calls == 2 and fb.status()[0]["state"] == "open"


# -------------------------------------------------- runtime + settings


def test_runtime_chain_ends_at_echo_floor():
    rt = BrainRuntime.from_settings(
        Settings(brain_backend="ollama", brain_fallbacks=("openai",), brain_retries=0)
    )
    assert isinstance(rt.backend, FailoverBackend)
    assert [b.name for b in rt.backend.backends] == ["ollama", "openai", "echo"]


def test_runtime_survives_every_model_runtime_being_down():
    rt = BrainRuntime.from_settings(
        Settings(
            brain_backend="ollama",
            brain_endpoint="http://127.0.0.1:1",
            brain_openai_endpoint="http://127.0.0.1:1",
            brain_fallbacks=("openai",),
            brain_retries=0,
            brain_timeout_s=0.2,
        )
    )
    reply = rt.complete(user("deploy it"))
    assert reply.backend == "echo" and "Intent: deploy" in reply.content
    stats = rt.stats()
    assert stats["failovers"] == 1
    assert [c["backend"] for c in stats["chain"]] == ["ollama", "openai", "echo"]


def test_no_fallbacks_keeps_a_plain_backend():
    rt = BrainRuntime.from_settings(Settings(brain_backend="ollama"))
    assert isinstance(rt.backend, OllamaBackend)
    assert "chain" not in rt.stats()


def test_runtime_picks_openai_primary():
    rt = BrainRuntime.from_settings(Settings(brain_backend="openai"))
    assert isinstance(rt.backend, OpenAICompatBackend)


def test_settings_parse_fallback_env():
    s = Settings.from_env(
        {"ULTRAN_BRAIN_FALLBACKS": " OpenAI , echo ", "ULTRAN_BRAIN_RETRIES": "2"}
    )
    assert s.brain_fallbacks == ("openai", "echo") and s.brain_retries == 2


def test_settings_reject_unknown_fallback():
    with pytest.raises(ValueError, match="fallback"):
        Settings(brain_fallbacks=("gpt-cloud",))
