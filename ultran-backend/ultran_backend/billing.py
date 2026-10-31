"""Billing: plans, token metering and an idempotent charge ledger.

Two rules the ledger enforces, because both have bitten real products:

1. **A charge needs an idempotency key.** Replaying the same key returns the
   original entry instead of charging twice.
2. **Usage is metered, not trusted.** Token counts come from the brain runtime's
   own estimator, never from a caller-supplied number.
"""

from __future__ import annotations

import uuid
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .connectors.credentials import utcnow
from .errors import Conflict, NotFound, QuotaExceeded, ValidationFailed

PLANS: dict[str, dict[str, Any]] = {
    "free": {
        "id": "free",
        "name": "Local Free",
        "monthly_tokens": 100_000,
        "price_usd_cents": 0,
        "connector_limit": 8,
        "features": ["local brain runtime", "8 connectors", "unlimited local deploys"],
    },
    "studio": {
        "id": "studio",
        "name": "Studio",
        "monthly_tokens": 2_000_000,
        "price_usd_cents": 2900,
        "connector_limit": 40,
        "features": ["everything in free", "40 connectors", "custom domains", "forge signing"],
    },
    "atelier": {
        "id": "atelier",
        "name": "Atelier",
        "monthly_tokens": 20_000_000,
        "price_usd_cents": 9900,
        "connector_limit": 1000,
        "features": ["everything in studio", "unlimited connectors", "team seats", "priority forge"],
    },
}


@dataclass
class Charge:
    id: str
    account_id: str
    amount_cents: int
    kind: str
    memo: str
    idempotency_key: str
    balance_after: int
    created_at: datetime = field(default_factory=utcnow)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "account_id": self.account_id,
            "amount_cents": self.amount_cents,
            "kind": self.kind,
            "memo": self.memo,
            "balance_cents": self.balance_after,
            "created_at": self.created_at,
        }


@dataclass
class Account:
    id: str
    plan: str = "free"
    tokens_used: int = 0
    balance_cents: int = 0
    charges: list[Charge] = field(default_factory=list)
    _keys: dict[str, str] = field(default_factory=dict)


class BillingService:
    def __init__(self, *, default_monthly_tokens: int = 100_000) -> None:
        self._accounts: dict[str, Account] = {}
        self._lock = threading.RLock()
        self.default_monthly_tokens = default_monthly_tokens
        # keep the free plan's allowance in sync with configuration
        PLANS["free"]["monthly_tokens"] = default_monthly_tokens

    # ------------------------------------------------------------------ #
    def plans(self) -> list[dict[str, Any]]:
        return [PLANS[k] for k in ("free", "studio", "atelier")]

    def account(self, account_id: str) -> Account:
        with self._lock:
            if account_id not in self._accounts:
                self._accounts[account_id] = Account(id=account_id)
            return self._accounts[account_id]

    def subscribe(self, account_id: str, plan: str) -> Account:
        if plan not in PLANS:
            raise ValidationFailed("unknown plan", details={"plan": plan, "valid": sorted(PLANS)})
        with self._lock:
            acct = self.account(account_id)
            acct.plan = plan
            return acct

    def allowance(self, account_id: str) -> int:
        with self._lock:
            return int(PLANS[self.account(account_id).plan]["monthly_tokens"])

    def meter(self, account_id: str, tokens: int) -> dict[str, Any]:
        """Record token usage atomically across API and background workers."""
        if tokens < 0:
            raise ValidationFailed("tokens must be >= 0")
        with self._lock:
            acct = self.account(account_id)
            allowance = self.allowance(account_id)
            if acct.tokens_used + tokens > allowance:
                raise QuotaExceeded(
                    "monthly token allowance exhausted",
                    details={"account_id": account_id, "used": acct.tokens_used,
                             "requested": tokens, "allowance": allowance},
                )
            acct.tokens_used += tokens
            return self.usage(account_id)

    def usage(self, account_id: str) -> dict[str, Any]:
        with self._lock:
            acct = self.account(account_id)
            allowance = self.allowance(account_id)
            pct = round((acct.tokens_used / allowance) * 100, 2) if allowance else 0.0
            return {"account_id": account_id, "plan": acct.plan, "tokens_used": acct.tokens_used,
                    "tokens_allowance": allowance, "percent_used": pct,
                    "remaining": max(0, allowance - acct.tokens_used), "balance_cents": acct.balance_cents}

    # ------------------------------------------------------------------ #
    def charge(
        self,
        account_id: str,
        amount_cents: int,
        *,
        kind: str = "usage",
        memo: str = "",
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if not isinstance(amount_cents, int):
            raise ValidationFailed("amount_cents must be an integer")
        if amount_cents == 0:
            raise ValidationFailed("amount_cents must not be zero")
        key = (idempotency_key or "").strip() or f"auto_{uuid.uuid4().hex}"
        with self._lock:
            acct = self.account(account_id)
            if key in acct._keys:
                existing_id = acct._keys[key]
                for c in acct.charges:
                    if c.id == existing_id:
                        return c.public()
                raise Conflict("idempotency key points at a missing charge", details={"key": key})
            new_balance = acct.balance_cents + amount_cents
            charge = Charge(id=f"ch_{uuid.uuid4().hex[:12]}", account_id=account_id,
                            amount_cents=amount_cents, kind=kind, memo=memo,
                            idempotency_key=key, balance_after=new_balance)
            acct.charges.append(charge)
            acct._keys[key] = charge.id
            acct.balance_cents = new_balance
            return charge.public()

    def ledger(self, account_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [c.public() for c in self.account(account_id).charges]

    def revenue_cents(self) -> int:
        with self._lock:
            return sum(c.amount_cents for acct in self._accounts.values()
                       for c in acct.charges if c.amount_cents > 0)

    def summary(self) -> dict[str, Any]:
        with self._lock:
            return {"accounts": len(self._accounts),
                    "charges": sum(len(a.charges) for a in self._accounts.values()),
                    "revenue_cents": self.revenue_cents(),
                    "plans": {k: v["price_usd_cents"] for k, v in PLANS.items()}}
