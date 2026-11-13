import { createCohereSseParser } from "./cohere-sse";

/**
 * Direct device-to-provider adapters. Nothing here talks to an ULTRON server:
 * requests go straight to the provider the user chose, through a transport that
 * is native HTTP on Android and fetch in a development browser.
 */
export type DirectProviderId = "openrouter" | "mistral" | "cerebras" | "groq" | "cohere" | "google_ai_studio" | "github_models" | "huggingface" | "nvidia";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ProviderRequest = { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string };
/** `body` holds the response text for plain requests and the error text for failed streams; it is empty for a successful stream. */
export type ProviderResponse = { status: number; body: string; retryAfterMs: number | null };
export type ProviderTransport = {
  request(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
  /** Calls onChunk with raw response text only when the status is 2xx; a failed status returns its error text in `body`. */
  stream(req: ProviderRequest, onChunk: (text: string) => void, signal?: AbortSignal): Promise<ProviderResponse>;
};

type ProviderConfig = {
  label: string;
  modelsUrl: string;
  chatUrl: string;
  format: "openai" | "cohere";
  headers?: Record<string, string>;
  /** An authenticated call that proves the token is valid, for providers whose model list is public. */
  verifyUrl?: string;
  /** Client-side format check that rejects an obviously wrong key before it is sent anywhere. */
  keyPattern?: RegExp;
};

export const DIRECT_PROVIDERS: Record<DirectProviderId, ProviderConfig> = {
  openrouter: {
    label: "OpenRouter", format: "openai",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    headers: { "HTTP-Referer": "https://github.com/luokai25/ultran", "X-Title": "ULTRON" },
  },
  mistral: {
    label: "Mistral", format: "openai",
    modelsUrl: "https://api.mistral.ai/v1/models",
    chatUrl: "https://api.mistral.ai/v1/chat/completions",
  },
  cerebras: {
    label: "Cerebras", format: "openai",
    modelsUrl: "https://api.cerebras.ai/v1/models",
    chatUrl: "https://api.cerebras.ai/v1/chat/completions",
  },
  groq: {
    label: "Groq", format: "openai",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    chatUrl: "https://api.groq.com/openai/v1/chat/completions",
  },
  cohere: {
    label: "Cohere", format: "cohere",
    modelsUrl: "https://api.cohere.com/v2/models?endpoint=chat&limit=100",
    chatUrl: "https://api.cohere.com/v2/chat",
  },
  google_ai_studio: {
    label: "Google AI Studio", format: "openai",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    chatUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  },
  // GitHub Models: free, rate-limited inference for any GitHub account. The token needs the "models:read" permission.
  github_models: {
    label: "GitHub Models", format: "openai",
    verifyUrl: "https://api.github.com/user",
    modelsUrl: "https://models.github.ai/catalog/models",
    chatUrl: "https://models.github.ai/inference/chat/completions",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  },
  // Hugging Face Inference Providers: one OpenAI-compatible router; free signed-in quota. The public model list does not prove the token, so whoami-v2 does.
  huggingface: {
    label: "Hugging Face", format: "openai",
    verifyUrl: "https://huggingface.co/api/whoami-v2",
    modelsUrl: "https://router.huggingface.co/v1/models",
    chatUrl: "https://router.huggingface.co/v1/chat/completions",
    keyPattern: /^hf_[A-Za-z0-9]{16,}$/,
  },
  // NVIDIA NIM hosted catalog (build.nvidia.com): free developer credits, nvapi- keys.
  nvidia: {
    label: "NVIDIA NIM", format: "openai",
    modelsUrl: "https://integrate.api.nvidia.com/v1/models",
    chatUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    keyPattern: /^nvapi-[A-Za-z0-9_-]{16,}$/,
  },
};

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const NON_CHAT_MODEL = /embed|moderation|whisper|audio|tts|speech|transcri|live|realtime|bidi|image|rerank|classify/i;

/** Accepts OpenAI-style `{ data: [{ id }] }` and Cohere/Google-style `{ models: [{ name }] }` model lists. */
export function parseModelList(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { data?: unknown; models?: unknown };
  const rows = Array.isArray(payload) ? payload : Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  const ids = rows.flatMap((item): string[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; name?: unknown };
    const id = String(row.id ?? row.name ?? "").replace(/^models\//, "").trim();
    if (!id || id.length > 180 || NON_CHAT_MODEL.test(id)) return [];
    return [id];
  });
  return [...new Set(ids)].sort();
}

export function parseRetryAfterMs(value: string | null | undefined): number | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function extractProviderError(body: string): string {
  const text = body.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown };
    const error = parsed.error;
    const message = typeof error === "string" ? error
      : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message
      : typeof parsed.message === "string" ? parsed.message
      : typeof parsed.detail === "string" ? parsed.detail : "";
    if (message) return message.slice(0, 400);
  } catch { /* not JSON; fall through to the raw text */ }
  return text.slice(0, 400);
}

function failure(response: ProviderResponse): ProviderHttpError {
  return new ProviderHttpError(response.status, extractProviderError(response.body) || `HTTP ${response.status}`, response.retryAfterMs);
}

export function buildModelsRequest(provider: DirectProviderId, apiKey: string): ProviderRequest {
  const config = DIRECT_PROVIDERS[provider];
  return { url: config.modelsUrl, method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(config.headers ?? {}) } };
}

export type ChatParams = { model: string; messages: ChatMessage[]; maxTokens: number; temperature: number };

export function buildChatRequest(provider: DirectProviderId, apiKey: string, params: ChatParams): ProviderRequest {
  const config = DIRECT_PROVIDERS[provider];
  const maxTokens = Math.max(64, Math.min(16_384, Math.trunc(Number(params.maxTokens)) || 2048));
  const temperature = Math.max(0, Math.min(2, Number.isFinite(Number(params.temperature)) ? Number(params.temperature) : 0.3));
  return {
    url: config.chatUrl,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      ...(config.headers ?? {}),
    },
    body: JSON.stringify({ model: params.model, messages: params.messages, stream: true, max_tokens: maxTokens, temperature }),
  };
}

type OpenAiEvent = {
  choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown }; text?: unknown }>;
  error?: string | { message?: string };
  message?: string;
};

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("");
  return "";
}

/** Incremental decoder for an OpenAI-compatible SSE stream. Safe against chunk boundaries that split a line. */
export function createOpenAiSseDecoder(): { push(chunk: string, final?: boolean): string[] } {
  let buffer = "";
  const parseLine = (rawLine: string): string[] => {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line.startsWith("data:")) return []; // comments such as ": OPENROUTER PROCESSING" and blank lines
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return [];
    let event: OpenAiEvent;
    try { event = JSON.parse(raw) as OpenAiEvent; }
    catch { throw new Error("The provider sent an invalid event in the model stream."); }
    if (event.error) throw new Error(typeof event.error === "string" ? event.error : event.error.message ?? "Provider generation failed.");
    const choice = event.choices?.[0];
    const token = textOf(choice?.delta?.content) || textOf(choice?.message?.content) || textOf(choice?.text);
    return token ? [token] : [];
  };
  return {
    push(chunk: string, final = false): string[] {
      buffer += chunk;
      const tokens: string[] = [];
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        tokens.push(...parseLine(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (final && buffer.length) { tokens.push(...parseLine(buffer)); buffer = ""; }
      return tokens;
    },
  };
}

export function createChatStreamDecoder(provider: DirectProviderId): { push(chunk: string, final?: boolean): string[] } {
  return DIRECT_PROVIDERS[provider].format === "cohere" ? createCohereSseParser() : createOpenAiSseDecoder();
}

/** Verifies a key against the provider's own model endpoint and returns the chat-capable model ids. */
export async function verifyProviderKey(provider: DirectProviderId, apiKey: string, transport: ProviderTransport, signal?: AbortSignal): Promise<string[]> {
  const config = DIRECT_PROVIDERS[provider];
  if (config.keyPattern && !config.keyPattern.test(apiKey)) throw new ProviderHttpError(401, `This does not look like a ${config.label} key.`);
  const modelsRequest = buildModelsRequest(provider, apiKey);
  if (config.verifyUrl) {
    const proof = await transport.request({ ...modelsRequest, url: config.verifyUrl }, signal);
    if (proof.status < 200 || proof.status >= 300) throw failure(proof);
  }
  const response = await transport.request(modelsRequest, signal);
  if (response.status < 200 || response.status >= 300) throw failure(response);
  let payload: unknown;
  try { payload = JSON.parse(response.body); }
  catch { throw new ProviderHttpError(502, `${DIRECT_PROVIDERS[provider].label} returned an unreadable model list.`); }
  return parseModelList(payload);
}

/** Streams one chat completion straight from the provider. Returns the full text; throws ProviderHttpError for HTTP failures. */
export async function streamProviderChat(
  provider: DirectProviderId,
  apiKey: string,
  params: ChatParams,
  transport: ProviderTransport,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const decoder = createChatStreamDecoder(provider);
  let content = "";
  const emit = (tokens: string[]): void => { for (const token of tokens) { content += token; onToken(token); } };
  const response = await transport.stream(buildChatRequest(provider, apiKey, params), (chunk) => emit(decoder.push(chunk, false)), signal);
  if (response.status < 200 || response.status >= 300) throw failure(response);
  emit(decoder.push("", true));
  return content;
}
