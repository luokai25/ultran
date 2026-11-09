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

async function brain(authorization: string, system: string, prompt: string, maxTokens = 5000): Promise<string> {
  const response = await fetch(url + "/functions/v1/ultron-brain", {
    method: "POST",
    headers: { Authorization: authorization, apikey: publishable, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      action: "chat",
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
    system: base + " You are a rigorous product opportunity strategist. Score each pocket using pain (30%), worsening (25%), purchasing power (30%), and speed to outcome (15%). Scores are 1-10 and need brief evidence-based rationales. Do not claim validation without evidence.",
    prompt: "User expertise / goal: " + topic + "\nAudience context: " + audience + "\nMode: " + clean(context.mode, 40) + "\nCreator analysis: " + JSON.stringify(context.creator ?? {}) + "\nGenerate 12 distinct market directions and 18 specific profitable-pocket candidates. Each pocket must contain aud, outcome, avoid, industry, niche, know, prob, statement, s:{pain,worsening,pp,speed}, score_rationales:{pain,worsening,purchasing_power,speed}, and a numeric overall score rounded to one decimal. All four scores must be numeric values from 1 to 10. Use the exact statement pattern: I help [audience] [outcome] without [bad alternative]. Calculate overall with the stated weights. Return JSON {directions:[...], pockets:[...]} sorted highest score first.",
  };
  if (stage === "outline") return {
    system: base + " You are a senior instructional designer. The approved outline becomes the canonical brief for all later stages. Make the three options meaningfully different.",
    prompt: "Topic: " + topic + "\nSelected pocket: " + JSON.stringify(pocket) + "\nFormat: " + clean(context.format, 80) + "\nDepth: " + clean(context.depth, 80) + "\nFeedback: " + clean(context.feedback, 2000) + "\nCreate exactly 3 distinct product outlines. Each has key (A/B/C), name, promise, from_state, to_state, chapters (7-12 with title and learning outcome), version (1). Return JSON {outlines:[...]}",
  };
  if (stage === "transformation") return {
    system: base + " You are a behavior-change and instructional design specialist. Make the transformation concrete, measurable, and achievable.",
    prompt: "Topic: " + topic + "\nPocket: " + JSON.stringify(pocket) + "\nApproved outline: " + JSON.stringify(context.outline ?? {}) + "\nReturn JSON with before_after rows for Emotional State, Core Fear, Daily Experience, Knowledge, Behavior, Identity; each row has before and after. Also return 4-7 transformation_stages with stage, goal, description, evidence_of_progress.",
  };
  if (stage === "section") return {
    system: base + " You are a professional nonfiction author. Write original, substantial, practical material. Do not fabricate sources. Do not repeat other sections. Include examples, a practical exercise, and a concise takeaway.",
    prompt: "Write one complete section of a digital product. Topic: " + topic + "\nAudience: " + audience + "\nPocket: " + JSON.stringify(pocket) + "\nApproved outline: " + JSON.stringify(context.outline ?? {}) + "\nTransformation map: " + JSON.stringify(context.transformation ?? {}) + "\nTone: " + clean(context.tone, 100) + "\nSupporting references supplied by owner: " + clean(context.references, 10000) + "\nSection title: " + clean(context.section_title, 240) + "\nSection number: " + String(context.section_index ?? 1) + "\nOther section titles (avoid duplication): " + JSON.stringify(context.all_sections ?? []) + "\nWrite approximately 700-1000 words in Markdown. Return only the section body.",
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
      const prompt = prompts(stage, context);
      await event(auth.ownerId, projectId, stage, "offer.generation_started", { stage });
      const generated = await brain(auth.authorization, prompt.system, prompt.prompt, stage === "section" ? 5000 : 6500);
      let result: unknown = generated;
      if (stage !== "section") result = parseJson(generated);
      const generatedMap = isObject(builder.generated) ? builder.generated : {};
      const nextBuilder = { ...builder, generated: { ...generatedMap, [stage]: result }, updated_at: new Date().toISOString() };
      const nextConfiguration = { ...configuration, builder: "offer_builder", offer_builder: nextBuilder };
      const { error } = await auth.db.from("ultron_product_projects").update({
        configuration: nextConfiguration,
        active_stage: "offer_" + stage,
        progress: Math.min(90, Math.max(Number(project.progress) || 0, stage === "discovery" ? 15 : stage === "outline" ? 30 : stage === "transformation" ? 45 : stage === "section" ? 75 : 85)),
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
