import { cloudClient, getCloudSession } from "./cloud-sync";

export type UltronJobStatus = "queued" | "running" | "retry_wait" | "completed" | "failed" | "cancelled";
export type UltronJob = {
  id: string; job_type: string; title: string; payload?: Record<string, unknown>;
  priority: number; status: UltronJobStatus; run_after: string; attempts: number;
  max_attempts: number; lock_token?: string | null; lease_expires_at?: string | null;
  result?: Record<string, unknown> | null; error_message?: string | null;
  created_at: string; updated_at?: string; completed_at?: string | null;
};

export async function invokeUltronJobs(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const session = await getCloudSession();
  if (!session) throw new Error("Sign in with the ULTRON owner account before using cloud jobs.");
  const { data, error } = await cloudClient.functions.invoke("ultron-jobs", { body: { ...payload, action } });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("ULTRON job service returned an invalid response.");
  const result = data as Record<string, unknown>;
  if (result.error) throw new Error(String(result.message ?? result.error));
  if (result.ok !== true) throw new Error("ULTRON job service did not confirm the operation.");
  return result;
}

export async function enqueueUltronJob(input: { job_type: string; title: string; payload?: Record<string, unknown>; priority?: number; max_attempts?: number; run_after?: string; idempotency_key?: string; }): Promise<UltronJob> {
  return (await invokeUltronJobs("enqueue", input)).job as UltronJob;
}
export async function listUltronJobs(options: { status?: UltronJobStatus; limit?: number } = {}): Promise<UltronJob[]> {
  const result = await invokeUltronJobs("list", options);
  return Array.isArray(result.jobs) ? result.jobs as UltronJob[] : [];
}
export async function claimUltronJobs(options: { limit?: number; lease_seconds?: number } = {}): Promise<UltronJob[]> {
  const result = await invokeUltronJobs("claim", options);
  return Array.isArray(result.jobs) ? result.jobs as UltronJob[] : [];
}
export async function heartbeatUltronJob(job: UltronJob, lease_seconds = 90): Promise<UltronJob> {
  if (!job.id || !job.lock_token) throw new Error("A claimed job and its lease token are required.");
  return (await invokeUltronJobs("heartbeat", { id: job.id, lock_token: job.lock_token, lease_seconds })).job as UltronJob;
}
export async function completeUltronJob(job: UltronJob, result: Record<string, unknown> = {}): Promise<UltronJob> {
  if (!job.id || !job.lock_token) throw new Error("A claimed job and its lease token are required.");
  return (await invokeUltronJobs("complete", { id: job.id, lock_token: job.lock_token, result })).job as UltronJob;
}
export async function failUltronJob(job: UltronJob, error: unknown): Promise<UltronJob> {
  if (!job.id || !job.lock_token) throw new Error("A claimed job and its lease token are required.");
  return (await invokeUltronJobs("fail", { id: job.id, lock_token: job.lock_token, error: error instanceof Error ? error.message : String(error) })).job as UltronJob;
}
export async function cancelUltronJob(id: string): Promise<UltronJob> {
  return (await invokeUltronJobs("cancel", { id })).job as UltronJob;
}
