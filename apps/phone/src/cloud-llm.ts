import { RuntimeCache } from "./runtime-cache";
import { ProviderHttpError, streamProviderChat, verifyProviderKey } from "./provider-adapters";
import { defaultProviderTransport } from "./provider-transport";
import { automaticModels, freeModel } from "./model-eligibility";
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

const PROVIDERS: Record<CloudProviderId, string> = {
  openrouter: "OpenRouter",
  mistral: "Mistral",
  cerebras: "Cerebras",
  groq: "Groq",
  cohere: "Cohere",
  google_ai_studio: "Google AI Studio",
  github_models: "GitHub Models",
  huggingface: "Hugging Face",
  nvidia: "NVIDIA NIM",
};
const SUPPORTED_PROVIDERS = new Set<CloudProviderId>(Object.keys(PROVIDERS) as CloudProviderId[]);
const cloudModelCache = new RuntimeCache<CloudModel[]>(16, 500_000);
const CLOUD_MODEL_CACHE_TTL_MS = 15_000;


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

const REQUEST_DEADLINE_MS = 180_000;
const DEADLINE_MESSAGE = "The provider did not finish within 3 minutes. Your message remains saved; retry or choose another provider.";

function describeKeyFailure(provider: CloudProviderId, error: unknown): string {
  const label = PROVIDERS[provider];
  if (error instanceof ProviderHttpError) {
    const detail = error.message && !/^HTTP \d+$/.test(error.message) ? ` ${error.message}` : "";
    if (error.status === 401) return `${label} rejected this API key (HTTP 401).${detail}`;
    if (error.status === 403) return `${label} denied access for this API key (HTTP 403).${detail}`;
    if (error.status === 429) return `${label} is rate limiting this key right now (HTTP 429). Try again shortly.`;
    if (error.status >= 500) return `${label} is temporarily unavailable (HTTP ${error.status}). Try again shortly.`;
    return `${label} could not verify this key (HTTP ${error.status}).${detail}`;
  }
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) return `${label} did not answer within 15 seconds. Check the connection and try again.`;
  return `Could not reach ${label} from this device${error instanceof Error && error.message ? `: ${error.message.slice(0, 160)}` : "."}`;
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
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`${PROVIDERS[provider]} is not a supported provider.`);
  }
  const secret = key.trim();
  if (secret.length < 8) throw new Error("Enter a valid provider API key.");
  let models: string[];
  try { models = await verifyProviderKey(provider, secret, defaultProviderTransport(), AbortSignal.timeout(15_000)); }
  catch (error) { throw new Error(describeKeyFailure(provider, error)); }
  if (!models.length) throw new Error("The provider accepted the key but returned no compatible chat models.");
  const saved = await saveLocalProviderKey({
    provider, label: label.trim() || "API key", apiKey: secret, status: "connected",
    enabled: true, priority: 3, models, last_checked_at: new Date().toISOString(), last_error: null,
  });
  cloudModelCache.clear();
  return { ok: true, duplicate: saved.duplicate, provider, key: saved.key, models_found: models.length, free_models_found: models.filter((model) => freeModel(provider, model)).length };
}

export async function removeUltronCloudKey(provider: CloudProviderId, id: string): Promise<void> {
  await removeLocalProviderKey(provider, id);
  cloudModelCache.clear();
}

export async function setUltronCloudKey(provider: CloudProviderId, id: string, patch: { enabled?: boolean; priority?: number }): Promise<void> {
  await updateLocalProviderKey(provider, id, patch);
  cloudModelCache.clear();
}

export async function getUltronCloudModels(): Promise<CloudModel[]> {
  const cached = cloudModelCache.get("available-models");
  if (cached) return cached.map((model) => ({ ...model }));
  const { providers } = await listUltronCloudKeys();
  const models = providers.flatMap((group) => group.keys.filter((key) => key.enabled && key.status === "connected")
    .flatMap((key) => key.models.map((model) => ({
      id: `${group.id}::${model}`, model_id: model, provider: group.id,
      provider_label: group.label, key_count: 1, status: "connected",
    }))));
  cloudModelCache.set("available-models", models, CLOUD_MODEL_CACHE_TTL_MS);
  return models.map((model) => ({ ...model }));
}

export async function getUltronCloudStatus(): Promise<{ status: CloudBrainStatus; total_keys: number; connected_keys: number }> {
  const keys = await listUltronCloudKeys();
  return { status: { state: keys.connected_keys ? "ready" : "no_keys", connected_keys: keys.connected_keys, enabled_keys: keys.connected_keys }, total_keys: keys.total_keys, connected_keys: keys.connected_keys };
}

/** Built-in directory of the free-tier providers ULTRON can call directly. It is compiled into the app, not fetched. */
export async function getUltronFreeProviders(_refresh = false): Promise<CloudProviderRegistry | null> {
  return {
    source: "Built in; researched from cheahjs/free-llm-api-resources, GitHub Models and Hugging Face Inference Providers documentation",
    synced_at: "2026-11-13T00:00:00Z",
    providers: [
      { name: "OpenRouter (:free models)", url: "https://openrouter.ai/settings/keys" },
      { name: "Google AI Studio (Gemini free tier)", url: "https://aistudio.google.com/apikey" },
      { name: "Groq", url: "https://console.groq.com/keys" },
      { name: "GitHub Models", url: "https://github.com/settings/personal-access-tokens/new" },
      { name: "Hugging Face Inference Providers", url: "https://huggingface.co/settings/tokens/new?tokenType=fineGrained" },
      { name: "NVIDIA NIM", url: "https://build.nvidia.com/settings/api-keys" },
      { name: "Mistral (free plan)", url: "https://console.mistral.ai/api-keys/" },
      { name: "Cohere (trial key)", url: "https://dashboard.cohere.com/api-keys" },
      { name: "Cerebras (stored; not auto-routed)", url: "https://cloud.cerebras.ai" },
    ],
  };
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
  if (selectedProvider && !SUPPORTED_PROVIDERS.has(selectedProvider)) {
    throw new Error("The selected provider is not supported by ULTRON.");
  }
  const safeMessages = prepareCloudChatMessages(messages);
  if (!safeMessages.length || !safeMessages.some((message) => message.role === "user")) {
    throw new Error("ULTRON needs a non-empty user message before starting a cloud chat.");
  }
  const complexity = taskComplexity(safeMessages);
  const providers = selectedProvider ? [selectedProvider] : [...SUPPORTED_PROVIDERS];
  const keyCounts = { connected: 0, models: 0 };
  const ineligible = new Set<string>();
  const candidateGroups = await Promise.all(providers.map(async (candidateProvider) => {
    const keys = await getLocalProviderKeyCandidates(candidateProvider, selectedModel || undefined);
    keyCounts.connected += keys.length;
    return keys.flatMap((key) => {
      const models = selectedModel ? [selectedModel] : automaticModels(candidateProvider, key.models, key.blocked_models)
        .sort((x, y) => modelCapabilityScore(y, complexity) - modelCapabilityScore(x, complexity)).slice(0, 3);
      keyCounts.models += models.length;
      if (!selectedModel && !models.length) ineligible.add(PROVIDERS[candidateProvider]);
      return models.map((model) => ({ provider: candidateProvider, key, model, score: modelCapabilityScore(model, complexity) + (freeModel(candidateProvider, model) ? 5000 : 0) }));
    });
  }));
  const candidates = candidateGroups.flat().sort((a, b) =>
    b.score - a.score || b.key.priority - a.key.priority ||
    Date.parse(a.key.last_used_at ?? "1970-01-01") - Date.parse(b.key.last_used_at ?? "1970-01-01"));
  if (!candidates.length) {
    throw new Error(selectedModel
      ? "No active local provider key supports the selected model. Add or enable a compatible key in LLM API Keys."
      : keyCounts.connected === 0
        ? "No working provider key is available. Add a key in LLM API Keys (a rate-limited key becomes usable again after its cooldown), or choose a local model."
        : `${[...ineligible].join(" and ")} ${ineligible.size > 1 ? "keys are" : "key is"} saved, but none of ${ineligible.size > 1 ? "their" : "its"} models are on ULTRON's free-tier list, so Automatic skips ${ineligible.size > 1 ? "them" : "it"} to avoid charges. Pick a model by hand in the model picker, or add a key for another free provider.`);
  }
  const skippedKeys = new Set<string>();

  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const deadline = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Provider request timed out.", "TimeoutError"));
  }, REQUEST_DEADLINE_MS);
  const transport = defaultProviderTransport();
  let lastError: Error | null = null;
  try {
    for (const candidate of candidates) {
      if (signal.aborted) throw new DOMException("Generation stopped", "AbortError");
      if (controller.signal.aborted) break;
      if (skippedKeys.has(candidate.key.id)) continue;
      let emitted = false;
      let content = "";
      try {
        content = await streamProviderChat(
          candidate.provider, candidate.key.apiKey,
          { model: candidate.model, messages: safeMessages, maxTokens, temperature: 0.3 },
          transport, (token) => { emitted = true; onToken(token); }, controller.signal,
        );
      } catch (error) {
        if (signal.aborted) throw new DOMException("Generation stopped", "AbortError");
        if (controller.signal.aborted) break;
        if (error instanceof ProviderHttpError) {
          const message = error.message;
          lastError = new Error(`${PROVIDERS[candidate.provider]} HTTP ${error.status}: ${message.slice(0, 400)}`);
          const status = error.status;
          const outcome = status === 401 ? "invalid"
            : status === 403 ? (/model|only available/i.test(message) ? "model_error" : "expired")
            : status === 404 ? "model_error"
            : status === 429 ? "rate_limited"
            : status >= 500 || status === 408 ? "transient" : null;
          if (outcome) {
            await recordLocalProviderKeyResult(candidate.provider, candidate.key.id, {
              outcome, error: message, retryAfterMs: error.retryAfterMs ?? 900_000, model: candidate.model,
            }).catch(() => undefined);
          }
          if (outcome === "invalid" || outcome === "expired" || outcome === "rate_limited") skippedKeys.add(candidate.key.id);
          if (![401, 403, 404, 429, 500, 502, 503, 504].includes(status)) throw lastError;
          continue;
        }
        const failed = error instanceof Error ? error : new Error("The provider request failed.");
        // Never splice another provider's answer into text the user has already seen.
        if (emitted) throw failed;
        lastError = failed;
        await recordLocalProviderKeyResult(candidate.provider, candidate.key.id, { outcome: "transient", error: failed.message }).catch(() => undefined);
        continue;
      }
      if (!content.trim()) throw new Error("The provider completed without returning any text.");
      await recordLocalProviderKeyResult(candidate.provider, candidate.key.id, { outcome: "success", tokens: Math.max(1, Math.ceil(content.length / 4)) }).catch(() => undefined);
      return content.trim();
    }
    if (timedOut) throw new Error(DEADLINE_MESSAGE);
    throw lastError ?? new Error("No provider key could complete this request.");
  } finally {
    window.clearTimeout(deadline);
    signal.removeEventListener("abort", abortFromCaller);
  }
}
