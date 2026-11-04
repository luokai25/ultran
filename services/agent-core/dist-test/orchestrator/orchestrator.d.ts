/**
 * L4 - Agent Orchestrator.
 *
 * The brain is replaceable; the execution contract is not. Every backend uses
 * the same plan schema, tool allow-list, validation, approval gate, audit events,
 * bounded retries, and final reflection.
 */
import { type ConnectorRegistry } from '@ultron/connectors';
import type { BrainRuntime } from '../brain/runtime.js';
import type { PolicyGate } from '../monetization/policy-gate.js';
import type { ToolSandbox } from '../sandbox/sandbox.js';
import { type RunState } from './run-state.js';
export interface ToolApprovalRequest {
    runId: string;
    stepId: string;
    toolId: string;
    capability: string;
    description: string;
    args: Record<string, unknown>;
}
/**
 * Resolve only after the human approval flow has granted this exact action.
 * Returning undefined means denied/cancelled. There is deliberately no
 * auto-approval fallback for write-capable tools.
 */
export type ToolApprovalResolver = (request: ToolApprovalRequest) => Promise<string | undefined>;
export interface OrchestratorOptions {
    brain: BrainRuntime;
    sandbox: ToolSandbox;
    registry: ConnectorRegistry;
    policyGate: PolicyGate;
    /** Hard cap on steps per run. Guards against planner loops. */
    maxSteps?: number;
    /** Model used for planning, tool selection, and final reflection. Must be loaded. */
    planModelId: string;
    /** Human approval bridge; absent means tools fail closed and are not invoked. */
    authorizeTool?: ToolApprovalResolver;
}
/** Drives a bounded observe, plan, act, reflect loop across any BrainBackend. */
export declare class Orchestrator {
    private readonly opts;
    private readonly runs;
    private readonly maxSteps;
    constructor(opts: OrchestratorOptions);
    start(goal: string): Promise<string>;
    get(runId: string): RunState | undefined;
    list(): RunState[];
    private execute;
    private plan;
    private selectTool;
    private reflect;
    private infer;
    private append;
}
//# sourceMappingURL=orchestrator.d.ts.map