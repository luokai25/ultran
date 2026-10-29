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

import { createHash } from 'node:crypto';
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
  exec(
    toolId: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class ToolSandbox {
  private readonly workers = new Map<string, SandboxWorker>();

  constructor(private readonly grants: GrantStore) {}

  register(prefix: string, worker: SandboxWorker): void {
    this.workers.set(prefix, worker);
  }

  async invoke(inv: ToolInvocation): Promise<ToolResult> {
    const started = Date.now();

    // 1. Consume the grant first. Any violation throws before we touch a worker.
    this.grants.consume(inv.grantId, inv.capability);

    // 2. Resolve the worker by tool-id prefix ("github.issues.create" -> "github").
    const prefix = inv.toolId.split('.')[0] ?? '';
    const worker = this.workers.get(prefix);
    if (!worker) {
      return {
        ok: false,
        error: `no sandbox worker registered for "${prefix}"`,
        durationMs: Date.now() - started,
      };
    }

    // 3. Enforce the wall clock.
    const controller = new AbortController();
    const timeoutMs = inv.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const output = await worker.exec(inv.toolId, inv.args, controller.signal);
      return { ok: true, output, durationMs: Date.now() - started };
    } catch (err) {
      const aborted = controller.signal.aborted;
      let message: string;
      if (aborted) {
        message = `tool "${inv.toolId}" exceeded ${timeoutMs}ms`;
      } else if (err instanceof Error) {
        message = err.message;
      } else {
        message = String(err);
      }
      return { ok: false, error: message, durationMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Stable hash of arguments, recorded in the audit log. */
export function hashArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 16);
}
