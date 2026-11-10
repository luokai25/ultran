import { ULTRON_SUPABASE_PUBLISHABLE_KEY, ULTRON_SUPABASE_URL } from "./cloud-sync";

export async function invokeUltronCapabilities(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${ULTRON_SUPABASE_URL}/functions/v1/ultron-capabilities`, {
    method: "POST",
    headers: { apikey: ULTRON_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, action }),
  });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
  catch { throw new Error(`ULTRON capabilities returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok || data.error || data.ok !== true) {
    throw new Error(String(data.message ?? data.error ?? `Capability request failed (HTTP ${response.status}).`));
  }
  return data;
}
