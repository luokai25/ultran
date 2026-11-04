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
import type { UsageLedger } from './ledger.js';
import type { PolicyDecision } from '../orchestrator/run-state.js';
export interface Entitlement {
    plan: string;
    /** meter -> hard limit for the billing period. */
    limits: Record<string, number>;
    features: string[];
    /** Unix epoch ms. Cached locally; verified offline. */
    expiresAt: number;
    /** Detached signature over the fields above. */
    signature?: string;
}
export declare class PolicyGate {
    private readonly ledger;
    private entitlement;
    constructor(ledger: UsageLedger, entitlement: Entitlement);
    setEntitlement(entitlement: Entitlement): void;
    hasFeature(feature: string): boolean;
    /**
     * Decide whether a metered action may proceed.
     *
     *   allow   - plenty of headroom
     *   degrade - within 10% of the limit; prefer cheaper options
     *   deny    - at or past the limit
     */
    check(_runId: string, meter: string, amount: number): Promise<PolicyDecision>;
    /** Record a completed or attempted action using a replay-stable idempotency key. */
    recordUsage(runId: string, meter: string, amount: number, idempotencyKey: string): boolean;
}
//# sourceMappingURL=policy-gate.d.ts.map