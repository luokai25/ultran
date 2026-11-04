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
export declare class InMemoryGrantStore implements GrantStore {
    private readonly grants;
    issue(grant: Omit<CapabilityGrant, 'id'>): CapabilityGrant;
    /**
     * Verify a grant covers the capability, is unexpired, then consume it.
     * Throws on any violation - fail closed, never fail open.
     */
    consume(id: string, capability: string): void;
    revoke(id: string): void;
    list(runId: string): CapabilityGrant[];
}
//# sourceMappingURL=grants.d.ts.map