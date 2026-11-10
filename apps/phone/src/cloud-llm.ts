import {
  getLocalProviderKeyCandidates,
  listLocalProviderKeys,
  removeLocalProviderKey,
  recordLocalProviderKeyResult,
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

// Use the production Vercel endpoint from both the web app and Capacitor's https://localhost origin.
const API_PATH = import.meta.env.VITE_ULTRON_BRAIN_URL ?? "https://ultron-pied-gamma.vercel.app/api/ultron-brain";
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

function taskComplexity(messages: Array<{ role: string; content: string }>): number {
  const task = messages.filter((message) => message.role === "user").slice(-6).map((message) => message.content.slice(0, 24000)).join("\n").toLowerCase();
  let score = 0;
  if (/\b(build|implement|debug|refactor|architecture|research|compare|analy[sz]e|design|migrate|deploy|multi.step|step.by.step|investigate|prove|optimi[sz]e)\b/.test(task)) score += 2;
  if (/\b(code|typescript|javascript|python|sql|android|supabase|github|compiler|stack trace|test suite)\b/.test(task)) score += 2;
  if (/\b(reasoning|mathematical proof|derive|formal|algorithm|security review|large codebase)\b/.test(task)) score += 2;
  if (task.length > 5000) score += 1;
  if (messages.length > 5) score += 1;
  return Math.min(7, score);
}

function modelCapabilityScore(model: string, complexity: number): number {
  const id = model.toLowerCase();
  const params = Number(id.match(/(?:^|[-_.])(\d+(?:\.\d+)?)b(?:[-_.]|$)/)?.[1] ?? 0);
  let score = 100 + Math.min(160, params) * 5;
  if (/gpt-oss-120b/.test(id)) score += 1200;
  if (/llama-4-maverick/.test(id)) score += 1600;
  if (/command-a-/.test(id)) score += 1000;
  if (/llama-4-scout/.test(id)) score += 450;
  if (/llama-3\.3-70b|llama-3\.1-70b|qwen3-32b|command-r-plus/.test(id)) score += 180;
  if (/reason|r1|qwq|deepseek/.test(id) && complexity >= 3) score += 150;
  if (/coder|codestral|qwen.*coder|deepseek-coder/.test(id) && complexity >= 2) score += 180;
  if (/vision|vl|llava/.test(id) && complexity >= 2) score += 80;
  if (complexity <= 1) score -= params * 7;
  else score += params * Math.min(5, complexity) * 2;
  return score;
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
  const now = Date.now();
  const providers = (Object.keys(PROVIDERS) as CloudProviderId[]).map((provider) => {
    const keys: CloudKeyRow[] = rows.filter((row) => row.provider === provider).map((row) => ({
      id: row.id, label: row.label, status: row.status, enabled: row.enabled, priority: row.priority,
      models: row.models, free_model_count: row.models.filter((model) => freeModel(provider, model)).length,
      request_count: row.request_count, tokens_used: row.tokens_used, cooldown_until: row.cooldown_until, last_used_at: row.last_used_at,
      last_checked_at: row.last_checked_at, last_error: row.last_error, created_at: row.created_at,
    }));
    return { id: provider, label: PROVIDERS[provider], key_count: keys.length, connected_count: keys.filter((key) => key.enabled && (key.status === "connected" || key.status === "rate_limited") && (!key.cooldown_until || Date.parse(key.cooldown_until) <= now)).length, keys };
  });
  const all = providers.flatMap((provider) => provider.keys);
  return { providers, total_keys: all.length, connected_keys: all.filter((key) => key.enabled && (key.status === "connected" || key.status === "rate_limited") && (!key.cooldown_until || Date.parse(key.cooldown_until) <= now)).length };
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

export async function streamUltronBrainChat(
  modelId: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens: number,
  signal: AbortSignal,
  onToken: (token: string | null) => void,
  provider?: CloudProviderId,
): Promise<string> {
  const separator = modelId.indexOf("::");
  const qualifiedProvider = separator > 0 ? modelId.slice(0, separator) as CloudProviderId : undefined;
  const selectedProvider = provider ?? qualifiedProvider;
  const selectedModel = separator > 0 ? modelId.slice(separator + 2) : modelId;
  if (selectedProvider && !SUPPORTED_ON_VERCEL.has(selectedProvider)) {
    throw new Error("The selected provider is not supported by the independent ULTRON Brain gateway.");
  }
  const safeMessages = prepareCloudChatMessages(messages);
  if (!safeMessages.length || !safeMessages.some((message) => message.role === "user")) {
    throw new Error("ULTRON needs a non-empty user message before starting a cloud chat.");
  }
  const complexity = taskComplexity(safeMessages);
  const providers = selectedProvider ? [selectedProvider] : [...SUPPORTED_ON_VERCEL];
  const candidateGroups = await Promise.all(providers.map(async (candidateProvider) => {
    const keys = await getLocalProviderKeyCandidates(candidateProvider, selectedModel || undefined);
    return keys.flatMap((key) => {
      const model = selectedModel || key.models.filter((id) => freeModel(candidateProvider, id) &&
        Date.parse(key.blocked_models?.[id] ?? "1970-01-01") <= Date.now())
        .sort((a, b) => modelCapabilityScore(b, complexity) - modelCapabilityScore(a, complexity))[0] || "";
      if (!model || (!selectedModel && !freeModel(candidateProvider, model))) return [];
      return [{ provider: candidateProvider, key, model, score: modelCapabilityScore(model, complexity) }];
    });
  }));
  const candidates = candidateGroups.flat().sort((a, b) =>
    b.score - a.score || b.key.priority - a.key.priority ||
    Date.parse(a.key.last_used_at ?? "1970-01-01") - Date.parse(b.key.last_used_at ?? "1970-01-01"));
  if (!candidates.length) {
    throw new Error(selectedModel
      ? "No active local provider key supports the selected model. Add or enable a compatible key in LLM API Keys."
      : "No eligible free-tier chat model is available. Add a provider key or choose a local model.");
  }

  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const deadline = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("ULTRON Brain request timed out.", "TimeoutError"));
  }, 58_000);
  let lastError: Error | null = null;
  try {
    for (const candidate of candidates) {
      if (signal.aborted) throw new DOMException("Generation stopped", "AbortError");
      if (controller.signal.aborted) break;
      let response: Response;
      try {
        response = await fetch(API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
          cache: "no-store",
          body: JSON.stringify({
            action: "chat", provider: candidate.provider, model_id: candidate.model,
            api_key: candidate.key.apiKey, messages: safeMessages, max_tokens: maxTokens, temperature: 0.3,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (signal.aborted) throw new DOMException("Generation stopped", "AbortError");
        if (controller.signal.aborted) break;
        lastError = error instanceof Error ? error : new Error("ULTRON Brain could not reach the provider.");
        await recordLocalProviderKeyResult(candidate.provider, candidate.key.id, { outcome: "transient", error: lastError.message }).catch(() => undefined);
        continue;
      }
      if (!response.ok) {
        const result: Record<string, unknown> = await parseJsonResponse(response).catch((error): Record<string, unknown> => ({ message: error instanceof Error ? error.message : "Provider request failed." }));
        const message = String(result.message ?? result.error ?? "Provider request failed.");
        lastError = new Error(`ULTRON Brain HTTP ${response.status}: ${message.slice(0, 400)}`);
        const outcome = response.status === 401 ? "invalid"
          : response.status === 403 ? (/model|only available/i.test(message) ? "model_error" : "expired")
          : response.status === 404 ? "model_error"
          : response.status === 429 ? "rate_limited"
          : response.status >= 500 || response.status === 408 ? "transient" : null;
        if (outcome) {
          const retryHeader = response.headers.get("retry-after");
          const retryAfterMs = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader)
            ? Number(retryHeader) * 1000 : 900_000;
          await recordLocalProviderKeyResult(candidate.provider, candidate.key.id, {
            outcome, error: message, retryAfterMs, model: candidate.model,
          }).catch(() => undefined);
        }
        if (![401, 403, 404, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
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
          if (controller.signal.aborted) {
            if (timedOut) throw new Error("ULTRON Brain timed out after 58 seconds. Your message remains saved; retry or choose another provider.");
            throw new DOMException("Generation stopped", "AbortError");
          }
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
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (!content.trim()) throw new Error("ULTRON Brain completed without returning any text.");
      await recordLocalProviderKeyResult(candidate.provider, candidate.key.id, { outcome: "success", tokens: Math.max(1, Math.ceil(content.length / 4)) }).catch(() => undefined);
      return content.trim();
    }
    if (timedOut) throw new Error("ULTRON Brain timed out after 58 seconds. Your message remains saved; retry or choose another provider.");
    throw lastError ?? new Error("No provider key could complete this request.");
  } finally {
    window.clearTimeout(deadline);
    signal.removeEventListener("abort", abortFromCaller);
  }
}
