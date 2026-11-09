import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const clean = (v: unknown, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : "";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const admin = () => createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const userDb = (authorization: string) => createClient(url, publishable, {
  global: { headers: { Authorization: authorization } },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authenticate(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Response("unauthorized", { status: 401 });
  const db = userDb(authorization);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Response("unauthorized", { status: 401 });
  const { data: instance, error: ownerError } = await admin().from("ultron_instance")
    .select("owner_id").eq("id", true).maybeSingle();
  if (ownerError || !instance || instance.owner_id !== data.user.id) throw new Response("owner_instance_required", { status: 403 });
  return { ownerId: data.user.id, db, authorization };
}

async function brain(authorization: string, system: string, prompt: string, maxTokens = 5000, internalWorker = false): Promise<string> {
  const response = await fetch(url + "/functions/v1/ultron-brain", {
    method: "POST",
    headers: internalWorker
      ? { "x-ultron-cron-secret": authorization, "Content-Type": "application/json", Accept: "text/event-stream" }
      : { Authorization: authorization, apikey: publishable, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      action: internalWorker ? "worker_chat" : "chat",
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.25,
    }),
    signal: AbortSignal.timeout(105000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error("brain_http_" + response.status + ": " + detail);
  }
  if (!response.body) throw new Error("brain_stream_missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", output = "";
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      const block = buffer.slice(0, boundary);
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        const event = JSON.parse(raw);
        if (event.error) throw new Error(typeof event.error === "string" ? event.error : event.error.message || "model_error");
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === "string") output += delta;
        else if (Array.isArray(delta)) output += delta.map((part: Record<string, unknown>) => typeof part.text === "string" ? part.text : "").join("");
      }
      buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
      boundary = buffer.search(/\r?\n\r?\n/);
    }
    if (chunk.done) break;
  }
  if (buffer.trim()) {
    for (const line of buffer.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      const event = JSON.parse(raw);
      if (event.error) throw new Error("model_error");
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === "string") output += delta;
    }
  }
  if (!output.trim()) throw new Error("empty_model_response");
  return output.trim();
}

function parseJson(text: string): Record<string, unknown> {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const start = stripped.indexOf("{"), end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model_did_not_return_json");
  const value = JSON.parse(stripped.slice(start, end + 1));
  if (!isObject(value)) throw new Error("invalid_model_json");
  return value;
}

async function researchCreator(ownerId: string, projectId: string, context: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handle = clean(context.creator_handle, 160) || clean(context.creator_url, 500);
  if (!handle) return { status: "not_provided", missing_data: ["A public creator handle or profile URL"] };
  const db = admin();
  const { data: keys, error } = await db.from("ultron_google_ai_studio_keys")
    .select("id,vault_secret_id,models,priority,cooldown_until")
    .eq("owner_id", ownerId).eq("enabled", true).eq("status", "connected")
    .order("priority", { ascending: false });
  if (error) throw error;
  const candidates = (keys ?? []).flatMap((key: Record<string, unknown>) => {
    if (key.cooldown_until && Date.parse(String(key.cooldown_until)) > Date.now()) return [];
    const models = Array.isArray(key.models) ? key.models.filter((model): model is string =>
      typeof model === "string" && /^gemini-2\.5-(?:flash|flash-lite)(?:-|$)/i.test(model.replace(/^models\//i, ""))
    ) : [];
    models.sort((a, b) => Number(/flash-lite/i.test(b)) - Number(/flash-lite/i.test(a)));
    return models.length ? [{ key, model: models[0].replace(/^models\//i, "") }] : [];
  });
  if (!candidates.length) return {
    status: "search_provider_unavailable", handle,
    missing_data: ["A connected Google AI Studio key with public-search grounding support"],
  };

  let lastError = "No connected Google Search key could complete public creator research.";
  for (const candidate of candidates) {
    const { key, model } = candidate;
    const { data: secret, error: secretError } = await db.rpc("ultron_read_llm_secret", { p_secret_id: key.vault_secret_id });
    if (secretError || typeof secret !== "string" || !secret) { lastError = "A connected search key could not be read from Vault."; continue; }
    const prompt = [
      "Research the public Instagram creator identified by this handle or profile URL: " + handle,
      "Search the public web for the creator's official profile, public bio, public posts or reels, interviews, and other attributable public content.",
      "Return strict JSON only with this schema: {access,profile_url,display_name,bio,verified_stats,content_themes,recent_public_content,audience_signals,positioning,monetisation_signals,sources,missing_data,limitations}.",
      "access must be one of public, private, not_found, or unknown. Use private only when a reliable public source explicitly establishes that the account is private. If search cannot verify the account, use unknown or not_found.",
      "verified_stats must contain only facts directly supported by cited public sources. Use null or an empty array for unavailable follower counts, engagement metrics, and demographics. Never estimate or invent them.",
      "content_themes should describe only patterns supported by actual public posts or attributable reporting. recent_public_content should include a concise description and a source URL for each item. sources must contain title, url, and what_it_supports.",
      "Do not treat search snippets as full content samples. Distinguish verified facts from reasonable inferences. Never infer private information or claim access to private posts. If the account is inaccessible, clearly say so and list what material the owner could provide.",
    ].join("\n");
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": secret },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 6000 },
        }),
        signal: AbortSignal.timeout(7000),
      });
      const raw = await response.text();
      if (!response.ok) {
        lastError = "Google AI Studio public research returned HTTP " + response.status + ".";
        if (response.status === 429) {
          await db.from("ultron_google_ai_studio_keys").update({
            cooldown_until: new Date(Date.now() + 60_000).toISOString(),
            last_error: "HTTP 429 · provider cooldown", last_checked_at: new Date().toISOString(),
          }).eq("id", key.id).eq("owner_id", ownerId);
        } else if (response.status === 401 || response.status === 403) {
          await db.from("ultron_google_ai_studio_keys").update({
            status: response.status === 401 ? "invalid" : "expired",
            last_error: "HTTP " + response.status, last_checked_at: new Date().toISOString(),
          }).eq("id", key.id).eq("owner_id", ownerId);
        }
        continue;
      }
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      const rows = Array.isArray(envelope.candidates) ? envelope.candidates : [];
      const first = isObject(rows[0]) ? rows[0] : {};
      const content = isObject(first.content) ? first.content : {};
      const parts = Array.isArray(content.parts) ? content.parts : [];
      const text = parts.map((part) => isObject(part) && typeof part.text === "string" ? part.text : "").join("\n");
      if (!text.trim()) { lastError = "Google Search returned no creator research text."; continue; }
      const researched = parseJson(text);
      const grounding = isObject(first.groundingMetadata) ? first.groundingMetadata : {};
      const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : [];
      const groundedSources = chunks.flatMap((chunk) => {
        if (!isObject(chunk) || !isObject(chunk.web)) return [];
        const uri = clean(chunk.web.uri, 1200), title = clean(chunk.web.title, 300);
        return /^https?:\/\//i.test(uri) ? [{ title: title || uri, url: uri, what_it_supports: "Google Search grounding source" }] : [];
      });
      const suppliedSources = Array.isArray(researched.sources) ? researched.sources.filter(isObject) : [];
      const sourceMap = new Map<string, Record<string, unknown>>();
      for (const source of [...suppliedSources, ...groundedSources]) {
        const uri = clean(source.url, 1200);
        if (/^https?:\/\//i.test(uri)) sourceMap.set(uri, { title: clean(source.title, 300) || uri, url: uri, what_it_supports: clean(source.what_it_supports, 500) });
      }
      const sources = [...sourceMap.values()];
      for (const source of sources) {
        const uri = String(source.url);
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uri));
        const urlHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        let domain = "";
        try { domain = new URL(uri).hostname; } catch { continue; }
        await db.from("ultron_product_sources").upsert({
          owner_id: ownerId, project_id: projectId, canonical_url: uri, url_hash: urlHash,
          title: clean(source.title, 300) || uri, domain, source_type: "creator_social",
          fetch_status: "analyzed", extraction_summary: clean(source.what_it_supports, 1000),
          metadata: { creator_research: true, handle },
        }, { onConflict: "project_id,url_hash" });
      }
      await db.from("ultron_google_ai_studio_keys").update({
        last_used_at: new Date().toISOString(), last_checked_at: new Date().toISOString(),
        last_error: null, cooldown_until: null, status: "connected",
      }).eq("id", key.id).eq("owner_id", ownerId);
      await event(ownerId, projectId, "creator", "creator.public_research_completed", {
        access: clean(researched.access, 40) || "unknown", sources: sources.length, model,
      });
      return { ...researched, status: "researched", handle, sources };
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : "creator_public_research_failed";
    }
  }
  return {
    status: "research_unavailable", handle, error: lastError,
    missing_data: ["Accessible public profile details", "Public posts or reels", "Creator-provided transcripts or content samples"],
    limitations: ["ULTRON could not verify public creator material from the connected search providers. It will not invent profile facts."],
  };
}

function prompts(stage: string, context: Record<string, unknown>) {
  const topic = clean(context.topic, 300);
  const audience = clean(context.audience, 300);
  const pocket = isObject(context.pocket) ? context.pocket : {};
  const base = "Create original, useful digital products for the ULTRON owner. Be specific, realistic, and honest. Never invent research, citations, follower counts, market validation, or facts about a creator. Separate verified input from assumptions. Avoid generic filler. Return only the requested format.";
  if (stage === "creator") return {
    system: base + " You are a creator-content analyst. Analyze only the material supplied by the user. If only a handle or URL is supplied without transcripts or source text, explicitly mark profile metrics and content findings as unverified and request source material rather than pretending to have scraped it.",
    prompt: "Creator profile: " + clean(context.creator_url, 500) + "\nCreator handle: " + clean(context.creator_handle, 160) + "\nContext: " + clean(context.context, 3000) + "\nPublic research and grounded source URLs: " + JSON.stringify(context.creator_research ?? {}) + "\nOwner-supplied source material/transcripts: " + clean(context.source_text, 12000) + "\nReturn JSON with niche, transformation, content_themes (3 items with theme, monetisation_potential, rating), verdict, audience, voice, verified_stats, research_sources, missing_data. Never fill missing public data with guesses.",
  };
  if (stage === "discovery") return {
    system: base + " You are a market-direction strategist. Produce diverse categories and avoid near-duplicates. Do not claim validation without evidence.",
    prompt: "User expertise / goal: " + topic + "\nAudience context: " + audience + "\nMode: " + clean(context.mode, 40) + "\nCreator analysis: " + JSON.stringify(context.creator ?? {}) + "\nReturn 12 distinct directions as JSON {directions:[{title,category,audience,problem}]} with a different angle for each.",
  };
  if (stage === "outline") return {
    system: base + " You are a senior instructional designer. Generate one proposal at a time. Each proposal must be meaningfully different from the previous proposals and the approved outline becomes the canonical brief for every later stage.",
    prompt: "Topic: " + topic + "\nSelected pocket: " + JSON.stringify(pocket) + "\nFormat: " + clean(context.format, 80) + "\nDepth: " + clean(context.depth, 80) + "\nFeedback: " + clean(context.feedback, 2000) + "\nOption key: " + clean(context.option_key, 1) + "\nPrevious proposals to avoid repeating: " + JSON.stringify(context.previous_outlines ?? []) + "\nCreate exactly ONE original product outline. Include key, name, promise, from_state, to_state, exactly 7 chapters with title and learning_outcome, version (1). Return JSON {outline:{...}}.",
  };
  if (stage === "transformation") return {
    system: base + " You are a behavior-change and instructional design specialist. Make the transformation concrete, measurable, and achievable. Use second-person language for guided mode and third-person language for creator mode.",
    prompt: "Topic: " + topic + "\nPocket: " + JSON.stringify(pocket) + "\nApproved outline: " + JSON.stringify(context.outline ?? {}) + "\nReturn JSON with exactly four before_after rows for Emotional State, Core Fear, Daily Experience, Identity; each has before and after, each 2-3 concrete sentences. Also return exactly five transformation_stages with stage, goal, description, evidence_of_progress.",
  };
  if (stage === "section") return {
    system: base + " You are a professional nonfiction author. Write original, substantial, practical material. Do not fabricate sources. Do not repeat other sections. Use the named frameworks consistently. Include examples, a practical exercise, a concise takeaway, and typed editorial components such as callouts, checklists, timelines, and tables where useful.",
    prompt: "Write one complete section of a digital product. Topic: " + topic + "\nAudience: " + audience + "\nPocket: " + JSON.stringify(pocket) + "\nApproved outline: " + JSON.stringify(context.outline ?? {}) + "\nTransformation map: " + JSON.stringify(context.transformation ?? {}) + "\nFramework glossary: " + JSON.stringify(context.framework_glossary ?? []) + "\nPrevious sections (maintain continuity and avoid repetition): " + JSON.stringify(context.previous_sections ?? []) + "\nTone: " + clean(context.tone, 100) + "\nSupporting references supplied by owner: " + clean(context.references, 10000) + "\nSection title: " + clean(context.section_title, 240) + "\nSection number: " + String(context.section_index ?? 1) + "\nOther section titles: " + JSON.stringify(context.all_sections ?? []) + "\nWrite approximately 700-1000 words in Markdown. If the material contains advice in health, money, legal, or mental-health domains, clearly separate general education from professional advice and avoid unsafe instructions. Return only the section body.",
  };
  if (stage === "summary") return {
    system: base + " You are a senior nonfiction editor. Create a clear, specific summary from the approved canonical brief. Invent memorable named frameworks only when they can be used consistently in the book.",
    prompt: "Topic: " + topic + "\nPocket: " + JSON.stringify(pocket) + "\nApproved outline: " + JSON.stringify(context.outline ?? {}) + "\nTransformation map: " + JSON.stringify(context.transformation ?? {}) + "\nReturn JSON with title, subtitle, about, what_you_learn (4 bullets), predicted_word_count_range (7,000-11,000 words), reading_minutes, chapter_count (7), bonus_count (2), framework_glossary (3-6 named frameworks with one-sentence definitions), and bonus_materials (2).",
  };
  if (stage === "quality") return {
    system: base + " You are a strict developmental editor and safety reviewer. Do not rewrite the whole book. Find concrete problems and propose precise fixes.",
    prompt: "Review this manuscript for repetition, unsupported factual claims, contradictions, weak sections, and unsafe advice. Product brief: " + JSON.stringify({topic,pocket,outline:context.outline,transformation:context.transformation}) + "\nSections: " + JSON.stringify(context.sections ?? []) + "\nReturn JSON with overall_score (1-10), repeated_phrases, weak_sections (section_title,issue,fix), unsupported_claims, safety_flags, consistency_flags, passed (boolean). Do not invent citations.",
  };
  if (stage === "brand") return {
    system: base + " You are an editorial art director and product brand designer. Return accessible, coherent colors with strong contrast.",
    prompt: "Product title: " + clean(context.title, 240) + "\nTopic: " + topic + "\nAudience: " + audience + "\nTone: " + clean(context.tone, 100) + "\nReturn JSON with palette (page,type,accent,tint,muted hex colors), display_font, body_font, cover_concept, subtitle, short_description, long_description, three key benefits.",
  };
  if (stage === "store") return {
    system: base + " You are a careful ecommerce copywriter. Do not claim guaranteed results, fake scarcity, or unsupported testimonials.",
    prompt: "Product: " + clean(context.title, 240) + "\nSubtitle: " + clean(context.subtitle, 500) + "\nPocket: " + JSON.stringify(pocket) + "\nTransformation: " + JSON.stringify(context.transformation ?? {}) + "\nReturn JSON with headline, subheadline, description, benefits (5), contents (list), who_for, who_not_for, faq (4), suggested_price_usd, pricing_rationale, tags.",
  };
  throw new Error("unsupported_generation_stage");
}

async function event(ownerId: string, projectId: string, stage: string, eventType: string, payload: Record<string, unknown> = {}) {
  const { error } = await admin().from("ultron_product_events").insert({ owner_id: ownerId, project_id: projectId, stage, event_type: eventType, payload });
  if (error) throw error;
}

function offerBuilderSteps(stage: string): string[] {
  if (stage === "discovery") return ["directions", "brainstorm", "score"];
  if (stage === "outline") return ["outline_A", "outline_B", "outline_C"];
  return [stage];
}

function offerBuilderResult(stage: string, values: Record<string, unknown>): unknown {
  if (stage === "discovery") {
    const directions = isObject(values.directions) && Array.isArray(values.directions.directions) ? values.directions.directions : [];
    const scored: Array<Record<string, unknown>> = isObject(values.score) && Array.isArray(values.score.pockets) ? values.score.pockets.filter(isObject) : [];
    return { directions, pockets: scored.sort((a, b) => Number(b.overall) - Number(a.overall)) };
  }
  if (stage === "outline") {
    const outlines = ["outline_A", "outline_B", "outline_C"].map((key) => values[key]).filter(isObject);
    return { outlines };
  }
  if (stage === "section") return { value: typeof values.section === "string" ? values.section : "" };
  return values[stage] ?? {};
}

async function offerBuilderWorkerAuth(req: Request): Promise<{ ownerId: string; secret: string; db: ReturnType<typeof admin> }> {
  const secret = req.headers.get("x-ultron-cron-secret") ?? "";
  const db = admin();
  const { data: expected, error: secretError } = await db.rpc("ultron_get_system_secret", { p_name: "ultron_brain_cron_secret" });
  if (secretError || typeof expected !== "string" || !expected || secret !== expected) throw new Response("unauthorized_worker", { status: 401 });
  const { data: instance, error: ownerError } = await db.from("ultron_instance").select("owner_id").eq("id", true).maybeSingle();
  if (ownerError || !instance?.owner_id) throw new Response("owner_instance_required", { status: 503 });
  return { ownerId: String(instance.owner_id), secret, db };
}

function wakeNextOfferBuilderStep(secret: string): void {
  const run = fetch(url + "/functions/v1/ultron-jobs", {
    method: "POST",
    headers: { "x-ultron-cron-secret": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "process", limit: 1 }),
    signal: AbortSignal.timeout(115_000),
  }).catch((error) => {
    console.warn("[ULTRON Offer Builder worker wake]", error instanceof Error ? error.message : "worker_wake_failed");
  });
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") runtime.waitUntil(run);
}

async function processOfferBuilderJob(req: Request, body: Record<string, unknown>): Promise<Response> {
  const { ownerId, secret, db } = await offerBuilderWorkerAuth(req);
  const runId = clean(body.run_id, 80), jobId = clean(body.job_id, 80), lockToken = clean(body.lock_token, 80);
  if (!runId || !jobId || !lockToken) return json({ error: "run_job_and_lock_required" }, 400);
  const { data: job, error: jobError } = await db.from("ultron_jobs")
    .select("id,owner_id,job_type,status,lock_token,payload")
    .eq("id", jobId).eq("owner_id", ownerId).maybeSingle();
  if (jobError) throw jobError;
  const payload = isObject(job?.payload) ? job.payload : {};
  if (!job || job.job_type !== "offer_builder.generate" || job.status !== "running" ||
      job.lock_token !== lockToken || payload.run_id !== runId) return json({ error: "valid_claimed_offer_builder_job_required" }, 403);

  const { data: run, error: runError } = await db.from("ultron_offer_builder_runs")
    .select("id,owner_id,project_id,requested_stage,context,steps,step_index,step_results,status,result")
    .eq("id", runId).eq("owner_id", ownerId).maybeSingle();
  if (runError) throw runError;
  if (!run) return json({ error: "offer_builder_run_not_found" }, 404);
  if (run.status === "completed") return json({ ok: true, result: { completed: true, result: run.result } });
  if (run.status === "cancelled") throw new Error("offer_builder_run_cancelled");

  const stage = clean(run.requested_stage, 40);
  const context = isObject(run.context) ? run.context : {};
  const steps = Array.isArray(run.steps) ? run.steps.filter((step): step is string => typeof step === "string") : offerBuilderSteps(stage);
  const stepIndex = Math.max(0, Number(run.step_index) || 0);
  const step = steps[stepIndex];
  if (!step) throw new Error("offer_builder_step_missing");
  const previous = isObject(run.step_results) ? run.step_results : {};
  await db.from("ultron_offer_builder_runs").update({ status: "running", error_message: null, updated_at: new Date().toISOString() })
    .eq("id", runId).eq("owner_id", ownerId);

  let system = "", prompt = "", maxTokens = 6500;
  if (step === "directions") {
    const p = prompts("discovery", context); system = p.system; prompt = p.prompt; maxTokens = 3500;
  } else if (step === "brainstorm") {
    const directions = isObject(previous.directions) && Array.isArray(previous.directions.directions) ? previous.directions.directions : [];
    if (!directions.length) throw new Error("offer_builder_directions_checkpoint_missing");
    system = "You are a digital-product opportunity brainstormer. For every supplied direction, create one or two distinct specific profitable pockets. Do not score them yet. Do not claim real-world market validation without evidence.";
    prompt = "Topic: " + clean(context.topic, 300) + "\nDirections: " + JSON.stringify(directions) + "\nCreate 1-2 pockets for every direction. Each pocket must include direction_title, aud, outcome, avoid, industry, niche, know, prob, and statement using: I help [audience] [outcome] without [bad alternative]. Return JSON {pockets:[...]} with 18-24 pockets and no near-duplicates.";
  } else if (step === "score") {
    const brainstorm = isObject(previous.brainstorm) ? previous.brainstorm : {};
    const pockets = Array.isArray(brainstorm.pockets) ? brainstorm.pockets : [];
    if (!pockets.length) throw new Error("offer_builder_brainstorm_checkpoint_missing");
    system = "You are a rigorous product opportunity evaluator. Score each pocket using pain (30%), worsening (25%), purchasing power (30%), and speed to outcome (15%). Use numeric 1-10 scores and concise rationales. Do not inflate scores. Do not claim validation without evidence.";
    prompt = "Score every pocket below without changing its core statement. Return JSON {pockets:[...]} with each original pocket plus s:{pain,worsening,pp,speed}, score_rationales:{pain,worsening,purchasing_power,speed}, and numeric overall rounded to one decimal. All sub-scores are numeric from 1 to 10. Calculate overall = 0.30*pain + 0.25*worsening + 0.30*purchasing_power + 0.15*speed. Pockets: " + JSON.stringify(pockets);
  } else if (step.startsWith("outline_")) {
    const key = step.slice("outline_".length);
    const previousOutlines = ["outline_A", "outline_B", "outline_C"].map((name) => previous[name]).filter(isObject);
    const p = prompts("outline", { ...context, option_key: key, previous_outlines: previousOutlines });
    system = p.system; prompt = p.prompt; maxTokens = 3500;
  } else {
    const generationContext = step === "creator"
      ? { ...context, creator_research: await researchCreator(ownerId, run.project_id, context) }
      : context;
    const p = prompts(stage, generationContext);
    system = p.system; prompt = p.prompt; maxTokens = stage === "section" ? 5000 : 6500;
  }

  const generated = await brain(secret, system, prompt, maxTokens, true);
  const value: unknown = stage === "section" ? generated : parseJson(generated);
  const nextValues = { ...previous, [step]: value };
  const nextIndex = stepIndex + 1;
  const now = new Date().toISOString();
  await event(ownerId, run.project_id, stage, "offer.generation_step_completed", { step, step_index: stepIndex + 1, step_count: steps.length });

  if (nextIndex < steps.length) {
    const nextKey = "offer-builder:" + runId + ":step:" + nextIndex + ":cycle:0";
    const { data: nextJob, error: nextJobError } = await db.from("ultron_jobs").insert({
      owner_id: ownerId, job_type: "offer_builder.generate", title: "Continue Offer Builder " + stage,
      payload: { run_id: runId }, priority: 5, max_attempts: 20, idempotency_key: nextKey,
    }).select("id").single();
    if (nextJobError && nextJobError.code !== "23505") throw nextJobError;
    let nextJobId = nextJob?.id;
    if (!nextJobId) {
      const { data: existing, error: existingError } = await db.from("ultron_jobs").select("id").eq("owner_id", ownerId).eq("idempotency_key", nextKey).maybeSingle();
      if (existingError) throw existingError;
      nextJobId = existing?.id;
    }
    await db.from("ultron_offer_builder_runs").update({
      step_results: nextValues, step_index: nextIndex, progress: Math.min(95, Math.round(nextIndex / steps.length * 95)),
      status: "queued", current_job_id: nextJobId ?? null, updated_at: now,
    }).eq("id", runId).eq("owner_id", ownerId);
    wakeNextOfferBuilderStep(secret);
    await db.from("ultron_product_projects").update({
      active_stage: "offer_" + stage, progress: Math.min(90, Math.max(Number((await db.from("ultron_product_projects").select("progress").eq("id", run.project_id).eq("owner_id", ownerId).maybeSingle()).data?.progress) || 0, Math.round(nextIndex / steps.length * 80))),
      updated_at: now,
    }).eq("id", run.project_id).eq("owner_id", ownerId);
    return json({ ok: true, result: { queued: true, step, next_step: steps[nextIndex] } });
  }

  const finalResult = offerBuilderResult(stage, nextValues);
  const { data: project, error: projectError } = await db.from("ultron_product_projects")
    .select("configuration,progress").eq("id", run.project_id).eq("owner_id", ownerId).maybeSingle();
  if (projectError) throw projectError;
  if (!project) throw new Error("offer_builder_project_missing");
  const configuration = isObject(project.configuration) ? project.configuration : {};
  const builder = isObject(configuration.offer_builder) ? configuration.offer_builder : {};
  const generatedMap = isObject(builder.generated) ? builder.generated : {};
  const nextBuilder = { ...builder, generated: { ...generatedMap, [stage]: finalResult }, updated_at: now };
  const stageProgress: Record<string, number> = { creator: 12, discovery: 20, outline: 35, transformation: 48, summary: 55, section: 78, quality: 86, brand: 90, store: 92 };
  const { error: saveError } = await db.from("ultron_product_projects").update({
    configuration: { ...configuration, builder: "offer_builder", offer_builder: nextBuilder },
    active_stage: "offer_" + stage, progress: Math.max(Number(project.progress) || 0, stageProgress[stage] ?? 85),
    updated_at: now,
  }).eq("id", run.project_id).eq("owner_id", ownerId);
  if (saveError) throw saveError;
  const storedResult = stage === "section" ? { value: typeof (finalResult as Record<string, unknown>)?.value === "string" ? (finalResult as Record<string, unknown>).value : "" } : finalResult;
  const { error: completeRunError } = await db.from("ultron_offer_builder_runs").update({
    step_results: nextValues, step_index: nextIndex, progress: 100, status: "completed",
    result: isObject(storedResult) ? storedResult : {}, error_message: null, completed_at: now, updated_at: now,
  }).eq("id", runId).eq("owner_id", ownerId);
  if (completeRunError) throw completeRunError;
  await event(ownerId, run.project_id, stage, "offer.generation_completed", { stage });
  return json({ ok: true, result: finalResult });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!url || !publishable || !secret) return json({ error: "server_configuration_missing" }, 500);
  try {
    const body = await req.json();
    if (!isObject(body) || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);
    if (body.action === "worker_process") return await processOfferBuilderJob(req, body);
    const auth = await authenticate(req);
    const db = admin();
    if (body.action === "create") {
      const request = clean(body.request, 4000);
      const initial = isObject(body.state) ? body.state : {};
      const { data, error } = await auth.db.from("ultron_product_projects").insert({
        owner_id: auth.ownerId,
        title: clean(body.title, 180) || request.slice(0, 100) || "New ULTRON offer",
        user_request: request,
        status: "queued",
        active_stage: "offer_discovery",
        progress: 0,
        configuration: { builder: "offer_builder", version: 1, offer_builder: { state: initial } },
      }).select("id,title,status,active_stage,progress,configuration,created_at").single();
      if (error) throw error;
      await event(auth.ownerId, data.id, "offer_discovery", "offer.created", { title: data.title });
      return json({ ok: true, project: data }, 201);
    }
    if (body.action === "job_status") {
      const runId = clean(body.run_id, 80);
      if (!runId) return json({ error: "run_id_required" }, 400);
      const { data: run, error: runError } = await db.from("ultron_offer_builder_runs")
        .select("id,requested_stage,status,progress,step_index,steps,result,error_message,updated_at,completed_at")
        .eq("id", runId).eq("owner_id", auth.ownerId).maybeSingle();
      if (runError) throw runError;
      if (!run) return json({ error: "offer_builder_run_not_found" }, 404);
      const value = run.requested_stage === "section" && isObject(run.result) ? run.result.value : run.result;
      return json({ ok: true, run: { ...run, result: value } });
    }
    const projectId = clean(body.project_id, 80);
    if (!projectId) return json({ error: "project_id_required" }, 400);
    const { data: project, error: projectError } = await auth.db.from("ultron_product_projects")
      .select("id,owner_id,title,user_request,status,active_stage,progress,configuration,opportunity_brief,synthesis_summary")
      .eq("id", projectId).eq("owner_id", auth.ownerId).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return json({ error: "project_not_found" }, 404);
    const configuration = isObject(project.configuration) ? project.configuration : {};
    const builder = isObject(configuration.offer_builder) ? configuration.offer_builder : {};
    if (body.action === "get") return json({ ok: true, project, state: isObject(builder.state) ? builder.state : {} });
    if (body.action === "save") {
      const nextState = isObject(body.state) ? body.state : {};
      const nextBuilder = { ...builder, state: nextState, updated_at: new Date().toISOString() };
      const { error } = await auth.db.from("ultron_product_projects").update({
        configuration: { ...configuration, builder: "offer_builder", offer_builder: nextBuilder },
        updated_at: new Date().toISOString(),
      }).eq("id", projectId).eq("owner_id", auth.ownerId);
      if (error) throw error;
      await event(auth.ownerId, projectId, clean(body.stage, 80) || "offer_builder", "offer.state_saved", { stage: clean(body.stage, 80) });
      return json({ ok: true, saved: true });
    }
    if (body.action === "generate") {
      const stage = clean(body.stage, 40);
      const allowedStages = new Set(["creator","discovery","outline","transformation","summary","section","quality","brand","store"]);
      if (!allowedStages.has(stage)) return json({ error: "unsupported_generation_stage" }, 400);
      const context = isObject(body.context) ? body.context : {};
      const runId = crypto.randomUUID();
      const steps = offerBuilderSteps(stage);
      const idempotencyKey = "offer-builder:" + runId;
      const { data: run, error: runError } = await db.from("ultron_offer_builder_runs").insert({
        owner_id: auth.ownerId, project_id: projectId, requested_stage: stage, context, steps,
        step_index: 0, step_results: {}, status: "queued", progress: 0, idempotency_key: idempotencyKey,
      }).select("id").single();
      if (runError) throw runError;
      const { data: job, error: jobError } = await db.from("ultron_jobs").insert({
        owner_id: auth.ownerId, job_type: "offer_builder.generate", title: "Generate Offer Builder " + stage,
        payload: { run_id: run.id }, priority: 5, max_attempts: 20,
        idempotency_key: "offer-builder:" + run.id + ":step:0:cycle:0",
      }).select("id").single();
      if (jobError) {
        await db.from("ultron_offer_builder_runs").update({ status: "failed", error_message: "Could not queue the generation run.", completed_at: new Date().toISOString() }).eq("id", run.id);
        throw jobError;
      }
      await db.from("ultron_offer_builder_runs").update({ current_job_id: job.id, updated_at: new Date().toISOString() }).eq("id", run.id);
      await event(auth.ownerId, projectId, stage, "offer.generation_started", { stage, run_id: run.id });
      return json({ ok: true, queued: true, run_id: run.id, stage });
    }
    if (body.action === "finalize") {
      const markdown = clean(body.markdown, 500000);
      const title = clean(body.title, 180) || project.title;
      if (markdown.length < 500) return json({ error: "product_content_too_short" }, 422);
      const version = 1;
      const storagePath = auth.ownerId + "/products/" + projectId + "/offer-builder-v" + version + ".md";
      const bytes = new TextEncoder().encode(markdown);
      const upload = await db.storage.from("ultron-private").upload(storagePath, bytes, { contentType: "text/markdown; charset=utf-8", upsert: true });
      if (upload.error) throw upload.error;
      const { error: docError } = await db.from("ultron_product_documents").upsert({
        owner_id: auth.ownerId, project_id: projectId, title, format: "markdown", status: "final", version,
        storage_path: storagePath, mime_type: "text/markdown", byte_size: bytes.byteLength,
        validation_report: { builder: "offer_builder", saved: true, word_count: markdown.split(/\s+/).filter(Boolean).length },
      }, { onConflict: "project_id,title,version" });
      if (docError) throw docError;
      const { error: updateError } = await auth.db.from("ultron_product_projects").update({
        title, status: "completed", active_stage: "completed", progress: 100, draft_markdown: markdown,
        synthesis_summary: { builder: "offer_builder", finalized_at: new Date().toISOString(), word_count: markdown.split(/\s+/).filter(Boolean).length },
        completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", projectId).eq("owner_id", auth.ownerId);
      if (updateError) throw updateError;
      await event(auth.ownerId, projectId, "packaging", "offer.finalized", { title, bytes: bytes.byteLength });
      const { data: signed, error: signError } = await db.storage.from("ultron-private").createSignedUrl(storagePath, 3600, { download: title + ".md" });
      if (signError) throw signError;
      return json({ ok: true, title, download_url: signed?.signedUrl ?? null, word_count: markdown.split(/\s+/).filter(Boolean).length });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    if (error instanceof Response) return json({ error: error.status === 401 ? "unauthorized" : "forbidden", message: await error.text() }, error.status);
    const message = error instanceof Error ? error.message : "internal_error";
    return json({ error: "offer_builder_failed", message: message.slice(0, 500) }, 500);
  }
});
