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

export class PolicyGate {
  constructor(
    private readonly ledger: UsageLedger,
    private entitlement: Entitlement,
  ) {}

  setEntitlement(entitlement: Entitlement): void {
    this.entitlement = entitlement;
  }

  hasFeature(feature: string): boolean {
    return this.entitlement.features.includes(feature);
  }

  /**
   * Decide whether a metered action may proceed.
   *
   *   allow   - plenty of headroom
   *   degrade - within 10% of the limit; prefer cheaper options
   *   deny    - at or past the limit
   */
  async check(_runId: string, meter: string, _amount: number): Promise<PolicyDecision> {
    if (this.entitlement.expiresAt < Date.now()) {
      // An expired cached entitlement is not a reason to destroy the run.
      // Fall back to a degraded allowance rather than denying outright.
      return 'degrade';
    }

    const limit = this.entitlement.limits[meter];
    if (limit === undefined) return 'allow';

    const used = this.ledger.totals().totals[meter] ?? 0;
    if (used >= limit) return 'deny';
    if (used >= limit * 0.9) return 'degrade';
    return 'allow';
  }
}
