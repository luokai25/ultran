/**
 * L4 - Agent Orchestrator: run state.
 *
 * The append-only event log is the single source of truth for a run. The UI
 * is a projection of it; replay is a re-fold over it. Nothing else is
 * authoritative.
 */

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type PolicyDecision = 'allow' | 'deny' | 'degrade';

export type RunEvent =
  | { type: 'run.started'; runId: string; goal: string; at: number }
  | { type: 'plan.created'; runId: string; steps: PlanStep[]; at: number }
  | { type: 'step.started'; runId: string; stepId: string; at: number }
  | {
      type: 'tool.invoked';
      runId: string;
      stepId: string;
      toolId: string;
      argsHash: string;
      at: number;
    }
  | {
      type: 'tool.result';
      runId: string;
      stepId: string;
      toolId: string;
      resultHash: string;
      ok: boolean;
      at: number;
    }
  | { type: 'meter.emitted'; runId: string; meter: string; amount: number; at: number }
  | { type: 'policy.decided'; runId: string; decision: PolicyDecision; at: number }
  | { type: 'step.completed'; runId: string; stepId: string; at: number }
  | { type: 'run.completed'; runId: string; status: RunStatus; at: number };

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
}

/**
 * Validate that a dependency graph is acyclic and every referenced step exists.
 * A bad plan must be rejected before any tool is invoked.
 */
export function validatePlan(steps: PlanStep[]): string[] {
  const errors: string[] = [];
  const ids = new Set(steps.map((s) => s.id));

  if (ids.size !== steps.length) {
    errors.push('plan contains duplicate step ids');
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) {
        errors.push(`step "${step.id}" depends on unknown step "${dep}"`);
      }
      if (dep === step.id) {
        errors.push(`step "${step.id}" depends on itself`);
      }
    }
  }

  // Cycle detection via Kahn's algorithm.
  const indegree = new Map<string, number>();
  for (const step of steps) indegree.set(step.id, step.dependsOn.length);

  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(step.id);
      dependents.set(dep, list);
    }
  }

  const queue = steps.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
  let visited = 0;

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    visited += 1;
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (visited !== steps.length) {
    errors.push('plan contains a dependency cycle');
  }

  return errors;
}
