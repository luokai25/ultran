"""Egress allow-list: the bypasses the spec names, plus budgets and logging."""

from __future__ import annotations

import pytest

from ultran_backend.mcp.egress import (
    DEFAULT_BYTE_CAP,
    EgressPolicy,
    EgressRequest,
    normalise_host,
    parse_url,
    policy_from_config,
)
from ultran_backend.mcp.errors import EgressDenied


@pytest.fixture()
def policy() -> EgressPolicy:
    return EgressPolicy(["api.github.com", "github.com", "api.slack.com"])


# ---------------------------------------------------------------- allow-list


def test_allowed_host_passes(policy):
    assert policy.check("https://api.github.com/repos/x").allowed


def test_exact_host_passes(policy):
    assert policy.check("https://github.com/").allowed


def test_unknown_host_is_denied(policy):
    decision = policy.check("https://evil.com/steal")
    assert not decision.allowed
    assert decision.rule == "allowlist"


def test_subdomain_of_an_allowed_host_passes(policy):
    assert policy.check("https://gist.github.com/x").allowed


def test_suffix_match_is_on_label_boundaries(policy):
    """``evilgithub.com`` must not match ``github.com``."""
    assert not policy.check("https://evilgithub.com/").allowed
    assert not policy.check("https://notgithub.com/").allowed


def test_allowed_host_as_a_prefix_of_an_attacker_domain_is_denied(policy):
    assert not policy.check("https://github.com.evil.io/").allowed


def test_wildcard_rule_grants_exactly_one_label():
    p = EgressPolicy(["*.example.com"])
    assert p.check("https://api.example.com/").allowed
    assert not p.check("https://a.b.example.com/").allowed
    assert not p.check("https://example.com/").allowed


# ---------------------------------------------------------------- bypasses


def test_userinfo_bypass_is_rejected(policy):
    """``https://api.github.com@evil.com/`` - the classic one."""
    with pytest.raises(EgressDenied, match="userinfo"):
        parse_url("https://api.github.com@evil.com/")


def test_userinfo_with_password_is_rejected(policy):
    with pytest.raises(EgressDenied, match="userinfo"):
        parse_url("https://user:pw@api.slack.com/hook")


def test_credentials_are_redacted_in_the_error():
    with pytest.raises(EgressDenied) as exc:
        parse_url("https://user:secret@evil.com/")
    assert "secret" not in str(exc.value.details)


def test_loopback_is_blocked(policy):
    assert not policy.check("http://127.0.0.1:8080/x").allowed
    assert not policy.check("http://localhost/x").allowed


def test_private_ranges_are_blocked(policy):
    for url in ("http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.1/", "http://169.254.1.1/"):
        assert not policy.check(url).allowed, url


def test_private_blocking_can_be_disabled():
    p = EgressPolicy(["127.0.0.1"], deny_private=False)
    assert p.check("http://127.0.0.1:9000/").allowed


def test_non_http_schemes_are_not_egress(policy):
    for url in ("file:///etc/passwd", "ftp://api.github.com/x", "gopher://api.github.com/"):
        decision = policy.check(url)
        assert not decision.allowed, url


def test_malformed_host_is_denied(policy):
    assert not policy.check(EgressRequest(host="bad host with spaces")).allowed


def test_empty_url_is_rejected():
    with pytest.raises(EgressDenied):
        parse_url("")


def test_url_without_scheme_is_rejected():
    with pytest.raises(EgressDenied, match="scheme"):
        parse_url("api.github.com/x")


# ---------------------------------------------------------------- budgets


def test_byte_budget_is_enforced():
    p = EgressPolicy(["api.github.com"], byte_cap=100)
    assert p.check(EgressRequest(host="api.github.com", bytes=50)).allowed
    p.require(EgressRequest(host="api.github.com", bytes=50))
    decision = p.check(EgressRequest(host="api.github.com", bytes=80))
    assert not decision.allowed
    assert decision.rule == "byte_budget"


def test_request_budget_is_enforced():
    p = EgressPolicy(["api.github.com"], request_cap=2)
    p.require("https://api.github.com/a")
    p.require("https://api.github.com/b")
    decision = p.check("https://api.github.com/c")
    assert not decision.allowed
    assert decision.rule == "request_budget"


def test_default_byte_cap_matches_the_spec():
    assert DEFAULT_BYTE_CAP == 32 * 1024 * 1024


def test_usage_reports_consumption():
    p = EgressPolicy(["api.github.com"])
    p.require(EgressRequest(host="api.github.com", bytes=10))
    usage = p.usage()
    assert usage["bytes_used"] == 10
    assert usage["requests_used"] == 1
    assert "api.github.com" in usage["allowed_hosts"]


def test_reset_clears_budgets():
    p = EgressPolicy(["api.github.com"], request_cap=1)
    p.require("https://api.github.com/a")
    p.reset()
    assert p.check("https://api.github.com/b").allowed


# ---------------------------------------------------------------- logging


def test_every_decision_is_logged(policy):
    policy.check("https://api.github.com/ok")
    policy.check("https://evil.com/no")
    entries = policy.log()
    assert len(entries) == 2
    assert {e["allowed"] for e in entries} == {True, False}


def test_denied_returns_only_denials(policy):
    policy.check("https://api.github.com/ok")
    policy.check("https://evil.com/no")
    denied = policy.denied()
    assert len(denied) == 1
    assert denied[0]["host"] == "evil.com"


def test_log_records_host_path_and_bytes(policy):
    policy.check(EgressRequest(host="api.github.com", path="/repos", bytes=42))
    entry = policy.log()[0]
    assert entry["host"] == "api.github.com"
    assert entry["path"] == "/repos"
    assert entry["bytes"] == 42


def test_require_raises_with_actionable_details(policy):
    with pytest.raises(EgressDenied) as exc:
        policy.require("https://evil.com/x")
    assert exc.value.details["host"] == "evil.com"
    assert exc.value.code == "egress_denied"


# ---------------------------------------------------------------- config


def test_policy_from_config_reads_the_block():
    p = policy_from_config(
        {"allowed_hosts": ["api.example.com"], "byte_cap": 10, "request_cap": 3}
    )
    assert p.byte_cap == 10
    assert p.request_cap == 3
    assert p.check("https://api.example.com/").allowed


def test_policy_from_empty_config_uses_defaults():
    p = policy_from_config(None)
    assert p.byte_cap == DEFAULT_BYTE_CAP
    assert p.check("https://api.github.com/").allowed


def test_with_hosts_widens_a_copy_not_the_original(policy):
    wider = policy.with_hosts(["api.example.com"])
    assert wider.check("https://api.example.com/").allowed
    assert not policy.check("https://api.example.com/").allowed


def test_normalise_host_strips_trailing_dot_and_case():
    assert normalise_host("API.GitHub.COM.") == "api.github.com"


def test_normalise_host_rejects_userinfo():
    with pytest.raises(EgressDenied):
        normalise_host("user@host.com")
