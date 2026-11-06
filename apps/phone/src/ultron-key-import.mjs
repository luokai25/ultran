const PROVIDERS = ["openrouter", "mistral", "cerebras", "groq", "cohere"];

export function providerFromKeyFilename(filename) {
  const normalized = filename.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (normalized.includes("openrouter") || normalized.includes("open_router")) return "openrouter";
  return PROVIDERS.find((provider) => provider !== "openrouter" && normalized.includes(provider)) ?? null;
}

/** Parse one secret per line. Supports plain keys and KEY=value files without logging or persisting values. */
export function parseProviderKeyFile(contents) {
  const keys = new Set();
  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue;
    const assignment = line.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
    if (assignment) line = assignment[1].trim();
    if ((line.startsWith('"') && line.endsWith('"')) || (line.startsWith("'") && line.endsWith("'"))) line = line.slice(1, -1).trim();
    if (line.length >= 8 && !/\s/.test(line) && !/[<>]/.test(line)) keys.add(line);
  }
  return [...keys];
}
