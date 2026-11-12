export type EligibilityProvider = "openrouter" | "mistral" | "cerebras" | "groq" | "cohere" | "google_ai_studio";

export function freeModel(provider: EligibilityProvider, model: string): boolean {
  const id = model.toLowerCase();
  if (/(?:audio|tts|speech|transcri|live|realtime|bidi)/i.test(id)) return false;
  if (provider === "openrouter") return id.endsWith(":free");
  if (provider === "cerebras") return true;
  if (provider === "groq") return /allam.*2.*7b|llama.?3[.-]1.*8b|llama.?3[.-]3.*70b|llama.?4.*scout|groq\/compound|gpt-oss-(120|20)b|qwen3-32b/.test(id);
  if (provider === "mistral") return /^(mistral|codestral)[-_]/.test(id);
  if (provider === "cohere") return /c4ai-aya-expanse-32b|command-a-03-2025|command-a-reasoning-08-2025|command-r-08-2024|command-r-plus-08-2024|command-r7b-12-2024|command-r7b-arabic-02-2025/.test(id);
  if (provider === "google_ai_studio") return /^gemini-(?:2\.5-(?:flash|flash-lite)|3(?:\.[678])?-flash|3\.5-flash(?:-lite)?|3-flash-preview|3\.1-flash-lite)/.test(id);
  return false;
}

const NON_CHAT_MODEL = /(?:audio|tts|speech|transcri|live|realtime|bidi|embed|moderation|rerank|whisper|image)/i;

/**
 * Models a key may be used with in Automatic mode. Known free-tier models always win. For providers whose free
 * tier is attached to the key itself (everything except OpenRouter, where paid models bill per token), a key whose
 * model names we do not recognise still works: the provider decides what the key may call. This keeps a new model
 * name from silently turning a valid key into "no eligible model".
 */
export function automaticModels(provider: EligibilityProvider, models: string[], blocked: Record<string, string> | undefined): string[] {
  const now = Date.now();
  const usable = models.filter((id) => !NON_CHAT_MODEL.test(id) && Date.parse(blocked?.[id] ?? "1970-01-01") <= now);
  const known = usable.filter((id) => freeModel(provider, id));
  return known.length || provider === "openrouter" ? known : usable;
}

