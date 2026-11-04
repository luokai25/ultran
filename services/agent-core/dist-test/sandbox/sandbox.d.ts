/**
 * L3 - Tool Sandbox.
 *
 * Every tool invocation crosses a process boundary. This supervisor is the
 * only component permitted to cause side effects, and it does so only under a
 * consumed capability grant.
 *
 * Isolation targets:
 *   - WASM worker  -> pure functions, no ambient authority
 *   - container    -> network + filesystem work, allow-listed egress
 */
import type { GrantStore } from './grants.js';
export interface ToolInvocation {
    toolId: string;
    /** Capability the tool needs for this specific call. */
    capability: string;
    args: Record<string, unknown>;
    grantId: string;
    /** Hard wall-clock limit in ms. */
    timeoutMs?: number;
}
export interface ToolResult {
    ok: boolean;
    /** JSON-serializable output; withheld from the model on failure. */
    output?: unknown;
    error?: string;
    durationMs: number;
}
export interface SandboxWorker {
    exec(toolId: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
export declare class ToolSandbox {
    private readonly grants;
    private readonly workers;
    constructor(grants: GrantStore);
    register(prefix: string, worker: SandboxWorker): void;
    invoke(inv: ToolInvocation): Promise<ToolResult>;
}
/** Stable hash of arguments, recorded in the audit log. */
export declare function hashArgs(args: Record<string, unknown>): string;
//# sourceMappingURL=sandbox.d.ts.map