/**
 * L3 - Tool Sandbox: capability grants.
 *
 * A grant is the ONLY way to authorize a side effect. Grants are scoped to a
 * run, expire, and are single-use per invocation. Nothing in the system may
 * call a tool without one.
 */
/** In-memory grant store. TODO: back with the encrypted vault (L0). */
export class InMemoryGrantStore {
    grants = new Map();
    issue(grant) {
        const full = { ...grant, id: crypto.randomUUID() };
        this.grants.set(full.id, full);
        return full;
    }
    /**
     * Verify a grant covers the capability, is unexpired, then consume it.
     * Throws on any violation - fail closed, never fail open.
     */
    consume(id, capability) {
        const grant = this.grants.get(id);
        if (!grant)
            throw new Error(`unknown grant "${id}"`);
        if (Date.now() > grant.expiresAt) {
            this.grants.delete(id);
            throw new Error(`grant "${id}" has expired`);
        }
        if (!grant.capabilities.includes(capability)) {
            throw new Error(`grant "${id}" does not cover capability "${capability}"`);
        }
        if (grant.singleUse)
            this.grants.delete(id);
    }
    revoke(id) {
        this.grants.delete(id);
    }
    list(runId) {
        return [...this.grants.values()].filter((g) => g.runId === runId);
    }
}
//# sourceMappingURL=grants.js.map