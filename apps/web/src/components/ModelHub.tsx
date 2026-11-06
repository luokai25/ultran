"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type HubModel = { id: string; downloads?: number; likes?: number; pipeline_tag?: string; tags?: string[]; library_name?: string };
type Provider = { id: string; name: string; note: string; url: string };

const PROVIDERS: Provider[] = [
  { id: "openrouter", name: "OpenRouter", note: "Many models, one key", url: "https://openrouter.ai/keys" },
  { id: "groq", name: "Groq", note: "Fast inference", url: "https://console.groq.com/keys" },
  { id: "google_ai_studio", name: "Google AI Studio", note: "Gemini models", url: "https://aistudio.google.com/app/apikey" },
  { id: "cerebras", name: "Cerebras", note: "High-speed inference", url: "https://cloud.cerebras.ai/" },
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://vshoxrtrfleptqxkrmtc.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_OuRYpP7YP76xv4mfUgd_ng_NF4nWVoV";

function detectProvider(value: string): Provider | undefined {
  const key = value.trim();
  if (/^sk-or-v1-/i.test(key)) return PROVIDERS[0];
  if (/^gsk_/i.test(key)) return PROVIDERS[1];
  if (/^(AQ\.|AIza)/i.test(key)) return PROVIDERS[2];
  if (/^csk-/i.test(key)) return PROVIDERS[3];
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
  const [selectedHubModel, setSelectedHubModel] = useState("");

  const invoke = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!supabase) throw new Error("Supabase web configuration is missing. Add NEXT_PUBLIC_SUPABASE_ANON_KEY to the web deployment.");
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("Sign in to the ULTRON owner account first.");
    const { data, error: invokeError } = await supabase.functions.invoke("ultron-brain", { body: { action, ...extra } });
    if (invokeError) {
      const context = (invokeError as { context?: { json?: () => Promise<Record<string, unknown>> } }).context;
      const detail = await context?.json?.().catch(() => undefined);
      throw new Error(String(detail?.message ?? detail?.error ?? invokeError.message));
    }
    if (data?.error) throw new Error(String(data.message ?? data.error));
    return data;
  }, [supabase]);

  const refreshCatalog = useCallback(async () => {
    try {
      const [result, keys] = await Promise.all([invoke("catalog"), invoke("list_keys")]);
      setCatalog(result.models ?? []);
      setConnected((keys.providers ?? []).filter((provider: { connected_count: number }) => provider.connected_count > 0).map((provider: { id: string }) => provider.id));
    } catch {
      // The picker remains usable and shows the sign-in/configuration state in Settings.
    }
  }, [invoke]);

  useEffect(() => {
    if (!supabase) { setSessionReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(!!data.session);
      setSessionReady(true);
      if (data.session) void refreshCatalog();
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSignedIn(!!session);
      if (session) window.setTimeout(() => { void refreshCatalog(); }, 0);
      else { setCatalog([]); setConnected([]); }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [supabase, refreshCatalog]);

  const signIn = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setAuthNotice("");
    if (!supabase) { setAuthNotice("Supabase public configuration is missing."); return; }
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setAuthNotice(authError ? authError.message : "Signed in.");
    } catch (err) {
      setAuthNotice(err instanceof Error ? err.message : "Owner sign-in could not be completed.");
    }
  }, [email, password, supabase]);

  const saveKey = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const detected = detectProvider(apiKey);
    if (!detected) { setKeyNotice("Provider not recognized. Paste an OpenRouter, Groq, Google AI Studio or Cerebras key."); return; }
    if (savingKey) return;
    setPasteReady(false);
    setSavingKey(true);
    setKeyNotice("");
    try {
      const result = await invoke("add_key", { provider: detected.id, key: apiKey.trim(), label: detected.name });
      setApiKey("");
      setKeyNotice(result.duplicate ? `${detected.name} key already exists and is active.` : `${detected.name} accepted and securely saved.`);
      await refreshCatalog();
    } catch (err) {
      setKeyNotice(err instanceof Error ? err.message : "Key could not be saved.");
    } finally {
      setSavingKey(false);
    }
  }, [apiKey, invoke, refreshCatalog, savingKey]);

  useEffect(() => {
    if (!pasteReady || !signedIn || !detectProvider(apiKey) || savingKey) return;
    const timer = window.setTimeout(() => { void saveKey(); }, 350);
    return () => window.clearTimeout(timer);
  }, [pasteReady, apiKey, signedIn, savingKey, saveKey]);

  const searchModels = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ search: query.trim() || "GGUF", limit: "30", sort: "downloads", direction: "-1" });
      const response = await fetch(`https://huggingface.co/api/models?${params.toString()}`);
      if (!response.ok) throw new Error(`Model catalog returned ${response.status}`);
      const data = await response.json() as HubModel[];
      setModels(data.filter((model) => model.id && (model.library_name === "gguf" || model.tags?.some((tag) => tag.toLowerCase().includes("gguf")) || /gguf/i.test(model.id))).slice(0, 30));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the model catalog.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const visibleProviders = expandedProviders ? PROVIDERS : PROVIDERS.slice(0, 3);
  const providerModels = catalog.filter((item) => item.provider === activeProvider);
  const activeProviderName = PROVIDERS.find((provider) => provider.id === activeProvider)?.name ?? "Choose provider";
  const detectedProvider = detectProvider(apiKey);

  return (
    <section className="ultron-model-hub" aria-label="AI model hub">
      <div className="ultron-model-heading">
        <div><span className="ultron-eyebrow">ULTRON BRAIN</span><h2>Model directory</h2><p>Browse open models and manage the owner&apos;s provider connections.</p></div>
        <div className="ultron-picker-anchor">
          <button className="ultron-choose-model" type="button" aria-expanded={pickerOpen} onClick={() => setPickerOpen((value) => !value)}>
            <span><small>MODEL PREVIEW</small><strong>{activeModel || "Choose a model"}</strong></span><span className="ultron-chevron" aria-hidden="true">⌃</span>
          </button>
          {pickerOpen && <div className="ultron-model-popover">
            <div className="ultron-popover-top"><div><small>PROVIDER CATALOG</small><strong>{activeModel || "Choose a model"}</strong></div><button type="button" aria-label="Close model selector" onClick={() => setPickerOpen(false)}>×</button></div>
            <div className="ultron-popover-providers">
              {visibleProviders.map((provider) => <button type="button" key={provider.id} className={activeProvider === provider.id ? "selected" : ""} onClick={() => setActiveProvider(provider.id)}>
                <span className="ultron-provider-mark">{provider.name.slice(0, 1)}</span><span><strong>{provider.name}</strong><small>{connected.includes(provider.id) ? "Connected" : "Not connected"}</small></span>{activeProvider === provider.id && <b>✓</b>}
              </button>)}
              <button className="ultron-provider-more" type="button" onClick={() => setExpandedProviders((value) => !value)}>{expandedProviders ? "−" : "+"}<span>{expandedProviders ? "Show fewer providers" : "More providers"}</span></button>
            </div>
            <div className="ultron-popover-models"><div className="ultron-popover-section">{activeProviderName} MODELS</div>
              {providerModels.length ? providerModels.map((model) => <button type="button" key={model.id} className={activeModel === model.model_id ? "active" : ""} onClick={() => { setActiveModel(model.model_id); setPickerOpen(false); }}><span>{model.model_id}</span><span>{activeModel === model.model_id ? "✓" : "↗"}</span></button>) : <p>{sessionReady && !signedIn ? "Sign in and connect a provider key in Settings to load models." : "No models connected yet. Add a key in Settings."}</p>}
            </div>
            <p className="ultron-picker-note">Preview only. The shared ULTRON app controls the active chat model.</p>
            <button className="ultron-popover-settings" type="button" onClick={() => { setPickerOpen(false); setTab("settings"); }}>＋ Add API key</button>
          </div>}
        </div>
      </div>
      <div className="ultron-model-tabs" role="tablist" aria-label="Model hub sections">
        <button type="button" role="tab" aria-selected={tab === "discover"} onClick={() => setTab("discover")}>Discover models</button>
        <button type="button" role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>Provider keys</button>
        <button type="button" role="tab" aria-selected={tab === "local"} onClick={() => setTab("local")}>On-device runtime</button>
      </div>
      {tab === "discover" && <div className="ultron-model-panel">
        <form className="ultron-model-search" onSubmit={searchModels}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Qwen, Llama, Gemma, Phi…" aria-label="Search open models"/><button type="submit" disabled={loading}>{loading ? "Searching…" : "Search models"}</button></form>
        <p className="ultron-model-hint">Searches Hugging Face for downloadable GGUF model cards. Check the license, quantization, source files and device requirements before importing.</p>
        {error && <p className="ultron-model-error" role="alert">{error}</p>}
        <div className="ultron-model-results">{models.map((model) => <article className="ultron-model-card" key={model.id}><div><strong>{model.id}</strong><span>{model.pipeline_tag ?? "Text generation"} · {(model.downloads ?? 0).toLocaleString()} downloads</span></div><button type="button" className="ultron-model-secondary" onClick={() => { setSelectedHubModel(model.id); setTab("local"); }}>Shortlist</button><a href={`https://huggingface.co/${model.id}`} target="_blank" rel="noreferrer">Model card ↗</a></article>)}{!models.length && !loading && <div className="ultron-model-empty">Search community models, starting with Qwen GGUF or Llama GGUF.</div>}</div>
      </div>}
      {tab === "settings" && <div className="ultron-model-panel ultron-key-settings">
        <div className="ultron-settings-title"><div><span className="ultron-settings-kicker">PRIVATE CONNECTIONS</span><h3>Provider API keys</h3><p>Paste a key. ULTRON identifies its provider, verifies it, saves it in Supabase Vault and enables it automatically.</p></div><span className="ultron-secure-mark">VAULT STORED</span></div>
        {!sessionReady ? <p className="ultron-model-hint">Checking owner session…</p> : !signedIn ? <form className="ultron-owner-login" onSubmit={signIn}><strong>Owner sign in</strong><p>Sign in with the ULTRON owner account to manage private provider keys.</p><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Owner email" autoComplete="username" required/><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password" required/><button type="submit">Sign in</button>{authNotice && <small role="status">{authNotice}</small>}</form> : <form className="ultron-universal-key-form" onSubmit={saveKey}>
          <label htmlFor="ultron-universal-key">PASTE API KEY</label><div className="ultron-key-input-wrap"><input id="ultron-universal-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setKeyNotice(""); }} onPaste={() => setPasteReady(true)} placeholder="Paste any supported provider key…"/><button type="submit" disabled={savingKey || apiKey.trim().length < 8}>{savingKey ? "Checking…" : "＋"}</button></div>
          <div className="ultron-detected-provider">{detectedProvider ? <><span className="ultron-live-dot"/> Detected: <strong>{detectedProvider.name}</strong></> : "Supported: OpenRouter · Groq · Google AI Studio · Cerebras"}</div>
          {keyNotice && <p className={keyNotice.includes("accepted") || keyNotice.includes("already exists") ? "ultron-key-success" : "ultron-key-error"} role="status">{keyNotice}</p>}
        </form>}
        <div className="ultron-connected-providers"><div className="ultron-popover-section">PROVIDER STATUS</div>{PROVIDERS.map((provider) => <div key={provider.id} className="ultron-provider-status-row"><span>{provider.name}</span><small className={connected.includes(provider.id) ? "is-connected" : ""}>{connected.includes(provider.id) ? "Connected" : "Not connected"}</small><a href={provider.url} target="_blank" rel="noreferrer">Get key ↗</a></div>)}</div>
        <p className="ultron-security-note">Keys are sent to the authenticated ULTRON Supabase function. Raw keys are never written to browser storage or returned after saving.</p>
      </div>}
      {tab === "local" && <div className="ultron-model-panel ultron-local-runtime">
        <div className="ultron-local-feature"><span className="ultron-settings-kicker">ON-DEVICE INFERENCE</span><h3>Native runtime lives in the Android app</h3><p>This browser console cannot load model files into your phone&apos;s native runtime. Use Model Library in the ULTRON Android app to inspect device storage, import supported model files and load a local brain.</p>
          {selectedHubModel && <div className="ultron-shortlisted-model"><div><span className="ultron-model-label">SHORTLISTED HUGGING FACE MODEL</span><strong>{selectedHubModel}</strong></div><a href={`https://huggingface.co/${selectedHubModel}`} target="_blank" rel="noreferrer">Open model card ↗</a></div>}
        </div>
        <div className="ultron-local-points"><article><span>01</span><strong>Inspect</strong><p>Check the model card, license, quantization and required memory.</p></article><article><span>02</span><strong>Import</strong><p>Use the Android Model Library to bring the model into local storage.</p></article><article><span>03</span><strong>Load</strong><p>Let the device runtime validate the model before selecting it for local use.</p></article></div>
        <p className="ultron-model-hint">The native Android inference path runs inside ULTRON and does not depend on a separate local model server.</p>
      </div>}
    </section>
  );
}
