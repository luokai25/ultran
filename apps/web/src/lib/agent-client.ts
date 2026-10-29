/**
 * Client for the local agent-core boundary.
 *
 * The web console never runs inference and never invokes the sandbox
 * directly. Everything goes through agent-core's local HTTP surface.
 */

export interface RunSummary {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  goal: string;
}

const BASE_URL = process.env.ULTRAN_AGENT_CORE_URL ?? 'http://127.0.0.1:7700';

export async function listRuns(): Promise<RunSummary[]> {
  const res = await fetch(`${BASE_URL}/runs`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`agent-core responded ${res.status}`);
  return (await res.json()) as RunSummary[];
}

export async function getRun(runId: string): Promise<RunSummary | null> {
  const res = await fetch(`${BASE_URL}/runs/${runId}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`agent-core responded ${res.status}`);
  return (await res.json()) as RunSummary;
}
