export type EligibilityProvider = "openrouter" | "mistral" | "cerebras" | "groq" | "cohere" | "google_ai_studio" | "github_models" | "huggingface" | "nvidia";

export function freeModel(provider: EligibilityProvider, model: string): boolean {
  const id = model.toLowerCase();
  if (/(?:audio|tts|speech|transcri|live|realtime|bidi)/i.test(id)) return false;
  if (provider === "openrouter") return id.endsWith(":free");
  // GitHub Models: free and rate-limited for every GitHub account. Reasoning families have stricter limits and different parameters.
  if (provider === "github_models") return !/(?:^|\/)(?:o1|o3|o4|gpt-5)/i.test(id);
  // Hugging Face: free signed-in quota across the router; stay on well-known open families.
  if (provider === "huggingface") return /(?:llama-3\.[13]|qwen3|qwen2\.5|gpt-oss|gemma|deepseek|mistral|phi-)/i.test(id);
  // NVIDIA NIM: the hosted catalog is free with developer credits.
  if (provider === "nvidia") return true;
  if (provider === "cerebras") return false; // trial credits need a verified payment method and expire, so not zero-cost
  if (provider === "groq") return /allam.*2.*7b|llama.?3[.-]1.*8b|llama.?3[.-]3.*70b|llama.?4.*scout|groq\/compound|gpt-oss-(120|20)b|qwen3-32b/.test(id);
  if (provider === "mistral") return /^(?:mistral|codestral|ministral|pixtral|magistral|devstral|open-mi[sx]tral)[-_]/.test(id);
  if (provider === "cohere") return /c4ai-aya-expanse-32b|command-a-03-2025|command-a-reasoning-08-2025|command-r-08-2024|command-r-plus-08-2024|command-r7b-12-2024|command-r7b-arabic-02-2025/.test(id);
  if (provider === "google_ai_studio") return /^gemini-(?:2\.5-(?:flash|flash-lite)|3(?:\.[678])?-flash|3\.5-flash(?:-lite)?|3-flash-preview|3\.1-flash-lite)/.test(id);
  return false;
}

const NON_CHAT_MODEL = /(?:audio|tts|speech|transcri|live|realtime|bidi|embed|moderation|rerank|whisper|image|guard|safety|reward|retriev|ocr|clip|translat|parse)/i;

/**
 * Models a key may be used with in Automatic mode. Project rule: Automatic only ever routes to models that the
 * free-tier policy marks eligible, never to a paid model because it is stronger. A model the user picks by hand is
 * not filtered here.
 */
export function automaticModels(provider: EligibilityProvider, models: string[], blocked: Record<string, string> | undefined): string[] {
  const now = Date.now();
  return models.filter((id) => !NON_CHAT_MODEL.test(id) && freeModel(provider, id) && Date.parse(blocked?.[id] ?? "1970-01-01") <= now);
}
