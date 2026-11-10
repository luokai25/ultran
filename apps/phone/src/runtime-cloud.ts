import { ULTRON_SUPABASE_PUBLISHABLE_KEY, ULTRON_SUPABASE_URL } from "./cloud-sync";

export async function invokeUltronRuntime(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${ULTRON_SUPABASE_URL}/functions/v1/ultron-runtime`, {
    method: "POST",
    headers: { apikey: ULTRON_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, action }),
  });
  const raw = await response.text();
  let result: Record<string, unknown> = {};
  try { result = raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
  catch { throw new Error(`ULTRON cloud runtime returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok || result.error) throw new Error(String(result.message ?? result.error ?? `ULTRON cloud runtime returned HTTP ${response.status}.`));
  return result;
}
