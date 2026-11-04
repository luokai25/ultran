/**
 * L5 - Monetization: entitlements and the policy gate.
 *
 * The gate is consulted before an expensive action and answers allow, deny, or
 * degrade. `degrade` is what keeps a budget overrun from failing the run: the
 * orchestrator can swap to a smaller local model instead.
 *
 * Offline-first: entitlements are signed statements verified against a local
 * clock, so the gate never blocks on a billing network call.
 */
export class PolicyGate {
    ledger;
    entitlement;
    constructor(ledger, entitlement) {
        this.ledger = ledger;
        this.entitlement = entitlement;
    }
    setEntitlement(entitlement) {
        this.entitlement = entitlement;
    }
    hasFeature(feature) {
        return this.entitlement.features.includes(feature);
    }
    /**
     * Decide whether a metered action may proceed.
     *
     *   allow   - plenty of headroom
     *   degrade - within 10% of the limit; prefer cheaper options
     *   deny    - at or past the limit
     */
    async check(_runId, meter, amount) {
        if (!Number.isFinite(amount) || amount < 0) {
            throw new Error('meter amount must be a finite non-negative number');
        }
        if (this.entitlement.expiresAt < Date.now()) {
            // An expired cached entitlement is not a reason to destroy the run.
            // Fall back to a degraded allowance rather than denying outright.
            return 'degrade';
        }
        const limit = this.entitlement.limits[meter];
        if (limit === undefined)
            return 'allow';
        const used = this.ledger.totals().totals[meter] ?? 0;
        if (used + amount > limit)
            return 'deny';
        if (used + amount >= limit * 0.9)
            return 'degrade';
        return 'allow';
    }
    /** Record a completed or attempted action using a replay-stable idempotency key. */
    recordUsage(runId, meter, amount, idempotencyKey) {
        if (!Number.isFinite(amount) || amount < 0) {
            throw new Error('meter amount must be a finite non-negative number');
        }
        if (!idempotencyKey.trim())
            throw new Error('meter idempotency key must not be empty');
        return this.ledger.record({ runId, meter, amount, at: Date.now(), idempotencyKey });
    }
}
//# sourceMappingURL=policy-gate.js.map