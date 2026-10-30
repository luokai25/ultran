"use client";

import { useMemo, useState } from "react";

type HubModel = {
  id: string;
  downloads?: number;
  likes?: number;
  pipeline_tag?: string;
  tags?: string[];
  library_name?: string;
};

const PROVIDERS = [
  { id: "groq", name: "Groq", note: "Fast hosted inference", url: "https://console.groq.com/keys", plan: "free" },
  { id: "google-ai-studio", name: "Google AI Studio", note: "Gemini models", url: "https://aistudio.google.com/app/apikey", plan: "free" },
  { id: "openrouter", name: "OpenRouter", note: "Many model providers, one API", url: "https://openrouter.ai/keys", plan: "free" },
  { id: "together-ai", name: "Together AI", note: "Open model hosting", url: "https://api.together.ai/settings/api-keys", plan: "paid" },
  { id: "deepseek", name: "DeepSeek", note: "Reasoning and chat", url: "https://platform.deepseek.com/api_keys", plan: "free" },
  { id: "fireworks-ai", name: "Fireworks AI", note: "Hosted open models", url: "https://fireworks.ai/account/api-keys", plan: "paid" },
  { id: "cerebras", name: "Cerebras", note: "High-speed inference", url: "https://cloud.cerebras.ai/", plan: "free" },
  { id: "mistral-ai", name: "Mistral AI", note: "Mistral models", url: "https://console.mistral.ai/api-keys/", plan: "free" },
  { id: "cohere", name: "Cohere", note: "Command and embeddings", url: "https://dashboard.cohere.com/api-keys", plan: "free" },
  { id: "xai", name: "xAI", note: "Grok models", url: "https://console.x.ai/", plan: "paid" },
  { id: "openai", name: "OpenAI", note: "GPT models", url: "https://platform.openai.com/api-keys", plan: "paid" },
  { id: "anthropic", name: "Anthropic", note: "Claude models", url: "https://console.anthropic.com/settings/keys", plan: "paid" },
] as const;

const API = process.env.NEXT_PUBLIC_ULTRAN_API_URL ?? "http://127.0.0.1:8080/v1";

export default function ModelHub() {
  const [tab, setTab] = useState<"discover" | "providers" | "local">("discover");
  const [query, setQuery] = useState("Qwen GGUF");
  const [models, setModels] = useState<HubModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("qwen2.5:3b");
  const [selectedHubModel, setSelectedHubModel] = useState("");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["id"]>("groq");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [ollamaHost, setOllamaHost] = useState("http://127.0.0.1:11434");

  const chosen = useMemo(() => PROVIDERS.find((item) => item.id === provider)!, [provider]);

  async function searchModels(event?: React.FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ search: query.trim() || "GGUF", limit: "30", sort: "downloads", direction: "-1" });
      const response = await fetch(`https://huggingface.co/api/models?${params.toString()}`);
      if (!response.ok) throw new Error(`Model catalog returned ${response.status}`);
      const data = (await response.json()) as HubModel[];
      setModels(data.filter((model) => model.id && (model.library_name === "gguf" || model.tags?.some((tag) => tag.toLowerCase().includes("gguf")) || /gguf/i.test(model.id))).slice(0, 30));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the model catalog.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProviderKey(event: React.FormEvent) {
    event.preventDefault();
    if (key.trim().length < 8) { setNotice("Enter a valid API key first."); return; }
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/connectors/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connector_id: provider, api_key: key.trim(), plan: chosen.plan, label: "default" }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? body?.detail ?? `Connection failed (${response.status})`);
      }
      const result = await response.json();
      setKey("");
      setNotice(`${chosen.name} connected. Saved as ${result.masked_key}; the secret is not returned.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save this provider.");
    } finally {
      setSaving(false);
    }
  }

  const command = selected ? `ollama pull ${selected}` : "ollama pull qwen2.5:3b";

  return (
    <section className="ultran-model-hub" aria-label="AI model hub">
      <div className="ultran-model-heading">
        <div><span className="ultran-eyebrow">ULTRAN BRAIN</span><h2>Model Hub</h2><p>Find a model, run it locally, or connect a provider key.</p></div>
        <span className="ultran-model-count">12+ providers · live model search</span>
      </div>
      <div className="ultran-model-tabs" role="tablist" aria-label="Model hub sections">
        <button role="tab" aria-selected={tab === "discover"} onClick={() => setTab("discover")}>Discover models</button>
        <button role="tab" aria-selected={tab === "providers"} onClick={() => setTab("providers")}>API providers</button>
        <button role="tab" aria-selected={tab === "local"} onClick={() => setTab("local")}>On this device</button>
      </div>

      {tab === "discover" && <div className="ultran-model-panel">
        <form className="ultran-model-search" onSubmit={searchModels}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Qwen, Llama, Gemma, Phi…" aria-label="Search open models" />
          <button type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</button>
        </form>
        <p className="ultran-model-hint">Searches Hugging Face for downloadable GGUF models. Check each model card, license, quantization and hardware needs before downloading.</p>
        {error && <p className="ultran-model-error">{error}</p>}
        <div className="ultran-model-results">
          {models.map((model) => <article className="ultran-model-card" key={model.id}>
            <div><strong>{model.id}</strong><span>{model.pipeline_tag ?? "Text generation"} · {(model.downloads ?? 0).toLocaleString()} downloads · ♥ {model.likes ?? 0}</span></div>
            <button className="ultran-model-secondary" onClick={() => { setSelectedHubModel(model.id); setTab("local"); }}>Select</button>
            <a href={`https://huggingface.co/${model.id}`} target="_blank" rel="noreferrer">Model card ↗</a>
          </article>)}
          {!models.length && !loading && <div className="ultran-model-empty">Search hundreds of community models. Start with Qwen GGUF or Llama GGUF.</div>}
        </div>
      </div>}

      {tab === "providers" && <div className="ultran-model-panel">
        <div className="ultran-provider-grid">
          {PROVIDERS.map((item) => <button key={item.id} className={provider === item.id ? "ultran-provider-card active" : "ultran-provider-card"} onClick={() => { setProvider(item.id); setNotice(""); }}>
            <strong>{item.name}</strong><span>{item.note}</span><small>{item.plan === "free" ? "Free tier available" : "Usage may be paid"}</small>
          </button>)}
        </div>
        <form className="ultran-provider-form" onSubmit={saveProviderKey}>
          <div><strong>Connect {chosen.name}</strong><p>Get a key from the provider, then save it to Ultran's credential vault.</p></div>
          <a href={chosen.url} target="_blank" rel="noreferrer">Get API key ↗</a>
          <label htmlFor="ultran-provider-key">API key</label>
          <input id="ultran-provider-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste your API key" />
          <button type="submit" disabled={saving || key.trim().length < 8}>{saving ? "Saving securely…" : "Connect provider"}</button>
          {notice && <p role="status">{notice}</p>}
          <small>Keys are sent to your configured Ultran backend, never placed in browser storage. Use HTTPS for remote deployments.</small>
        </form>
      </div>}

      {tab === "local" && <div className="ultran-model-panel">
        <div className="ultran-local-feature"><strong>Run models locally with Ollama</strong><p>Download a quantized model once, then use it without a cloud API key. The device needs enough free RAM and storage.</p>{selectedHubModel && <p>Selected Hugging Face model: <strong>{selectedHubModel}</strong>. This is a model-card selection, not an Ollama tag. Check the card for a compatible GGUF file, or choose an Ollama model tag below.</p>}</div>
        <label className="ultran-model-label" htmlFor="ultran-model-id">Ollama model name or tag</label>
        <input id="ultran-model-id" value={selected} onChange={(event) => setSelected(event.target.value)} placeholder="qwen2.5:3b" />
        <label className="ultran-model-label" htmlFor="ultran-ollama-host">Ollama endpoint</label>
        <input id="ultran-ollama-host" value={ollamaHost} onChange={(event) => setOllamaHost(event.target.value)} />
        <div className="ultran-install-command"><code>{command}</code><button onClick={() => navigator.clipboard?.writeText(command)}>Copy command</button></div>
        <p className="ultran-model-hint">Run the command in the terminal on the machine hosting Ollama. For a phone, connect to an Ollama host on your trusted network; the browser cannot install model weights directly.</p>
        <div className="ultran-airllm-note"><strong>AirLLM integration note</strong><p><a href="https://github.com/lyogavin/airllm" target="_blank" rel="noreferrer">AirLLM ↗</a> is a Python layer-streaming inference library for GPU/desktop environments, not an Android model downloader or a phone-native runtime. Ultran can support it later as an optional remote/local-host backend; for mobile-native inference, prioritize GGUF with llama.cpp.</p></div>
        <a href={ollamaHost.replace(/\/$/, "") + "/api/tags"} target="_blank" rel="noreferrer">Check configured Ollama host ↗</a>
      </div>}
    </section>
  );
}
