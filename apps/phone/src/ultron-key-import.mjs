const PROVIDERS = ["openrouter", "mistral", "cerebras", "groq", "cohere", "google_ai_studio", "github_models", "huggingface", "nvidia"];

export function providerFromKeyFilename(filename) {
  const normalized = filename.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (normalized.includes("openrouter") || normalized.includes("open_router")) return "openrouter";
  if (normalized.includes("google") || normalized.includes("gemini") || normalized.includes("aistudio") || normalized.includes("ai_studio")) return "google_ai_studio";
  if (normalized.includes("github")) return "github_models";
  if (normalized.includes("hugging") || normalized.includes("hf_")) return "huggingface";
  if (normalized.includes("nvidia") || normalized.includes("nim")) return "nvidia";
  return PROVIDERS.find((provider) => provider !== "openrouter" && normalized.includes(provider)) ?? null;
}

/** Parse plain keys, KEY=value entries, and labelled "label: key" lines without logging or persisting values. */
export function parseProviderKeyFile(contents) {
  const keys = new Set();
  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue;
    const assignment = line.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
    const labelled = line.match(/^[A-Za-z][A-Za-z0-9 _.-]{0,80}:\s*(\S+)\s*$/);
    if (assignment) line = assignment[1].trim();
    else if (labelled) line = labelled[1].trim();
    if ((line.startsWith('"') && line.endsWith('"')) || (line.startsWith("'") && line.endsWith("'"))) line = line.slice(1, -1).trim();
    if (line.length >= 8 && !/\s/.test(line) && !/[<>]/.test(line)) keys.add(line);
  }
  return [...keys];
}


/** Validate a batch of provider-specific text files before reading any contents. */
export function validateProviderKeyFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return "Choose at least one provider .txt file.";
  if (files.length > 6) return "Select no more than six provider files at a time.";
  if (files.some((file) => !String(file.name ?? "").toLowerCase().endsWith(".txt"))) return "Only .txt provider files are supported.";
  if (files.some((file) => !Number.isFinite(file.size) || file.size < 0 || file.size > 1024 * 1024)) return "Each provider file must be no larger than 1 MB.";
  return null;
}
