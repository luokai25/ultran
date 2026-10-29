/**
 * L3 - Tool Sandbox: capability grants.
 *
 * A grant is the ONLY way to authorize a side effect. Grants are scoped to a
 * run, expire, and are single-use per invocation. Nothing in the system may
 * call a tool without one.
 */

export interface CapabilityGrant {
  /** Unique grant id, referenced by the audit log. */
  id: string;
  runId: string;
  /** Capabilities authorized, e.g. ["repo:read", "issue:write"]. */
  capabilities: string[];
  /** Unix epoch ms. After this instant the grant is dead. */
  expiresAt: number;
  /** Consumed on first use; cannot be replayed. */
  singleUse: boolean;
}

export interface GrantStore {
  issue(grant: Omit<CapabilityGrant, 'id'>): CapabilityGrant;
  consume(id: string, capability: string): void;
  revoke(id: string): void;
  list(runId: string): CapabilityGrant[];
}

/** In-memory grant store. TODO: back with the encrypted vault (L0). */
export class InMemoryGrantStore implements GrantStore {
  private readonly grants = new Map<string, CapabilityGrant>();

  issue(grant: Omit<CapabilityGrant, 'id'>): CapabilityGrant {
    const full: CapabilityGrant = { ...grant, id: crypto.randomUUID() };
    this.grants.set(full.id, full);
    return full;
  }

  /**
   * Verify a grant covers the capability, is unexpired, then consume it.
   * Throws on any violation - fail closed, never fail open.
   */
  consume(id: string, capability: string): void {
    const grant = this.grants.get(id);
    if (!grant) throw new Error(`unknown grant "${id}"`);
    if (Date.now() > grant.expiresAt) {
      this.grants.delete(id);
      throw new Error(`grant "${id}" has expired`);
    }
    if (!grant.capabilities.includes(capability)) {
      throw new Error(`grant "${id}" does not cover capability "${capability}"`);
    }
    if (grant.singleUse) this.grants.delete(id);
  }

  revoke(id: string): void {
    this.grants.delete(id);
  }

  list(runId: string): CapabilityGrant[] {
    return [...this.grants.values()].filter((g) => g.runId === runId);
  }
}
