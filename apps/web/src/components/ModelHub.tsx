"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type HubModel = { id: string; downloads?: number; likes?: number; pipeline_tag?: string; tags?: string[]; library_name?: string };
type Provider = { id: string; name: string; note: string; url: string };
const PROVIDERS: Provider[] = [
  { id: "openrouter", name: "OpenRouter", note: "Many models, one key", url: "https://openrouter.ai/keys" },
  { id: "groq", name: "Groq", note: "Fast inference", url: "https://console.groq.com/keys" },
  { id: "google_ai_studio", name: "Google AI Studio", note: "Gemini models", url: "https://aistudio.google.com/app/apikey" },
  { id: "mistral", name: "Mistral", note: "Mistral models", url: "https://console.mistral.ai/api-keys/" },
  { id: "cerebras", name: "Cerebras", note: "High-speed inference", url: "https://cloud.cerebras.ai/" },
  { id: "cohere", name: "Cohere", note: "Command models", url: "https://dashboard.cohere.com/api-keys" },
];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://vshoxrtrfleptqxkrmtc.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_OuRYpP7YP76xv4mfUgd_ng_NF4nWVoV";
function detectProvider(value: string): Provider | undefined {
  const key = value.trim();
  if (/^sk-or-v1-/i.test(key)) return PROVIDERS[0];
  if (/^gsk_/i.test(key)) return PROVIDERS[1];
  if (/^(AQ\.|AIza)/i.test(key)) return PROVIDERS[2];
  if (/^csk-/i.test(key)) return PROVIDERS[4];
  return undefined;
}
function getSupabase(): SupabaseClient | null {
  return SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
}

export default function ModelHub() {
  const supabase = useMemo(() => getSupabase(), []);
  const [tab, setTab] = useState<"discover" | "settings" | "local">("discover");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState(false);
  const [activeProvider, setActiveProvider] = useState("openrouter");
  const [activeModel, setActiveModel] = useState("");
  const [catalog, setCatalog] = useState<Array<{ id: string; model_id: string; provider: string; provider_label: string }>>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [pasteReady, setPasteReady] = useState(false);
  const [keyNotice, setKeyNotice] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [connected, setConnected] = useState<string[]>([]);
  const [query, setQuery] = useState("Qwen GGUF");
  const [models, setModels] = useState<HubModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("qwen2.5:3b");
  const [selectedHubModel, setSelectedHubModel] = useState("");
  const [ollamaHost, setOllamaHost] = useState("http://127.0.0.1:11434");

  async function invoke(action: string, extra: Record<string, unknown> = {}) {
    if (!supabase) throw new Error("Supabase web configuration is missing. Add NEXT_PUBLIC_SUPABASE_ANON_KEY to the web deployment.");
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("Sign in to the ULTRON owner account first.");
    const { data, error } = await supabase.functions.invoke("ultron-brain", { body: { action, ...extra } });
    if (error) {
      const context = (error as { context?: { json?: () => Promise<Record<string, unknown>> } }).context;
      const detail = await context?.json?.().catch(() => undefined);
      throw new Error(String(detail?.message ?? detail?.error ?? error.message));
    }
    if (data?.error) throw new Error(String(data.message ?? data.error));
    return data;
  }

  async function refreshCatalog() {
    try {
      const [result, keys] = await Promise.all([invoke("catalog"), invoke("list_keys")]);
      setCatalog(result.models ?? []);
      setConnected((keys.providers ?? []).filter((p: { connected_count: number }) => p.connected_count > 0).map((p: { id: string }) => p.id));
    } catch { /* The picker remains usable and shows sign-in/configuration state in Settings. */ }
  }

  useEffect(() => {
    if (!supabase) { setSessionReady(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      setSessionReady(true);
      if (data.session) void refreshCatalog();
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      if (session) window.setTimeout(() => { void refreshCatalog(); }, 0);
      else { setCatalog([]); setConnected([]); }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  async function signIn(event: FormEvent) {
    event.preventDefault(); setAuthNotice("");
    if (!supabase) { setAuthNotice("Supabase public configuration is missing."); return; }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setAuthNotice(error ? error.message : "Signed in.");
  }

  async function saveKey(event?: FormEvent) {
    event?.preventDefault();
    const detected = detectProvider(apiKey);
    if (!detected) { setKeyNotice("Provider not recognized. Paste an OpenRouter, Groq, or Google AI Studio key."); return; }
    if (savingKey) return;
    setPasteReady(false);
    setSavingKey(true); setKeyNotice("");
    try {
      const result = await invoke("add_key", { provider: detected.id, key: apiKey.trim(), label: detected.name });
      setApiKey("");
      setKeyNotice(result.duplicate ? `${detected.name} key already exists and is active.` : `${detected.name} accepted and securely saved.`);
      await refreshCatalog();
    } catch (err) {
      setKeyNotice(err instanceof Error ? err.message : "Key could not be saved.");
    } finally { setSavingKey(false); }
  }

  useEffect(() => {
    if (!pasteReady || !signedIn || !detectProvider(apiKey) || savingKey) return;
    const timer = window.setTimeout(() => { void saveKey(); }, 350);
    return () => window.clearTimeout(timer);
  }, [pasteReady, apiKey, signedIn, savingKey]);

  async function searchModels(event?: FormEvent) {
    event?.preventDefault(); setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ search: query.trim() || "GGUF", limit: "30", sort: "downloads", direction: "-1" });
      const response = await fetch(`https://huggingface.co/api/models?${params.toString()}`);
      if (!response.ok) throw new Error(`Model catalog returned ${response.status}`);
      const data = await response.json() as HubModel[];
      setModels(data.filter((m) => m.id && (m.library_name === "gguf" || m.tags?.some((tag) => tag.toLowerCase().includes("gguf")) || /gguf/i.test(m.id))).slice(0, 30));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load the model catalog."); }
    finally { setLoading(false); }
  }

  const visibleProviders = expandedProviders ? PROVIDERS : PROVIDERS.slice(0, 3);
  const providerModels = catalog.filter((item) => item.provider === activeProvider);
  const command = selected ? `ollama pull ${selected}` : "ollama pull qwen2.5:3b";
  const activeProviderName = PROVIDERS.find((p) => p.id === activeProvider)?.name ?? "Choose provider";

  return <section className="ultron-model-hub" aria-label="AI model hub">
    <div className="ultron-model-heading">
      <div><span className="ultron-eyebrow">ULTRON BRAIN</span><h2>Model Hub</h2><p>Choose the brain ULTRON should use, or manage its connections.</p></div>
      <div className="ultron-picker-anchor">
        <button className="ultron-choose-model" type="button" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)}>
          <span><small>ACTIVE MODEL</small><strong>{activeModel || "Choose model"}</strong></span><span className="ultron-chevron">⌃</span>
        </button>
        {pickerOpen && <div className="ultron-model-popover">
          <div className="ultron-popover-top"><div><small>MODEL SELECTOR</small><strong>{activeModel || "Choose a model"}</strong></div><button type="button" aria-label="Close model selector" onClick={() => setPickerOpen(false)}>×</button></div>
          <div className="ultron-popover-providers">
            {visibleProviders.map((p) => <button type="button" key={p.id} className={activeProvider === p.id ? "selected" : ""} onClick={() => setActiveProvider(p.id)}>
              <span className="ultron-provider-mark">{p.name.slice(0,1)}</span><span><strong>{p.name}</strong><small>{connected.includes(p.id) ? "Connected" : "Not connected"}</small></span>{activeProvider === p.id && <b>✓</b>}
            </button>)}
            <button className="ultron-provider-more" type="button" onClick={() => setExpandedProviders((v) => !v)}>{expandedProviders ? "−" : "+"}<span>{expandedProviders ? "Show fewer providers" : "More providers"}</span></button>
          </div>
          <div className="ultron-popover-models"><div className="ultron-popover-section">{activeProviderName} MODELS</div>
            {providerModels.length ? providerModels.map((m) => <button type="button" key={m.id} className={activeModel === m.model_id ? "active" : ""} onClick={() => { setActiveModel(m.model_id); setPickerOpen(false); }}><span>{m.model_id}</span><span>{activeModel === m.model_id ? "✓" : "↗"}</span></button>) : <p>{sessionReady && !signedIn ? "Sign in and connect a provider key in Settings to load models." : "No models connected yet. Add a key in Settings."}</p>}
          </div>
          <button className="ultron-popover-settings" type="button" onClick={() => { setPickerOpen(false); setTab("settings"); }}>＋ Add API key</button>
        </div>}
      </div>
    </div>
    <div className="ultron-model-tabs" role="tablist" aria-label="Model hub sections">
      <button role="tab" aria-selected={tab === "discover"} onClick={() => setTab("discover")}>Discover models</button>
      <button role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>Settings</button>
      <button role="tab" aria-selected={tab === "local"} onClick={() => setTab("local")}>On this device</button>
    </div>
    {tab === "discover" && <div className="ultron-model-panel">
      <form className="ultron-model-search" onSubmit={searchModels}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Qwen, Llama, Gemma, Phi…" aria-label="Search open models"/><button type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</button></form>
      <p className="ultron-model-hint">Searches Hugging Face for downloadable GGUF models. Check model card, license, quantization and hardware needs before downloading.</p>
      {error && <p className="ultron-model-error">{error}</p>}
      <div className="ultron-model-results">{models.map((m) => <article className="ultron-model-card" key={m.id}><div><strong>{m.id}</strong><span>{m.pipeline_tag ?? "Text generation"} · {(m.downloads ?? 0).toLocaleString()} downloads</span></div><button className="ultron-model-secondary" onClick={() => { setSelectedHubModel(m.id); setTab("local"); }}>Select</button><a href={`https://huggingface.co/${m.id}`} target="_blank" rel="noreferrer">Model card ↗</a></article>)}{!models.length && !loading && <div className="ultron-model-empty">Search community models, starting with Qwen GGUF or Llama GGUF.</div>}</div>
    </div>}
    {tab === "settings" && <div className="ultron-model-panel ultron-key-settings">
      <div className="ultron-settings-title"><div><span className="ultron-settings-kicker">CONNECTIONS</span><h3>API keys</h3><p>Paste a key. ULTRON identifies its provider, verifies it, saves it in Supabase Vault and enables it automatically.</p></div><span className="ultron-secure-mark">SECURE</span></div>
      {!sessionReady ? <p className="ultron-model-hint">Checking owner session…</p> : !signedIn ? <form className="ultron-owner-login" onSubmit={signIn}><strong>Owner sign in</strong><p>Sign in with the ULTRON owner account to manage its private provider keys.</p><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Owner email" autoComplete="username" required/><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" required/><button type="submit">Sign in</button>{authNotice && <small role="status">{authNotice}</small>}</form> : <form className="ultron-universal-key-form" onSubmit={saveKey}>
        <label htmlFor="ultron-universal-key">PASTE API KEY</label><div className="ultron-key-input-wrap"><input id="ultron-universal-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setKeyNotice(""); }} onPaste={() => setPasteReady(true)} placeholder="Paste any supported provider key…" /><button type="submit" disabled={savingKey || apiKey.trim().length < 8}>{savingKey ? "Checking…" : "＋"}</button></div>
        <div className="ultron-detected-provider">{detectProvider(apiKey) ? <><span className="ultron-live-dot"/> Detected: <strong>{detectProvider(apiKey)?.name}</strong></> : "Supported now: OpenRouter · Groq · Google AI Studio"}</div>
        {keyNotice && <p className={keyNotice.includes("accepted") || keyNotice.includes("already exists") ? "ultron-key-success" : "ultron-key-error"} role="status">{keyNotice}</p>}
      </form>}
      <div className="ultron-connected-providers"><div className="ultron-popover-section">PROVIDER STATUS</div>{PROVIDERS.slice(0,3).map((p) => <div key={p.id}><span>{p.name}</span><small className={connected.includes(p.id) ? "is-connected" : ""}>{connected.includes(p.id) ? "Connected" : "Not connected"}</small></div>)}</div>
      <p className="ultron-security-note">Keys are sent directly to the authenticated ULTRON Supabase function. Raw keys are never written to browser storage or returned after saving.</p>
    </div>}
    {tab === "local" && <div className="ultron-model-panel"><div className="ultron-local-feature"><strong>Run models locally</strong><p>Download a quantized model once, then use it without a cloud API key. The device needs enough free RAM and storage.</p>{selectedHubModel && <p>Selected Hugging Face model: <strong>{selectedHubModel}</strong>. Check the model card for a compatible GGUF file.</p>}</div><label className="ultron-model-label" htmlFor="ultron-model-id">Local model name or tag</label><input id="ultron-model-id" value={selected} onChange={(e) => setSelected(e.target.value)} placeholder="qwen2.5:3b"/><label className="ultron-model-label" htmlFor="ultron-ollama-host">Local inference endpoint</label><input id="ultron-ollama-host" value={ollamaHost} onChange={(e) => setOllamaHost(e.target.value)}/><div className="ultron-install-command"><code>{command}</code><button onClick={() => navigator.clipboard?.writeText(command)}>Copy command</button></div><p className="ultron-model-hint">Run the command on the machine hosting Ollama. For phone-native inference, prioritize GGUF with llama.cpp.</p><a href={ollamaHost.replace(/\/$/, "") + "/api/tags"} target="_blank" rel="noreferrer">Check local endpoint ↗</a></div>}
  </section>;
}
