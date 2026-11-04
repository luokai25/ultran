/**
 * L5 - Monetization: usage ledger.
 *
 * An append-only, idempotent ledger of meter readings. Reconciliation is a
 * fold over it. Nothing increments a counter inline - meters are emitted as
 * events and folded here, so a crash or a retry cannot double-charge.
 */
export interface MeterReading {
    /** Idempotency key: (runId, meter, timestamp) collapses replayed emissions. */
    runId: string;
    meter: string;
    amount: number;
    at: number;
    /** Stable action identity prevents duplicate metering when a run is replayed. */
    idempotencyKey?: string;
}
export interface UsageTotals {
    /** meter -> accumulated amount */
    totals: Record<string, number>;
    entries: number;
}
export declare class UsageLedger {
    private readonly seen;
    private readonly entries;
    /** Record a reading. Duplicate (runId, meter, at) tuples are ignored. */
    record(reading: MeterReading): boolean;
    /** Fold the ledger into per-meter totals. */
    totals(): UsageTotals;
    /** True when the given meter has already met or exceeded its limit. */
    exceeded(meter: string, limit: number): boolean;
}
//# sourceMappingURL=ledger.d.ts.map