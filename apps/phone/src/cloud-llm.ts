import {
  getLocalProviderKeyCandidates,
  listLocalProviderKeys,
  removeLocalProviderKey,
  saveLocalProviderKey,
  updateLocalProviderKey,
  type LocalProviderId,
} from "./local-llm-vault";

export type CloudProviderId = LocalProviderId;
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

const API_PATH = "/api/ultron-brain";
const PROVIDERS: Record<CloudProviderId, string> = {
  openrouter: "OpenRouter",
  mistral: "Mistral",
  cerebras: "Cerebras",
  groq: "Groq",
  cohere: "Cohere",
  google_ai_studio: "Google AI Studio",
};
const SUPPORTED_ON_VERCEL = new Set<CloudProviderId>(["openrouter", "mistral", "cerebras", "groq", "cohere", "google_ai_studio"]);

async function invokeVercelBrain(payload: Record<string, unknown>): Promise<Response> {
  return fetch(API_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
}

function freeModel(provider: CloudProviderId, model: string): boolean {
  const id = model.toLowerCase();
  if (/(?:audio|tts|speech|transcri|live|realtime|bidi)/i.test(id)) return false;
  if (provider === "openrouter") return id.endsWith(":free");
  if (provider === "cerebras") return false;
  if (provider === "groq") return /allam.*2.*7b|llama.?3[.-]1.*8b|llama.?3[.-]3.*70b|llama.?4.*scout|groq\/compound|gpt-oss-(120|20)b|qwen3-32b/.test(id);
  if (provider === "mistral") return /^(mistral|codestral)[-_]/.test(id);
  if (provider === "cohere") return /c4ai-aya-expanse-32b|command-a-03-2025|command-a-reasoning-08-2025|command-r-08-2024|command-r-plus-08-2024|command-r7b-12-2024|command-r7b-arabic-02-2025/.test(id);
  if (provider === "google_ai_studio") return /^gemini-(?:2\.5-(?:flash|flash-lite)|3(?:\.[678])?-flash|3\.5-flash(?:-lite)?|3-flash-preview|3\.1-flash-lite)/.test(id);
  return false;
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let result: Record<string, unknown> = {};
  try { result = raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
  catch { throw new Error(`ULTRON Brain returned an invalid response (HTTP ${response.status}).`); }
  if (!response.ok) {
    const detail = String(result.message ?? result.error ?? result.msg ?? `ULTRON Brain returned HTTP ${response.status}.`);
    throw new Error(detail.slice(0, 500));
  }
  return result;
}

export async function listUltronCloudKeys(): Promise<{ providers: CloudProviderGroup[]; total_keys: number; connected_keys: number }> {
  const rows = await listLocalProviderKeys();
  const providers = (Object.keys(PROVIDERS) as CloudProviderId[]).map((provider) => {
    const keys: CloudKeyRow[] = rows.filter((row) => row.provider === provider).map((row) => ({
      id: row.id, label: row.label, status: row.status, enabled: row.enabled, priority: row.priority,
      models: row.models, free_model_count: row.models.filter((model) => freeModel(provider, model)).length,
      request_count: 0, tokens_used: 0, cooldown_until: null, last_used_at: null,
      last_checked_at: row.last_checked_at, last_error: row.last_error, created_at: row.created_at,
    }));
    return { id: provider, label: PROVIDERS[provider], key_count: keys.length, connected_count: keys.filter((key) => key.enabled && key.status === "connected").length, keys };
  });
  const all = providers.flatMap((provider) => provider.keys);
  return { providers, total_keys: all.length, connected_keys: all.filter((key) => key.enabled && key.status === "connected").length };
}

export async function addUltronCloudKey(provider: CloudProviderId, key: string, label: string): Promise<Record<string, unknown>> {
  if (!SUPPORTED_ON_VERCEL.has(provider)) {
    throw new Error(`${PROVIDERS[provider]} is not connected to the independent Vercel gateway yet.`);
  }
  const secret = key.trim();
  if (secret.length < 8) throw new Error("Enter a valid provider API key.");
  const response = await invokeVercelBrain({ action: "verify_key", provider, api_key: secret });
  const result = await parseJsonResponse(response);
  const models = Array.isArray(result.models) ? result.models.filter((value): value is string => typeof value === "string") : [];
  if (!models.length) throw new Error("The provider accepted the key but returned no compatible chat models.");
  const saved = await saveLocalProviderKey({
    provider, label: label.trim() || "API key", apiKey: secret, status: "connected",
    enabled: true, priority: 3, models, last_checked_at: new Date().toISOString(), last_error: null,
  });
  return { ok: true, duplicate: saved.duplicate, provider, key: saved.key, models_found: models.length, free_models_found: models.filter((model) => freeModel(provider, model)).length };
}

export async function removeUltronCloudKey(provider: CloudProviderId, id: string): Promise<void> {
  await removeLocalProviderKey(provider, id);
}

export async function setUltronCloudKey(provider: CloudProviderId, id: string, patch: { enabled?: boolean; priority?: number }): Promise<void> {
  await updateLocalProviderKey(provider, id, patch);
}

export async function getUltronCloudModels(): Promise<CloudModel[]> {
  const { providers } = await listUltronCloudKeys();
  return providers.flatMap((group) => group.keys.filter((key) => key.enabled && key.status === "connected")
    .flatMap((key) => key.models.map((model) => ({
      id: `${group.id}::${model}`, model_id: model, provider: group.id,
      provider_label: group.label, key_count: 1, status: "connected",
    }))));
}

export async function getUltronCloudStatus(): Promise<{ status: CloudBrainStatus; total_keys: number; connected_keys: number }> {
  const keys = await listUltronCloudKeys();
  return { status: { state: keys.connected_keys ? "ready" : "no_keys", connected_keys: keys.connected_keys, enabled_keys: keys.connected_keys }, total_keys: keys.total_keys, connected_keys: keys.connected_keys };
}

export async function getUltronFreeProviders(_refresh = false): Promise<CloudProviderRegistry | null> {
  return null;
}

const MAX_CLOUD_MESSAGE_CHARS = 22_000;
const MAX_CLOUD_TOTAL_CHARS = 90_000;

export function prepareCloudChatMessages(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const normalized = messages
    .filter((message) => ["system", "user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.trim())
    .map((message) => {
      const content = message.content.trim();
      if (content.length <= MAX_CLOUD_MESSAGE_CHARS) return { role: message.role, content };
      const marker = "\n\n[Earlier context shortened to fit ULTRON's request limits.]\n\n";
      const head = Math.floor((MAX_CLOUD_MESSAGE_CHARS - marker.length) * 0.72);
      const tail = MAX_CLOUD_MESSAGE_CHARS - marker.length - head;
      return { role: message.role, content: content.slice(0, head) + marker + content.slice(-tail) };
    });
  let total = normalized.reduce((sum, message) => sum + message.content.length, 0);
  while (total > MAX_CLOUD_TOTAL_CHARS && normalized.length > 2) {
    const lastIndex = normalized.length - 1;
    const removable = normalized.findIndex((message, index) => index > 0 && index < lastIndex && message.role === "assistant");
    const index = removable >= 0 ? removable : 1;
    const [removed] = normalized.splice(index, 1);
    total -= removed?.content.length ?? 0;
  }
  if (total > MAX_CLOUD_TOTAL_CHARS && normalized.length >= 2) {
    const system = normalized[0];
    const latest = normalized[normalized.length - 1];
    const systemBudget = Math.max(0, MAX_CLOUD_TOTAL_CHARS - (latest?.content.length ?? 0));
    if (system) system.content = system.content.slice(-systemBudget);
  }
  return normalized;
}

export async function streamUltronSupabaseChat(
  modelId: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens: number,
  signal: AbortSignal,
  onToken: (token: string | null) => void,
  provider?: CloudProviderId,
): Promise<string> {
  const separator = modelId.indexOf("::");
  const selectedProvider = provider ?? (separator > 0 ? modelId.slice(0, separator) as CloudProviderId : undefined);
  const selectedModel = separator > 0 ? modelId.slice(separator + 2) : modelId;
  if (!selectedProvider || !SUPPORTED_ON_VERCEL.has(selectedProvider)) {
    throw new Error("Choose a provider and model supported by the independent ULTRON Brain gateway.");
  }
  const candidates = await getLocalProviderKeyCandidates(selectedProvider, selectedModel);
  if (!candidates.length) throw new Error(`No active local ${PROVIDERS[selectedProvider]} key supports this model. Add or enable a key in LLM API Keys.`);
  const safeMessages = prepareCloudChatMessages(messages);
  if (!safeMessages.length || !safeMessages.some((message) => message.role === "user")) {
    throw new Error("ULTRON needs a non-empty user message before starting a cloud chat.");
  }

  let lastError: Error | null = null;
  for (const candidate of candidates) {
    if (signal.aborted) throw new DOMException("Generation stopped", "AbortError");
    let response: Response;
    try {
      response = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "chat", provider: selectedProvider, model_id: selectedModel,
          api_key: candidate.apiKey, messages: safeMessages, max_tokens: maxTokens, temperature: 0.3,
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error("ULTRON Brain could not reach the provider.");
      continue;
    }
    if (!response.ok) {
      const result: Record<string, unknown> = await parseJsonResponse(response).catch((error): Record<string, unknown> => ({ message: error instanceof Error ? error.message : "Provider request failed." }));
      const message = String(result.message ?? result.error ?? "Provider request failed.");
      lastError = new Error(`ULTRON Brain HTTP ${response.status}: ${message.slice(0, 400)}`);
      if (![401, 403, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
      continue;
    }
    if (!response.body) throw new Error("ULTRON Brain did not return a readable response stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const consume = (block: string): void => {
      const dataLines = block.split(/\r?\n/).filter((line) => line.startsWith("data:"));
      const data = dataLines.map((line) => line.slice(5).trim()).join("\n");
      const rawPayload = data || block.trim();
      if (!rawPayload || rawPayload === "[DONE]") return;
      if (!data && !rawPayload.startsWith("{") && !rawPayload.startsWith("[")) return;
      let event: { choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> }; message?: { content?: string | Array<{ text?: string }> }; text?: string }>; output_text?: string; response?: string; content?: string | Array<{ text?: string }>; error?: string | { message?: string }; message?: string };
      try { event = JSON.parse(rawPayload) as typeof event; }
      catch { throw new Error("ULTRON received an invalid event from the model stream."); }
      if (event.error) throw new Error(typeof event.error === "string" ? event.message ?? event.error : event.error.message ?? "Cloud model generation failed.");
      const choice = event.choices?.[0];
      const delta = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? event.output_text ?? event.response ?? event.content;
      const token = typeof delta === "string" ? delta : Array.isArray(delta) ? delta.map((part) => part.text ?? "").join("") : "";
      if (token) { content += token; onToken(token); }
    };
    try {
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
      if (!content.trim()) throw new Error("ULTRON Brain completed without returning any text.");
      return content.trim();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  throw lastError ?? new Error("No provider key could complete this request.");
}
