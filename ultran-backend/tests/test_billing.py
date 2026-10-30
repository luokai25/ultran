"""Billing tests: plans, metering, idempotent ledger."""

from __future__ import annotations

import pytest

from ultran_backend.billing import PLANS, BillingService
from ultran_backend.errors import QuotaExceeded, ValidationFailed


def svc(**kw) -> BillingService:
    return BillingService(**kw)


# ------------------------------------------------------------------- plans


def test_three_plans_are_offered():
    assert [p["id"] for p in svc().plans()] == ["free", "studio", "atelier"]


def test_free_plan_is_free_and_the_others_are_paid():
    plans = {p["id"]: p for p in svc().plans()}
    assert plans["free"]["price_usd_cents"] == 0
    assert plans["studio"]["price_usd_cents"] > 0
    assert plans["atelier"]["price_usd_cents"] > plans["studio"]["price_usd_cents"]


def test_allowances_increase_with_the_plan():
    plans = {p["id"]: p for p in svc().plans()}
    assert plans["free"]["monthly_tokens"] < plans["studio"]["monthly_tokens"]
    assert plans["studio"]["monthly_tokens"] < plans["atelier"]["monthly_tokens"]


def test_every_plan_declares_features_and_a_connector_limit():
    for plan in svc().plans():
        assert plan["features"]
        assert plan["connector_limit"] > 0


def test_free_allowance_follows_configuration():
    s = svc(default_monthly_tokens=1234)
    assert s.allowance("acct") == 1234


def test_accounts_start_on_the_free_plan():
    assert svc().account("acct").plan == "free"


def test_subscribe_changes_the_allowance():
    s = svc()
    s.subscribe("acct", "studio")
    assert s.allowance("acct") == PLANS["studio"]["monthly_tokens"]


def test_subscribe_rejects_an_unknown_plan():
    with pytest.raises(ValidationFailed, match="plan"):
        svc().subscribe("acct", "platinum")


# ----------------------------------------------------------------- metering


def test_meter_accumulates_usage():
    s = svc()
    s.meter("acct", 100)
    s.meter("acct", 50)
    assert s.usage("acct")["tokens_used"] == 150


def test_usage_reports_percentage_and_remaining():
    s = svc(default_monthly_tokens=1000)
    s.meter("acct", 250)
    u = s.usage("acct")
    assert u["percent_used"] == 25.0
    assert u["remaining"] == 750


def test_meter_rejects_negative_tokens():
    with pytest.raises(ValidationFailed, match="tokens"):
        svc().meter("acct", -1)


def test_meter_raises_when_the_allowance_would_be_exceeded():
    s = svc(default_monthly_tokens=100)
    with pytest.raises(QuotaExceeded, match="exhausted"):
        s.meter("acct", 101)


def test_a_rejected_meter_call_does_not_mutate_usage():
    s = svc(default_monthly_tokens=100)
    s.meter("acct", 60)
    with pytest.raises(QuotaExceeded):
        s.meter("acct", 60)
    assert s.usage("acct")["tokens_used"] == 60


def test_meter_allows_exactly_the_allowance():
    s = svc(default_monthly_tokens=100)
    s.meter("acct", 100)
    assert s.usage("acct")["remaining"] == 0


def test_upgrading_a_plan_unblocks_metering():
    s = svc(default_monthly_tokens=100)
    s.meter("acct", 100)
    with pytest.raises(QuotaExceeded):
        s.meter("acct", 1)
    s.subscribe("acct", "studio")
    s.meter("acct", 1)
    assert s.usage("acct")["tokens_used"] == 101


# ------------------------------------------------------------------- ledger


def test_charge_updates_the_balance():
    s = svc()
    out = s.charge("acct", 2500)
    assert out["balance_cents"] == 2500
    assert s.usage("acct")["balance_cents"] == 2500


def test_charges_accumulate():
    s = svc()
    s.charge("acct", 1000)
    s.charge("acct", 500)
    assert len(s.ledger("acct")) == 2
    assert s.usage("acct")["balance_cents"] == 1500


def test_a_zero_charge_is_rejected():
    with pytest.raises(ValidationFailed, match="zero"):
        svc().charge("acct", 0)


def test_a_non_integer_charge_is_rejected():
    with pytest.raises(ValidationFailed, match="integer"):
        svc().charge("acct", 12.5)  # type: ignore[arg-type]


def test_replaying_an_idempotency_key_returns_the_same_charge():
    s = svc()
    first = s.charge("acct", 900, idempotency_key="order-1")
    second = s.charge("acct", 900, idempotency_key="order-1")
    assert first["id"] == second["id"]
    assert s.usage("acct")["balance_cents"] == 900
    assert len(s.ledger("acct")) == 1


def test_distinct_keys_create_distinct_charges():
    s = svc()
    a = s.charge("acct", 100, idempotency_key="a")
    b = s.charge("acct", 100, idempotency_key="b")
    assert a["id"] != b["id"]
    assert s.usage("acct")["balance_cents"] == 200


def test_charges_without_a_key_are_always_distinct():
    s = svc()
    a = s.charge("acct", 100)
    b = s.charge("acct", 100)
    assert a["id"] != b["id"]


def test_a_refund_offsets_the_balance():
    s = svc()
    s.charge("acct", 1000)
    s.charge("acct", -400, kind="refund")
    assert s.usage("acct")["balance_cents"] == 600


def test_ledger_is_isolated_per_account():
    s = svc()
    s.charge("a", 100)
    s.charge("b", 200)
    assert len(s.ledger("a")) == 1
    assert len(s.ledger("b")) == 1


def test_revenue_counts_only_positive_charges():
    s = svc()
    s.charge("a", 1000)
    s.charge("a", -250, kind="refund")
    assert s.revenue_cents() == 1000


def test_summary_reports_activity():
    s = svc()
    s.charge("a", 500)
    summary = s.summary()
    assert summary["accounts"] == 1
    assert summary["charges"] == 1
    assert summary["revenue_cents"] == 500


def test_empty_summary_is_zeroed():
    assert svc().summary()["charges"] == 0
