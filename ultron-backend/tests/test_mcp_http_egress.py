"""Network-boundary tests for third-party Streamable HTTP MCP endpoints."""

import socket

import pytest

from ultron_backend.mcp import ServerSpec
from ultron_backend.mcp.errors import McpUnavailable
from ultron_backend.mcp.transports import _validate_http_endpoint


def _spec(url="https://mcp.example.com/mcp", **overrides):
    values = {
        "id": "remote",
        "transport": "http",
        "url": url,
        "trust_level": "third_party",
        "egress": {"allowed_hosts": ["mcp.example.com"]},
    }
    values.update(overrides)
    return ServerSpec(**values)


def _records(address):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]


def test_third_party_endpoint_accepts_public_dns(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: _records("8.8.8.8"))
    _validate_http_endpoint(_spec())


@pytest.mark.parametrize("address", [
    "127.0.0.1",
    "10.0.0.8",
    "169.254.169.254",
    "192.168.1.2",
    "::1",
    "fc00::1",
    "fe80::1",
])
def test_third_party_endpoint_rejects_private_or_non_public_dns(monkeypatch, address):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: _records(address))
    with pytest.raises(McpUnavailable, match="private, reserved or non-public"):
        _validate_http_endpoint(_spec())


def test_third_party_endpoint_rejects_http_and_nonstandard_ports():
    with pytest.raises(McpUnavailable, match="HTTPS on port 443"):
        _validate_http_endpoint(_spec("http://mcp.example.com/mcp"))
    with pytest.raises(McpUnavailable, match="HTTPS on port 443"):
        _validate_http_endpoint(_spec("https://mcp.example.com:8443/mcp"))


def test_third_party_endpoint_must_match_egress_allowlist(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: _records("8.8.8.8"))
    spec = _spec(egress={"allowed_hosts": ["another.example.com"]})
    with pytest.raises(McpUnavailable, match="egress allow-list"):
        _validate_http_endpoint(spec)


def test_local_trust_keeps_loopback_development_transport(monkeypatch):
    def unexpected_dns(*args, **kwargs):
        raise AssertionError("local trust should not perform public DNS validation")
    monkeypatch.setattr(socket, "getaddrinfo", unexpected_dns)
    _validate_http_endpoint(_spec(
        "http://127.0.0.1:8765/mcp",
        trust_level="local",
        egress={},
    ))
