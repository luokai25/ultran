/**
 * L4 - Agent Orchestrator: run state.
 *
 * The append-only event log is the single source of truth for a run. The UI
 * is a projection of it; replay is a re-fold over it. Nothing else is
 * authoritative.
 */
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type PolicyDecision = 'allow' | 'deny' | 'degrade';
export type RunEvent = {
    type: 'run.started';
    runId: string;
    goal: string;
    at: number;
} | {
    type: 'plan.created';
    runId: string;
    steps: PlanStep[];
    at: number;
} | {
    type: 'step.started';
    runId: string;
    stepId: string;
    at: number;
} | {
    type: 'tool.invoked';
    runId: string;
    stepId: string;
    toolId: string;
    argsHash: string;
    at: number;
} | {
    type: 'tool.result';
    runId: string;
    stepId: string;
    toolId: string;
    resultHash: string;
    ok: boolean;
    at: number;
} | {
    type: 'meter.emitted';
    runId: string;
    meter: string;
    amount: number;
    at: number;
} | {
    type: 'policy.decided';
    runId: string;
    decision: PolicyDecision;
    at: number;
} | {
    type: 'step.completed';
    runId: string;
    stepId: string;
    at: number;
} | {
    type: 'step.failed';
    runId: string;
    stepId: string;
    reason: string;
    at: number;
} | {
    type: 'approval.required';
    runId: string;
    stepId: string;
    toolId: string;
    capability: string;
    at: number;
} | {
    type: 'run.result';
    runId: string;
    result: string;
    at: number;
} | {
    type: 'run.completed';
    runId: string;
    status: RunStatus;
    at: number;
};
export interface PlanStep {
    id: string;
    /** Tools this step is allowed to call, by capability-filtered ID. */
    candidates: string[];
    /** Step IDs that must finish before this one may start. */
    dependsOn: string[];
    description: string;
}
export interface RunState {
    runId: string;
    goal: string;
    status: RunStatus;
    startedAt: number;
    events: RunEvent[];
    /** Final user-facing synthesis from the active brain, if available. */
    result?: string;
}
/**
 * Validate that a dependency graph is acyclic and every referenced step exists.
 * A bad plan must be rejected before any tool is invoked.
 */
export declare function validatePlan(steps: PlanStep[]): string[];
//# sourceMappingURL=run-state.d.ts.map