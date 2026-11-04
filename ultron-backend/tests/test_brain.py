"""Brain runtime tests: both backends, token accounting, failure modes."""

from __future__ import annotations

import pytest

from ultron_backend.brain import (
    BrainMessage,
    BrainRuntime,
    EchoBackend,
    OpenAICompatBackend,
    estimate_tokens,
    words,
)
from ultron_backend.errors import DependencyUnavailable, ValidationFailed


def user(text: str) -> list[BrainMessage]:
    return [BrainMessage("user", text)]


# ------------------------------------------------------------- tokenising


@pytest.mark.parametrize(
    "text,expected",
    [("", 0), ("a", 1), ("abcd", 1), ("abcde", 2), ("a" * 100, 25)],
)
def test_estimate_tokens(text, expected):
    assert estimate_tokens(text) == expected


def test_estimate_tokens_is_monotonic():
    assert estimate_tokens("a" * 10) <= estimate_tokens("a" * 20)


def test_words_splits_on_punctuation():
    assert words("hello, world-friend!") == ["hello", "world-friend"]


def test_words_handles_empty_input():
    assert words("") == []


# ------------------------------------------------------------ echo backend


@pytest.mark.parametrize(
    "text,intent",
    [
        ("deploy this to prod", "deploy"),
        ("ship the release", "deploy"),
        ("build me a website", "build"),
        ("scaffold a dashboard", "build"),
        ("how do I charge for it", "sell"),
        ("add billing", "sell"),
        ("search the web for papers", "research"),
        ("investigate this repo", "research"),
        ("automate the sync", "automate"),
        ("connect slack", "automate"),
        ("why is this slow", "explain"),
        ("hello there", "converse"),
    ],
)
def test_echo_classifies_intent(text, intent):
    backend = EchoBackend()
    assert backend._classify(text) == intent


def test_echo_reply_names_the_intent():
    reply = EchoBackend().complete(user("deploy the app"), model="m", temperature=0.4)
    assert "Intent: deploy" in reply.content
    assert reply.backend == "echo"
    assert reply.model == "m"


def test_echo_counts_tokens_both_ways():
    reply = EchoBackend().complete(user("a" * 40), model="m", temperature=0.4)
    assert reply.tokens_in > 0
    assert reply.tokens_out > 0


def test_echo_mentions_offered_tools():
    msgs = [BrainMessage("system", "You may call list_repos and commit."), BrainMessage("user", "go")]
    reply = EchoBackend().complete(msgs, model="m", temperature=0.4)
    assert "list_repos" in reply.content


def test_echo_is_deterministic():
    b = EchoBackend()
    a = b.complete(user("deploy it"), model="m", temperature=0.1)
    c = b.complete(user("deploy it"), model="m", temperature=1.9)
    assert a.content == c.content


def test_echo_rejects_empty_messages():
    with pytest.raises(ValidationFailed):
        EchoBackend().complete([], model="m", temperature=0.4)


@pytest.mark.parametrize(
    "intent", ["deploy", "build", "sell", "research", "automate", "explain", "converse"]
)
def test_echo_gives_a_concrete_plan_per_intent(intent):
    prompts = {
        "deploy": "deploy it",
        "build": "build it",
        "sell": "charge for it",
        "research": "search it",
        "automate": "automate it",
        "explain": "why is it",
        "converse": "hello",
    }
    reply = EchoBackend().complete(user(prompts[intent]), model="m", temperature=0.4)
    assert reply.content.strip()
    assert len(reply.content) > 40


# ---------------------------------------------------------- ollama backend


class _StubResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _StubClient:
    def __init__(self, response=None, raises: Exception | None = None):
        self.response = response
        self.raises = raises
        self.calls: list[tuple[str, dict]] = []

    def post(self, url, json=None, headers=None):
        self.calls.append((url, json, headers or {}))
        if self.raises:
            raise self.raises
        return self.response




class _StreamResponse:
    def __init__(self, lines, status_code=200):
        self.lines = lines
        self.status_code = status_code
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def iter_lines(self): return iter(self.lines)


class _StreamingClient:
    def __init__(self, lines):
        self.lines = lines
        self.calls = []
    def stream(self, method, url, json=None, headers=None):
        self.calls.append((method, url, json, headers or {}))
        return _StreamResponse(self.lines)


def test_openai_compatible_streams_multimodal_image_content():
    import json
    client = _StreamingClient([
        "data: " + json.dumps({"choices": [{"delta": {"content": "A cat"}, "finish_reason": "stop"}]}),
        "data: [DONE]",
    ])
    image = "data:image/png;base64,Y2F0"
    chunks = []
    OpenAICompatBackend("http://h", client=client).complete_stream(
        [BrainMessage("user", "Describe this image", images=[image])],
        model="vision-model", temperature=0.2, on_token=chunks.append,
    )
    content = client.calls[0][2]["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "Describe this image"}
    assert content[1] == {"type": "image_url", "image_url": {"url": image}}
    assert chunks == ["A cat"]


def test_openai_compatible_streams_sse_deltas_and_usage():
    import json
    client = _StreamingClient([
        "data: " + json.dumps({"choices": [{"delta": {"content": "Hello"}, "finish_reason": None}]}),
        "data: " + json.dumps({"choices": [{"delta": {"content": " world"}, "finish_reason": "stop"}]}),
        "data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 6, "completion_tokens": 2}}),
        "data: [DONE]",
    ])
    chunks = []
    reply = OpenAICompatBackend("http://h", client=client).complete_stream(
        user("hello"), model="m", temperature=0.2, on_token=chunks.append,
    )
    assert chunks == ["Hello", " world"]
    assert reply.content == "Hello world"
    assert (reply.tokens_in, reply.tokens_out) == (6, 2)
    assert client.calls[0][2]["stream"] is True


def test_brain_runtime_forwards_streamed_tokens_from_provider():
    client = _StreamingClient(["data: " + __import__("json").dumps({"choices": [{"delta": {"content": "ok"}}]}), "data: [DONE]"])
    chunks = []
    runtime = BrainRuntime(OpenAICompatBackend("http://h", client=client), default_model="m")
    reply = runtime.complete(user("hi"), on_token=chunks.append)
    assert chunks == ["ok"]
    assert reply.content == "ok"


def test_echo_brain_never_claims_to_inspect_images():
    reply = EchoBackend().complete(
        [BrainMessage("user", "What is in this picture?", images=["data:image/png;base64,YQ=="])],
        model="echo",
        temperature=0.2,
    )
    assert "text-only" in reply.content
    assert "cannot inspect" in reply.content


def test_openai_compatible_forwards_multimodal_image_content():
    client = _StubClient(_StubResponse(200, {"choices": [{"message": {"content": "A cat"}}]}))
    image = "data:image/png;base64,Y2F0"
    message = [BrainMessage("user", "Describe this image", images=[image])]
    OpenAICompatBackend("http://h", client=client).complete(message, model="vision-model", temperature=0.2)
    content = client.calls[0][1]["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "Describe this image"}
    assert content[1] == {"type": "image_url", "image_url": {"url": image}}


def test_runtime_accumulates_stats():
    rt = BrainRuntime(EchoBackend(), default_model="m")
    rt.complete(user("one"))
    rt.complete(user("two"))
    stats = rt.stats()
    assert stats["calls"] == 2
    assert stats["tokens_in"] > 0
    assert stats["tokens_out"] > 0
    assert stats["backend"] == "echo"


def test_runtime_uses_default_model():
    rt = BrainRuntime(EchoBackend(), default_model="llama3.1:8b")
    assert rt.complete(user("hi")).model == "llama3.1:8b"


def test_runtime_honours_an_explicit_model():
    rt = BrainRuntime(EchoBackend(), default_model="default")
    assert rt.complete(user("hi"), model="override").model == "override"


@pytest.mark.parametrize("bad_temp", [-0.1, 2.1, 5.0])
def test_runtime_rejects_out_of_range_temperature(bad_temp):
    rt = BrainRuntime(EchoBackend(), default_model="m")
    with pytest.raises(ValidationFailed, match="temperature"):
        rt.complete(user("hi"), temperature=bad_temp)


def test_runtime_from_settings_picks_echo_by_default():
    from ultron_backend.config import Settings

    rt = BrainRuntime.from_settings(Settings())
    assert rt.name == "echo"


def test_runtime_does_not_count_failed_calls():
    class Boom:
        name = "boom"

        def complete(self, messages, *, model, temperature):
            raise ValidationFailed("nope")

    rt = BrainRuntime(Boom())
    with pytest.raises(ValidationFailed):
        rt.complete(user("hi"))
    assert rt.stats()["calls"] == 0



def test_openai_compatible_backend_sends_bearer_key():
    client = _StubClient(_StubResponse(200, {
        "choices": [{"message": {"content": "provider reply"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 4, "completion_tokens": 3},
    }))
    backend = OpenAICompatBackend("https://api.groq.com/openai", api_key="secret-provider-key", client=client)
    reply = backend.complete(user("hello"), model="llama-3.3-70b", temperature=0.2)
    assert reply.content == "provider reply"
    assert client.calls[0][0] == "https://api.groq.com/openai/v1/chat/completions"
    assert client.calls[0][2]["Authorization"] == "Bearer secret-provider-key"


def test_runtime_can_use_a_per_call_provider_backend_without_changing_default():
    runtime = BrainRuntime(EchoBackend(), default_model="local-model")
    provider = EchoBackend()
    provider.name = "provider-test"
    reply = runtime.complete(user("hello"), backend_override=provider)
    assert reply.backend == "provider-test"
    assert runtime.default_model == "local-model"
    assert runtime.stats()["calls"] == 1
