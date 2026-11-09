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

function prompts(stage: string, context: Record<string, unknown>) {
  const topic = clean(context.topic, 300);
  const audience = clean(context.audience, 300);
  const pocket = isObject(context.pocket) ? context.pocket : {};
  const base = "Create original, useful digital products for the ULTRON owner. Be specific, realistic, and honest. Never invent research, citations, follower counts, market validation, or facts about a creator. Separate verified input from assumptions. Avoid generic filler. Return only the requested format.";
  if (stage === "creator") return {
    system: base + " You are a creator-content analyst. Analyze only the material supplied by the user. If only a handle or URL is supplied without transcripts or source text, explicitly mark profile metrics and content findings as unverified and request source material rather than pretending to have scraped it.",
    prompt: "Creator profile: " + clean(context.creator_url, 500) + "\nCreator handle: " + clean(context.creator_handle, 160) + "\nContext: " + clean(context.context, 3000) + "\nSource material/transcripts: " + clean(context.source_text, 12000) + "\nReturn JSON with niche, transformation, content_themes (3 items with theme, monetisation_potential, rating), verdict, audience, voice, verified_stats, missing_data.",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!url || !publishable || !secret) return json({ error: "server_configuration_missing" }, 500);
  try {
    const body = await req.json();
    if (!isObject(body) || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);
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
      const context = isObject(body.context) ? body.context : {};
      await event(auth.ownerId, projectId, stage, "offer.generation_started", { stage });
      let result: unknown;
      if (stage === "discovery") {
        const directionPrompt = prompts("discovery", context);
        const directionData = parseJson(await brain(auth.authorization, directionPrompt.system, directionPrompt.prompt, 3500));
        const directions = Array.isArray(directionData.directions) ? directionData.directions.slice(0, 12) : [];
        if (!directions.length) throw new Error("no_market_directions_returned");
        await event(auth.ownerId, projectId, stage, "offer.directions_completed", { count: directions.length });
        const brainstormSystem = "You are a digital-product opportunity brainstormer. For every supplied direction, create one or two distinct specific profitable pockets. Do not score them yet. Do not claim real-world market validation without evidence.";
        const brainstormPrompt = "Topic: " + clean(context.topic, 300) + "\nDirections: " + JSON.stringify(directions) + "\nCreate 1-2 pockets for every direction. Each pocket must include direction_title, aud, outcome, avoid, industry, niche, know, prob, and statement using: I help [audience] [outcome] without [bad alternative]. Return JSON {pockets:[...]} with 18-24 pockets and no near-duplicates.";
        const brainstormData = parseJson(await brain(auth.authorization, brainstormSystem, brainstormPrompt, 6500));
        const rawPockets = Array.isArray(brainstormData.pockets) ? brainstormData.pockets.slice(0, 24) : [];
        if (!rawPockets.length) throw new Error("no_profitable_pockets_returned");
        await event(auth.ownerId, projectId, stage, "offer.brainstorm_completed", { count: rawPockets.length });
        const scoreSystem = "You are a rigorous product opportunity evaluator. Score each pocket using pain (30%), worsening (25%), purchasing power (30%), and speed to outcome (15%). Use numeric 1-10 scores and concise rationales. Do not inflate scores. Do not claim validation without evidence.";
        const scorePrompt = "Score every pocket below without changing its core statement. Return JSON {pockets:[...]} with each original pocket plus s:{pain,worsening,pp,speed}, score_rationales:{pain,worsening,purchasing_power,speed}, and numeric overall rounded to one decimal. All sub-scores are numeric from 1 to 10. Calculate overall = 0.30*pain + 0.25*worsening + 0.30*purchasing_power + 0.15*speed. Pockets: " + JSON.stringify(rawPockets);
        const scoredData = parseJson(await brain(auth.authorization, scoreSystem, scorePrompt, 6500));
        const pockets = Array.isArray(scoredData.pockets) ? scoredData.pockets : [];
        result = { directions, pockets: pockets.sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.overall) - Number(a.overall)) };
      } else if (stage === "outline") {
        const outlines: Record<string, unknown>[] = [];
        for (const key of ["A", "B", "C"]) {
          const onePrompt = prompts("outline", { ...context, option_key: key, previous_outlines: outlines });
          const oneData = parseJson(await brain(auth.authorization, onePrompt.system, onePrompt.prompt, 3500));
          const outline = isObject(oneData.outline) ? oneData.outline : oneData;
          outlines.push({ ...outline, key, version: 1 });
          await event(auth.ownerId, projectId, stage, "offer.outline_option_completed", { key });
        }
        result = { outlines };
      } else {
        const prompt = prompts(stage, context);
        const generated = await brain(auth.authorization, prompt.system, prompt.prompt, stage === "section" ? 5000 : 6500);
        result = stage === "section" ? generated : parseJson(generated);
      }
      const generatedMap = isObject(builder.generated) ? builder.generated : {};
      const nextBuilder = { ...builder, generated: { ...generatedMap, [stage]: result }, updated_at: new Date().toISOString() };
      const nextConfiguration = { ...configuration, builder: "offer_builder", offer_builder: nextBuilder };
      const { error } = await auth.db.from("ultron_product_projects").update({
        configuration: nextConfiguration,
        active_stage: "offer_" + stage,
        progress: Math.min(90, Math.max(Number(project.progress) || 0, stage === "discovery" ? 15 : stage === "outline" ? 30 : stage === "transformation" ? 45 : stage === "summary" ? 52 : stage === "section" ? 75 : stage === "quality" ? 82 : 85)),
        updated_at: new Date().toISOString(),
      }).eq("id", projectId).eq("owner_id", auth.ownerId);
      if (error) throw error;
      await event(auth.ownerId, projectId, stage, "offer.generation_completed", { stage });
      return json({ ok: true, stage, result });
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
