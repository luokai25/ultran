"""Configuration surface tests."""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from ultran_backend.config import Settings


def test_defaults_are_sane():
    s = Settings()
    assert s.brain_backend == "echo"
    assert s.api_prefix == "/v1"
    assert s.sandbox_max_ttl_s > 0
    assert s.is_production is False


def test_from_env_reads_every_knob():
    s = Settings.from_env(
        {
            "ULTRAN_ENV": "production",
            "ULTRAN_API_PREFIX": "/api",
            "ULTRAN_BRAIN_BACKEND": "OLLAMA",
            "ULTRAN_BRAIN_TIMEOUT_S": "12.5",
            "ULTRAN_SANDBOX_MAX_TTL_S": "60",
            "ULTRAN_FREE_PLAN_MONTHLY_TOKENS": "4242",
            "ULTRAN_DEBUG": "true",
        }
    )
    assert s.environment == "production"
    assert s.is_production is True
    assert s.api_prefix == "/api"
    assert s.brain_backend == "ollama"
    assert s.brain_timeout_s == 12.5
    assert s.sandbox_max_ttl_s == 60
    assert s.free_plan_monthly_tokens == 4242
    assert s.debug is True


@pytest.mark.parametrize("raw,expected", [("abc", 30.0), ("", 30.0), ("7", 7.0)])
def test_float_parsing_is_forgiving(raw, expected):
    assert Settings.from_env({"ULTRAN_BRAIN_TIMEOUT_S": raw}).brain_timeout_s == expected


@pytest.mark.parametrize("raw,expected", [("nope", 900), ("", 900), ("5", 5)])
def test_int_parsing_is_forgiving(raw, expected):
    assert Settings.from_env({"ULTRAN_SANDBOX_MAX_TTL_S": raw}).sandbox_max_ttl_s == expected


def test_unknown_brain_backend_rejected():
    with pytest.raises(ValueError, match="brain_backend"):
        Settings(brain_backend="openai")


def test_api_prefix_must_be_absolute():
    with pytest.raises(ValueError, match="api_prefix"):
        Settings(api_prefix="v1")


def test_negative_ttl_rejected():
    with pytest.raises(ValueError, match="sandbox_max_ttl_s"):
        Settings(sandbox_max_ttl_s=0)


def test_negative_allowance_rejected():
    with pytest.raises(ValueError, match="free_plan_monthly_tokens"):
        Settings(free_plan_monthly_tokens=-1)


def test_settings_are_immutable_and_overridable():
    s = Settings()
    with pytest.raises(FrozenInstanceError):
        s.environment = "prod"  # type: ignore[misc]
    copy = s.with_overrides(environment="staging")
    assert copy.environment == "staging"
    assert s.environment == "dev"
    assert copy is not s
