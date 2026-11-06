import { cloudClient, getCloudSession, ULTRON_SUPABASE_PUBLISHABLE_KEY, ULTRON_SUPABASE_URL } from "./cloud-sync";

export type CloudProviderId = "openrouter" | "mistral" | "cerebras" | "groq" | "cohere" | "google_ai_studio";
export type CloudKeyRow = {
  id: string; label: string; status: string; enabled: boolean; priority: number;
  models: string[]; free_model_count: number; request_count: number; tokens_used: number;
  cooldown_until: string | null; last_used_at: string | null;
  last_checked_at: string | null; last_error: string | null; created_at: string;
};
export type CloudProviderGroup = { id: CloudProviderId; label: string; key_count: number; connected_count: number; keys: CloudKeyRow[] };
export type CloudModel = { id: string; model_id: string; provider: CloudProviderId; provider_label: string; key_count: number; status: string };
export type CloudBrainStatus = { state: string; connected_keys?: number; enabled_keys?: number; last_worker_at?: string; registry_providers?: number; registry_synced_at?: string };
export type CloudProviderRegistry = { source: string; synced_at: string; providers: Array<{ name: string; url: string }> };

function cloudFunctionError(error: unknown): { status: number; message: string } {
  const candidate = error as { message?: string; context?: unknown };
  if (candidate.context instanceof Response) {
    const response = candidate.context;
    return { status: response.status, message: `Supabase function HTTP ${response.status}` };
  }
  return { status: 0, message: candidate.message ?? "Supabase function request failed." };
}

export async function invokeUltronBrain(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  let session = await getCloudSession();
  if (!session) throw new Error("Sign in with the ULTRON owner account before using the cloud brain.");
  let attempt = 0;
  while (true) {
    const { data, error } = await cloudClient.functions.invoke("ultron-brain", { body: { ...payload, action } });
    if (!error) {
      if (!data || typeof data !== "object") throw new Error("ULTRON cloud brain returned an invalid response.");
      const result = data as Record<string, unknown>;
      if (result.error) throw new Error(String(result.message ?? result.error));
      return result;
    }
    const detail = cloudFunctionError(error);
    if (attempt === 0 && detail.status === 401) {
      const { data: refreshed, error: refreshError } = await cloudClient.auth.refreshSession();
      if (refreshError || !refreshed.session) throw new Error("Your ULTRON cloud session expired. Reconnect the owner account in Settings.");
      session = refreshed.session;
      attempt += 1;
      continue;
    }
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const body = await context.clone().json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(String(body.message ?? body.error ?? error.message));
    }
    throw error;
  }
}

export async function listUltronCloudKeys(): Promise<{ providers: CloudProviderGroup[]; total_keys: number; connected_keys: number }> {
  return await invokeUltronBrain("list_keys") as unknown as { providers: CloudProviderGroup[]; total_keys: number; connected_keys: number };
}

export async function addUltronCloudKey(provider: CloudProviderId, key: string, label: string): Promise<Record<string, unknown>> {
  return invokeUltronBrain("add_key", { provider, key, label });
}

export async function removeUltronCloudKey(provider: CloudProviderId, id: string): Promise<void> {
  await invokeUltronBrain("remove_key", { provider, id });
}

export async function setUltronCloudKey(provider: CloudProviderId, id: string, patch: { enabled?: boolean; priority?: number }): Promise<void> {
  await invokeUltronBrain("set_key", { provider, id, ...patch });
}

export async function getUltronCloudModels(): Promise<CloudModel[]> {
  const result = await invokeUltronBrain("catalog");
  return Array.isArray(result.models) ? result.models as CloudModel[] : [];
}

export async function getUltronCloudStatus(): Promise<{ status: CloudBrainStatus; total_keys: number; connected_keys: number }> {
  return await invokeUltronBrain("status") as unknown as { status: CloudBrainStatus; total_keys: number; connected_keys: number };
}

export async function getUltronFreeProviders(refresh = false): Promise<CloudProviderRegistry | null> {
  const result = await invokeUltronBrain("free_providers", { refresh });
  return result.registry && typeof result.registry === "object" ? result.registry as CloudProviderRegistry : null;
}

export async function streamUltronSupabaseChat(
  modelId: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens: number,
  signal: AbortSignal,
  onToken: (token: string | null) => void,
  provider?: CloudProviderId,
): Promise<string> {
  let session = await getCloudSession();
  if (!session) throw new Error("Sign in to ULTRON Supabase before starting a cloud chat.");
  const requestBody = JSON.stringify({ action: "chat", model_id: modelId, provider, messages, max_tokens: maxTokens, temperature: 0.3 });
  const send = (accessToken: string) => fetch(`${ULTRON_SUPABASE_URL}/functions/v1/ultron-brain`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ULTRON_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: requestBody,
    signal,
  });
  let response = await send(session.access_token);
  if (response.status === 401 && !signal.aborted) {
    const { data: refreshed, error: refreshError } = await cloudClient.auth.refreshSession();
    if (!refreshError && refreshed.session) {
      session = refreshed.session;
      response = await send(session.access_token);
    }
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail.slice(0, 500);
    try { const parsed = JSON.parse(detail) as Record<string, unknown>; message = String(parsed.message ?? parsed.error ?? message); } catch { /* provider or gateway returned plain text */ }
    throw new Error(`ULTRON Supabase returned HTTP ${response.status}: ${message}`);
  }
  if (!response.body) throw new Error("ULTRON Supabase did not return a readable response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const consume = (block: string): void => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }>; error?: string | { message?: string }; message?: string };
      if (event.error) throw new Error(typeof event.error === "string" ? event.message ?? event.error : event.error.message ?? "Cloud model generation failed.");
      const delta = event.choices?.[0]?.delta?.content;
      const token = typeof delta === "string" ? delta : Array.isArray(delta) ? delta.map((part) => part.text ?? "").join("") : "";
      if (token) { content += token; onToken(token); }
    }
  };
  while (true) {
    if (signal.aborted) throw new DOMException("Generation stopped", "AbortError");
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
      boundary = buffer.search(/\r?\n\r?\n/);
    }
    if (chunk.done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!content.trim()) throw new Error("ULTRON Supabase completed without returning any text.");
  return content.trim();
}
