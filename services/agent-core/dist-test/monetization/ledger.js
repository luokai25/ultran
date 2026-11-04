/**
 * L5 - Monetization: usage ledger.
 *
 * An append-only, idempotent ledger of meter readings. Reconciliation is a
 * fold over it. Nothing increments a counter inline - meters are emitted as
 * events and folded here, so a crash or a retry cannot double-charge.
 */
export class UsageLedger {
    seen = new Set();
    entries = [];
    /** Record a reading. Duplicate (runId, meter, at) tuples are ignored. */
    record(reading) {
        const key = reading.idempotencyKey ?? `${reading.runId}::${reading.meter}::${reading.at}`;
        if (this.seen.has(key))
            return false;
        this.seen.add(key);
        this.entries.push(reading);
        return true;
    }
    /** Fold the ledger into per-meter totals. */
    totals() {
        const totals = {};
        for (const e of this.entries) {
            totals[e.meter] = (totals[e.meter] ?? 0) + e.amount;
        }
        return { totals, entries: this.entries.length };
    }
    /** True when the given meter has already met or exceeded its limit. */
    exceeded(meter, limit) {
        return (this.totals().totals[meter] ?? 0) >= limit;
    }
}
//# sourceMappingURL=ledger.js.map