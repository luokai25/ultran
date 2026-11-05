export type ProviderId = "openai" | "groq" | "openrouter" | "cerebras" | "fireworks" | "anthropic" | "gemini" | "unknown";
export type ProviderState = "connected" | "expired" | "invalid" | "incompatible" | "unreachable" | "missing";
export type ProviderProfile = { id: ProviderId; label: string; baseUrl: string; compatible: boolean };

const PROVIDERS: Record<Exclude<ProviderId, "unknown">, ProviderProfile> = {
  openai: { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", compatible: true },
  groq: { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", compatible: true },
  openrouter: { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", compatible: true },
  cerebras: { id: "cerebras", label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", compatible: true },
  fireworks: { id: "fireworks", label: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", compatible: true },
  anthropic: { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", compatible: false },
  gemini: { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", compatible: false },
};

export function detectProvider(apiKey: string): ProviderProfile {
  const key = apiKey.trim();
  if (/^sk-or-v1-[A-Za-z0-9_-]{16,}$/.test(key)) return PROVIDERS.openrouter;
  if (/^gsk_[A-Za-z0-9]{16,}$/.test(key)) return PROVIDERS.groq;
  if (/^csk-[A-Za-z0-9_-]{16,}$/.test(key)) return PROVIDERS.cerebras;
  if (/^fw_[A-Za-z0-9_-]{16,}$/.test(key)) return PROVIDERS.fireworks;
  if (/^sk-ant-[A-Za-z0-9_-]{16,}$/.test(key)) return PROVIDERS.anthropic;
  if (/^AIza[A-Za-z0-9_-]{20,}$/.test(key)) return PROVIDERS.gemini;
  if (/^sk-(?:proj-)?[A-Za-z0-9_-]{16,}$/.test(key)) return PROVIDERS.openai;
  return { id: "unknown", label: "Unknown provider", baseUrl: "", compatible: false };
}

export function classifyProviderResponse(status: number): ProviderState {
  if (status >= 200 && status < 300) return "connected";
  if (status === 401) return "invalid";
  if (status === 403) return "expired";
  if (status === 404 || status === 405 || status === 415 || status === 501) return "incompatible";
  return "unreachable";
}

export function selectChatModels(ids: string[]): string[] {
  const excluded = /embed|moderation|whisper|tts|speech|transcri|dall-e|image|realtime|search-preview/i;
  return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0 && id.length < 180 && !excluded.test(id)))].sort((a, b) => a.localeCompare(b));
}

export function providerStatusLabel(state: ProviderState): string {
  return ({
    connected: "Connected",
    expired: "Expired or access denied",
    invalid: "Not a valid API key",
    incompatible: "Ultron is not compatible with this key type yet",
    unreachable: "Could not verify this key",
    missing: "No API key saved",
  })[state];
}
