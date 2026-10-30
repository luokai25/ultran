"""Provider connectivity probes never disclose credentials."""
from __future__ import annotations

import pytest

from ultran_backend.errors import DependencyUnavailable, ValidationFailed
from ultran_backend.provider_connections import PROVIDER_PROBES, probe_provider


class Response:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self.body = body or {"data": [{"id": "model-a"}, {"id": "model-b"}]}

    def json(self):
        return self.body


class Client:
    def __init__(self, response=None, error=None):
        self.response = response or Response()
        self.error = error
        self.calls = []

    def get(self, url, headers=None):
        self.calls.append((url, headers))
        if self.error:
            raise self.error
        return self.response


@pytest.mark.parametrize("provider", sorted(PROVIDER_PROBES))
def test_probe_uses_bearer_auth_and_only_returns_public_metadata(provider):
    client = Client()
    result = probe_provider(provider, "secret-api-key-123", client=client)
    assert result.ok is True
    assert result.status == "connected"
    assert result.models_count == 2
    assert client.calls[0][0] == PROVIDER_PROBES[provider][0]
    auth_header = PROVIDER_PROBES[provider][1]\n    expected = "Bearer secret-api-key-123" if auth_header == "Authorization" else "secret-api-key-123"\n    assert client.calls[0][1][auth_header] == expected
    assert "secret-api-key-123" not in str(result.public())


def test_probe_reports_invalid_key_without_echoing_it():
    result = probe_provider("groq", "secret-api-key-123", client=Client(Response(401)))
    assert result.ok is False
    assert result.status == "unauthorized"
    assert "secret-api-key-123" not in str(result.public())


def test_probe_rejects_unsupported_provider():
    with pytest.raises(ValidationFailed, match="does not yet support"):
        probe_provider("anthropic", "secret-api-key-123", client=Client())


def test_probe_normalizes_network_errors_without_leaking_credentials():
    with pytest.raises(DependencyUnavailable) as exc:
        probe_provider("groq", "secret-api-key-123", client=Client(error=OSError("network down")))
    assert "secret-api-key-123" not in str(exc.value.details)


def test_probe_rejects_short_keys():
    with pytest.raises(ValidationFailed, match="API key"):
        probe_provider("groq", "short", client=Client())
