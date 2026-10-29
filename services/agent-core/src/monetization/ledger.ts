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
}

export interface UsageTotals {
  /** meter -> accumulated amount */
  totals: Record<string, number>;
  entries: number;
}

export class UsageLedger {
  private readonly seen = new Set<string>();
  private readonly entries: MeterReading[] = [];

  /** Record a reading. Duplicate (runId, meter, at) tuples are ignored. */
  record(reading: MeterReading): boolean {
    const key = `${reading.runId}::${reading.meter}::${reading.at}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.entries.push(reading);
    return true;
  }

  /** Fold the ledger into per-meter totals. */
  totals(): UsageTotals {
    const totals: Record<string, number> = {};
    for (const e of this.entries) {
      totals[e.meter] = (totals[e.meter] ?? 0) + e.amount;
    }
    return { totals, entries: this.entries.length };
  }

  /** True when the given meter has already met or exceeded its limit. */
  exceeded(meter: string, limit: number): boolean {
    return (this.totals().totals[meter] ?? 0) >= limit;
  }
}
