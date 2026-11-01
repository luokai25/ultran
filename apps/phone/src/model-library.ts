export type CuratedModel = {
  id: string; name: string; description: string; file: string; sizeLabel: string;
  sizeBytes: number; url: string; license: string; bestFor: string; minRamGb: number;
};

// Fixed, reviewed GGUF paths. No runtime repository search or guessed filenames.
export const CURATED_MODELS: readonly CuratedModel[] = [
  { id: "unsloth/gemma-3-1b-it-GGUF", name: "Gemma 3 · 1B", description: "Smallest option in this starter library. Useful for short chat and summaries.", file: "gemma-3-1b-it-Q4_K_M.gguf", sizeLabel: "806 MB", sizeBytes: 865704058, url: "https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf?download=true", license: "Gemma terms", bestFor: "Lowest storage", minRamGb: 4 },
  { id: "Qwen/Qwen2.5-1.5B-Instruct-GGUF", name: "Qwen 2.5 · 1.5B", description: "Balanced everyday assistant for conversation, summaries, writing and light coding.", file: "qwen2.5-1.5b-instruct-q4_k_m.gguf", sizeLabel: "1.12 GB", sizeBytes: 1202590843, url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true", license: "Apache-2.0", bestFor: "Recommended starter", minRamGb: 4 },
  { id: "bartowski/SmolLM2-1.7B-Instruct-GGUF", name: "SmolLM 2 · 1.7B", description: "Compact general assistant designed for efficient local inference.", file: "SmolLM2-1.7B-Instruct-Q4_K_M.gguf", sizeLabel: "1.06 GB", sizeBytes: 1138166333, url: "https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf?download=true", license: "Apache-2.0", bestFor: "Lightweight assistant", minRamGb: 4 },
  { id: "tensorblock/Qwen_Qwen3-1.7B-GGUF", name: "Qwen 3 · 1.7B", description: "Compact reasoning-oriented model. More capable on multi-step prompts, but can be slower.", file: "Qwen3-1.7B-Q4_K_M.gguf", sizeLabel: "1.28 GB", sizeBytes: 1374389535, url: "https://huggingface.co/tensorblock/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf?download=true", license: "Apache-2.0", bestFor: "Reasoning", minRamGb: 6 },
];
