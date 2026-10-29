/**
 * L4 - Agent Orchestrator.
 *
 * Drives the observe, plan, act, reflect loop. The planner is the only
 * component that talks to the brain; the dispatcher is the only component that
 * talks to the sandbox. Neither knows how the other works.
 */

import type { ConnectorRegistry } from '@ultran/connectors';
import type { BrainRuntime } from '../brain/runtime.js';
import type { PolicyGate } from '../monetization/policy-gate.js';
import type { ToolSandbox } from '../sandbox/sandbox.js';
import {
  validatePlan,
  type PlanStep,
  type RunEvent,
  type RunState,
  type RunStatus,
} from './run-state.js';

export interface OrchestratorOptions {
  brain: BrainRuntime;
  sandbox: ToolSandbox;
  registry: ConnectorRegistry;
  policyGate: PolicyGate;
  /** Hard cap on steps per run. Guards against planner loops. */
  maxSteps?: number;
  /** Model used for planning. Must already be loaded. */
  planModelId: string;
}

export class Orchestrator {
  private readonly runs = new Map<string, RunState>();
  private readonly maxSteps: number;

  constructor(private readonly opts: OrchestratorOptions) {
    this.maxSteps = opts.maxSteps ?? 24;
  }

  /**
   * Start a run. Returns the run ID immediately; execution continues in the
   * background and streams events into the log.
   */
  async start(goal: string): Promise<string> {
    const runId = crypto.randomUUID();
    const state: RunState = {
      runId,
      goal,
      status: 'running',
      startedAt: Date.now(),
      events: [],
    };
    this.runs.set(runId, state);
    this.append(state, { type: 'run.started', runId, goal, at: Date.now() });

    void this.execute(state).catch((err: unknown) => {
      state.status = 'failed';
      this.append(state, {
        type: 'run.completed',
        runId,
        status: 'failed',
        at: Date.now(),
      });
      console.error(`[run ${runId}] failed`, err);
    });

    return runId;
  }

  get(runId: string): RunState | undefined {
    return this.runs.get(runId);
  }

  list(): RunState[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  private async execute(state: RunState): Promise<void> {
    const plan = await this.plan(state.goal);
    const errors = validatePlan(plan);
    if (errors.length > 0) {
      throw new Error(`invalid plan: ${errors.join('; ')}`);
    }

    this.append(state, {
      type: 'plan.created',
      runId: state.runId,
      steps: plan,
      at: Date.now(),
    });

    if (plan.length > this.maxSteps) {
      throw new Error(`plan exceeds maxSteps (${plan.length} > ${this.maxSteps})`);
    }

    for (const step of plan) {
      // The policy gate answers allow | deny | degrade before we spend anything.
      const decision = await this.opts.policyGate.check(state.runId, 'tool.calls', 1);
      this.append(state, {
        type: 'policy.decided',
        runId: state.runId,
        decision,
        at: Date.now(),
      });
      if (decision === 'deny') break;

      this.append(state, {
        type: 'step.started',
        runId: state.runId,
        stepId: step.id,
        at: Date.now(),
      });

      // TODO: select a concrete tool from step.candidates via model ranking,
      // then invoke the sandbox under a scoped grant.
      this.append(state, {
        type: 'step.completed',
        runId: state.runId,
        stepId: step.id,
        at: Date.now(),
      });
    }

    state.status = 'completed';
    this.append(state, {
      type: 'run.completed',
      runId: state.runId,
      status: 'completed' as RunStatus,
      at: Date.now(),
    });
  }

  /**
   * Ask the brain for a plan constrained to currently-granted capabilities.
   *
   * TODO: real constrained-decoding call against planModelId with a JSON
   * schema for PlanStep[].
   */
  private async plan(goal: string): Promise<PlanStep[]> {
    const availableTools = this.opts.registry.listTools();
    void availableTools;
    void goal;
    return [];
  }

  private append(state: RunState, event: RunEvent): void {
    state.events.push(event);
  }
}
