import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-ultron-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const MEMORY_STOP = new Set("the a an and or but if then than this that these those with from into about for to of in on at by as is are was were be been it its i me my we our you your what why how when where which can could should would do does did have has had please help want need make build create use using now next continue more same all every also just very really".split(" "));
function embedMemoryText(text: string): number[] {
  const tokens = (text.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []).filter((term) => !MEMORY_STOP.has(term)).slice(0, 240);
  const vector = Array.from({ length: 96 }, () => 0);
  const hash = (value: string) => { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return h >>> 0; };
  const features = [...tokens, ...tokens.slice(0, -1).map((token, index) => token + "_" + tokens[index + 1])];
  for (const feature of features) { const value = hash(feature), index = value % 96; vector[index] = (vector[index] ?? 0) + ((value & 0x100) === 0 ? 1 : -1); }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector;
}
function redactMemorySecrets(value: string): string {
  return value
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gi, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

type CloudProvider = "openrouter" | "mistral" | "cerebras" | "groq" | "cohere" | "google_ai_studio";
const CLOUD_PROVIDERS: Array<{ id: CloudProvider; base: string; protocol: "openai" | "cohere" }> = [
  { id: "groq", base: "https://api.groq.com/openai/v1", protocol: "openai" },
  { id: "cerebras", base: "https://api.cerebras.ai/v1", protocol: "openai" },
  { id: "openrouter", base: "https://openrouter.ai/api/v1", protocol: "openai" },
  { id: "cohere", base: "https://api.cohere.com/v2", protocol: "cohere" },
  { id: "mistral", base: "https://api.mistral.ai/v1", protocol: "openai" },
  { id: "google_ai_studio", base: "https://generativelanguage.googleapis.com/v1beta/openai", protocol: "openai" },
];
function isFreeModel(provider: CloudProvider, model: string): boolean {
  const id = model.toLowerCase().replace(/^models\//, "");
  if (provider === "openrouter") return id.endsWith(":free");
  if (provider === "cerebras") return false; // One-time trial only; exclude from recurring zero-cost routing.
  if (provider === "groq") return /allam.*2.*7b|llama.?3[.-]1.*8b|llama.?3[.-]3.*70b|llama.?4.*scout|groq\/compound|gpt-oss-(120|20)b|qwen3-32b/.test(id);
  if (provider === "cohere") return /c4ai-aya-expanse-32b|command-a-03-2025|command-a-reasoning-08-2025|command-r-08-2024|command-r-plus-08-2024|command-r7b-12-2024|command-r7b-arabic-02-2025/.test(id);
  if (provider === "google_ai_studio") return /^gemini-(?:2\.5-(?:flash|flash-lite)|3(?:\.[678])?-flash|3-flash-preview|3\.1-flash-lite)/.test(id);
  return /^(mistral|codestral)[-_]/.test(id);
}
async function hasAvailableCloudModel(secretDb: ReturnType<typeof createClient>, ownerId: string): Promise<boolean> {
  for (const provider of CLOUD_PROVIDERS) {
    const { data, error } = await secretDb.from(`ultron_${provider.id}_keys`).select("models").eq("owner_id", ownerId).eq("enabled", true).eq("status", "connected").limit(20);
    if (error) throw error;
    if ((data ?? []).some((row) => Array.isArray(row.models) && row.models.some((model) => typeof model === "string" && isFreeModel(provider.id, model)))) return true;
  }
  return false;
}
async function generateMemoryProposal(secretDb: ReturnType<typeof createClient>, ownerId: string, messages: Array<{ role: string; content: string }>): Promise<{ proposal: Record<string, unknown>; model: string }> {
  for (const provider of CLOUD_PROVIDERS) {
    const { data: keys, error } = await secretDb.from(`ultron_${provider.id}_keys`).select("id,vault_secret_id,models,priority,request_count,tokens_used,last_used_at").eq("owner_id", ownerId).eq("enabled", true).eq("status", "connected").order("priority", { ascending: false }).order("last_used_at", { ascending: true, nullsFirst: true }).limit(20);
    if (error) throw error;
    for (const key of keys ?? []) {
      const model = Array.isArray(key.models) ? key.models.find((value): value is string => typeof value === "string" && isFreeModel(provider.id, value)) : undefined;
      if (!model) continue;
      const { data: secret, error: secretError } = await secretDb.rpc("ultron_read_llm_secret", { p_secret_id: key.vault_secret_id });
      if (secretError || typeof secret !== "string" || !secret) continue;
      const endpoint = provider.protocol === "cohere" ? `${provider.base}/chat` : `${provider.base}/chat/completions`;
      const payload = provider.protocol === "cohere"
        ? { model, messages, temperature: 0.1, max_tokens: 1800 }
        : { model, messages, temperature: 0.1, max_tokens: 1800, response_format: { type: "json_object" } };
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(45000) });
        const raw = await response.text();
        if (!response.ok) {
          const state = response.status === 401 ? "invalid" : response.status === 403 ? "expired" : response.status === 429 ? "rate_limited" : "unreachable";
          await secretDb.from(`ultron_${provider.id}_keys`).update({ status: state, last_error: `HTTP ${response.status}: ${raw.slice(0, 300)}`, last_checked_at: new Date().toISOString(), cooldown_until: response.status === 429 ? new Date(Date.now() + 60000).toISOString() : null }).eq("id", key.id).eq("owner_id", ownerId);
          continue;
        }
        const envelope = JSON.parse(raw) as Record<string, unknown>;
        let content = "";
        let usage = 0;
        if (provider.protocol === "cohere") {
          const message = isObject(envelope.message) ? envelope.message : {};
          const parts = Array.isArray(message.content) ? message.content : [];
          content = parts.map((part) => isObject(part) && typeof part.text === "string" ? part.text : "").join("");
          const meta = isObject(envelope.usage) ? envelope.usage : {};
          const billed = isObject(meta.billed_units) ? meta.billed_units : {};
          usage = Number(billed.input_tokens ?? 0) + Number(billed.output_tokens ?? 0);
        } else {
          const choices = Array.isArray(envelope.choices) ? envelope.choices as Array<Record<string, unknown>> : [];
          const message = isObject(choices[0]?.message) ? choices[0].message : {};
          content = typeof message.content === "string" ? message.content : "";
          const meta = isObject(envelope.usage) ? envelope.usage : {};
          usage = Number(meta.total_tokens ?? (Number(meta.prompt_tokens ?? 0) + Number(meta.completion_tokens ?? 0)));
        }
        content = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
        const proposal = JSON.parse(content) as Record<string, unknown>;
        await secretDb.from(`ultron_${provider.id}_keys`).update({ status: "connected", request_count: Number(key.request_count ?? 0) + 1, tokens_used: Number(key.tokens_used ?? 0) + Math.max(0, usage), last_used_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), last_error: null, cooldown_until: null }).eq("id", key.id).eq("owner_id", ownerId);
        return { proposal, model: `${provider.id}:${model}` };
      } catch (error) {
        console.warn(`[ULTRON memory model ${provider.id}]`, error instanceof Error ? error.message : "provider_call_failed");
      }
    }
  }
  throw new Error("model_not_configured_or_free_quota_exhausted");
}
async function consolidateConversationMemory(db: ReturnType<typeof createClient>, ownerId: string, payload: Record<string, unknown>, secretDb: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  const localProposal = isObject(payload.proposal) && Array.isArray(payload.proposal.memories) ? payload.proposal : null;
  const modelAvailable = localProposal ? true : await hasAvailableCloudModel(secretDb, ownerId);
  const conversationId = typeof payload.conversation_id === "string" ? payload.conversation_id : "";
  if (!conversationId) {
    if (!modelAvailable) return { skipped: true, reason: "model_not_configured_or_free_quota_exhausted", memories_created: 0 };
    const { data: recent, error: recentError } = await db.from("ultron_conversations").select("id").eq("owner_id", ownerId).order("updated_at", { ascending: false }).limit(5);
    if (recentError) throw recentError;
    const results: Record<string, unknown>[] = [];
    for (const row of recent ?? []) results.push(await consolidateConversationMemory(db, ownerId, { conversation_id: row.id }, secretDb));
    return { conversations_processed: results.length, memories_created: results.reduce((sum, row) => sum + (Number(row.memories_created) || 0), 0), maintenance: true };
  }
  if (!localProposal && !modelAvailable) return { skipped: true, reason: "model_not_configured_or_free_quota_exhausted", conversation_id: conversationId, memories_created: 0 };
  const { data: conversation, error: conversationError } = await db.from("ultron_conversations").select("id,title,summary").eq("owner_id", ownerId).eq("id", conversationId).maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation) throw new Error("conversation_not_found");
  const { data: messages, error: messageError } = await db.from("ultron_messages").select("role,content,sequence_no,created_at").eq("owner_id", ownerId).eq("conversation_id", conversationId).eq("status", "complete").order("sequence_no", { ascending: true }).limit(80);
  if (messageError) throw messageError;
  if (!messages?.length) throw new Error("no_complete_messages");
  const watermark = Math.max(...messages.map((row) => Number(row.sequence_no) || 0));
  const sourceRef = "conversation:" + conversationId + ":" + watermark;
  const { data: duplicate, error: duplicateError } = await db.from("ultron_memory_items").select("id").eq("owner_id", ownerId).eq("source_ref", sourceRef).limit(1).maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return { deduplicated: true, source_ref: sourceRef, memories_created: 0 };
  const { data: existing, error: existingError } = await db.from("ultron_memory_items").select("id,memory_type,content,summary,importance,confidence").eq("owner_id", ownerId).is("archived_at", null).order("updated_at", { ascending: false }).limit(60);
  if (existingError) throw existingError;
  const transcript = messages.map((row) => String(row.role).toUpperCase() + ": " + redactMemorySecrets(String(row.content ?? "")).slice(0, 5000)).join("\n").slice(-42000);
  const memoryContext = (existing ?? []).map((row) => ({ id: row.id, type: row.memory_type, summary: typeof row.summary === "string" ? redactMemorySecrets(row.summary) : row.summary, content: redactMemorySecrets(String(row.content)).slice(0, 500) }));
  let proposal: Record<string, unknown>;
  let model: string;
  if (localProposal) {
    proposal = localProposal;
    model = typeof payload.model_id === "string" ? payload.model_id.slice(0, 120) : "on_device";
  } else {
    const generated = await generateMemoryProposal(secretDb, ownerId, [
      { role: "system", content: "You are ULTRON's long-term memory consolidation engine. Extract only durable, useful facts, preferences, decisions, goals, procedures, and relationship context. Ignore transient chatter, secrets, passwords, API keys, and unsupported inferences. Merge with existing memories instead of repeating them. Return JSON only: {summary:string, memories:[{memory_type:string,content:string,summary:string,importance:number,confidence:number,relations:[{target_id:string,relation_type:string,weight:number}]}]}. Use only allowed memory_type values: identity, preference, fact, episodic, semantic, goal, decision, procedure, relationship. At most 8 new memories. Existing memory ids may be used as relation targets." },
      { role: "user", content: JSON.stringify({ conversation: { title: conversation.title, existing_memories: memoryContext }, transcript }) },
    ]);
    model = generated.model;
    proposal = generated.proposal;
  }
  const rows = Array.isArray(proposal.memories) ? proposal.memories.slice(0, 8) : [];
  const allowed = new Set(["identity","preference","fact","episodic","semantic","goal","decision","procedure","relationship"]);
  const existingIds = new Set((existing ?? []).map((row) => String(row.id)));
  let created = 0, relationCount = 0;
  let merged = 0;
  for (const rawMemory of rows) {
    if (!isObject(rawMemory)) continue;
    const text = typeof rawMemory.content === "string" ? redactMemorySecrets(rawMemory.content).trim().slice(0, 12000) : "";
    if (text.length < 12) continue;
    const type = typeof rawMemory.memory_type === "string" && allowed.has(rawMemory.memory_type) ? rawMemory.memory_type : "semantic";
    const embedding = embedMemoryText(text);
    const { data: matches, error: matchError } = await secretDb.rpc("ultron_match_local_memories_system", { p_owner_id: ownerId, query_embedding: embedding, match_count: 5, min_similarity: 0.9 });
    if (matchError) throw matchError;
    const duplicate = (matches ?? []).find((row: Record<string, unknown>) => Number(row.similarity) >= 0.94 && typeof row.id === "string");
    let memoryId: string;
    if (duplicate) {
      memoryId = String(duplicate.id);
      existingIds.add(memoryId);
      const oldMetadata = isObject(duplicate.metadata) ? duplicate.metadata : {};
      const oldSources = Array.isArray(oldMetadata.consolidated_sources) ? oldMetadata.consolidated_sources.filter((value): value is string => typeof value === "string") : [];
      const nextSources = [...new Set([...oldSources, sourceRef])].slice(-24);
      const { error: updateError } = await db.from("ultron_memory_items").update({
        memory_type: type,
        content: text,
        local_embedding: embedding,
        summary: String(rawMemory.summary ?? text.slice(0, 300)).slice(0, 500),
        importance: Math.max(Number(duplicate.importance) || 1, Math.min(5, Math.round(Number(rawMemory.importance) || 3))),
        confidence: Math.max(Number(duplicate.confidence) || 0, Math.min(1, Number(rawMemory.confidence) || 0.8)),
        metadata: { ...oldMetadata, consolidated_sources: nextSources, last_consolidated_at: new Date().toISOString(), model },
      }).eq("owner_id", ownerId).eq("id", memoryId);
      if (updateError) throw updateError;
      merged++;
    } else {
      const { data: inserted, error: insertError } = await db.from("ultron_memory_items").insert({
        owner_id: ownerId, memory_type: type, content: text,
        summary: String(rawMemory.summary ?? text.slice(0, 300)).slice(0, 500),
        importance: Math.max(1, Math.min(5, Math.round(Number(rawMemory.importance) || 3))),
        confidence: Math.max(0, Math.min(1, Number(rawMemory.confidence) || 0.8)),
        source: "model_consolidation", source_ref: sourceRef, local_embedding: embedding,
        metadata: { model, conversation_id: conversationId, sequence_watermark: watermark, consolidation_version: 1 },
      }).select("id").single();
      if (insertError) throw insertError;
      memoryId = inserted.id;
      created++;
    }
    const relations = Array.isArray(rawMemory.relations) ? rawMemory.relations.slice(0, 6) : [];
    for (const rel of relations) {
      if (!isObject(rel) || typeof rel.target_id !== "string" || !existingIds.has(rel.target_id) || rel.target_id === memoryId) continue;
      const { error: relationError } = await db.from("ultron_memory_relations").upsert({
        owner_id: ownerId, source_memory_id: memoryId, target_memory_id: rel.target_id,
        relation_type: String(rel.relation_type ?? "related_to").slice(0, 60),
        weight: Math.max(0, Math.min(1, Number(rel.weight) || 0.7)),
      }, { onConflict: "owner_id,source_memory_id,target_memory_id,relation_type" });
      if (relationError) throw relationError;
      relationCount++;
    }
  }
  const summary = typeof proposal.summary === "string" ? redactMemorySecrets(proposal.summary).trim().slice(0, 3000) : "";
  if (summary) { const { error } = await db.from("ultron_conversations").update({ summary }).eq("owner_id", ownerId).eq("id", conversationId); if (error) throw error; }
  return { conversation_id: conversationId, source_ref: sourceRef, memories_created: created, memories_merged: merged, relations_created: relationCount, model, sequence_watermark: watermark };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !publishable || !serviceKey) return respond({ error: "server_configuration_missing" }, 500);
  const serviceDb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const key = publishable;
  const authorization = req.headers.get("Authorization") ?? "";
  const cronSecret = req.headers.get("x-ultron-cron-secret") ?? "";
  let db: ReturnType<typeof createClient>;
  let owner_id = "";
  let internalWorker = false;

  try {
    if (cronSecret) {
      const { data: expected, error: secretError } = await serviceDb.rpc("ultron_get_system_secret", { p_name: "ultron_brain_cron_secret" });
      if (secretError || typeof expected !== "string" || expected !== cronSecret) return respond({ error: "unauthorized_worker" }, 401);
      const { data: instance, error: ownerError } = await serviceDb.from("ultron_instance").select("owner_id").eq("id", true).maybeSingle();
      if (ownerError || !instance?.owner_id) return respond({ error: "owner_instance_required" }, 403);
      db = serviceDb; owner_id = instance.owner_id; internalWorker = true;
    } else {
      const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return respond({ error: "unauthorized" }, 401);
      const userDb = createClient(url, publishable, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: authData, error: authError } = await userDb.auth.getUser(token);
      const user = authData?.user;
      if (authError || !user) return respond({ error: "unauthorized" }, 401);
      const { data: owner, error: ownerError } = await userDb.from("ultron_instance").select("owner_id").eq("owner_id", user.id).maybeSingle();
      if (ownerError || !owner) return respond({ error: "owner_instance_required" }, 403);
      db = userDb; owner_id = user.id;
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 100_000) return respond({ error: "payload_too_large" }, 413);
    const body: unknown = JSON.parse(raw);
    if (!isObject(body) || typeof body.action !== "string") return respond({ error: "invalid_request" }, 400);
    if (internalWorker && body.action !== "process") return respond({ error: "worker_action_not_allowed" }, 403);

    if (body.action === "enqueue") {
      const job_type = String(body.job_type ?? "");
      const title = String(body.title ?? "");
      const payload = isObject(body.payload) ? body.payload : {};
      const priority = Math.max(-10, Math.min(10, Math.trunc(Number(body.priority) || 0)));
      const max_attempts = Math.max(1, Math.min(20, Math.trunc(Number(body.max_attempts) || 5)));
      const idempotency_key = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : null;
      if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(job_type) || !title.trim() || title.length > 180)
        return respond({ error: "invalid_job_metadata" }, 400);
      if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 64_000)
        return respond({ error: "job_payload_too_large" }, 413);
      if (idempotency_key !== null && (idempotency_key.length < 1 || idempotency_key.length > 160))
        return respond({ error: "invalid_idempotency_key" }, 400);

      const run_after = typeof body.run_after === "string" ? body.run_after : new Date().toISOString();
      if (Number.isNaN(Date.parse(run_after))) return respond({ error: "invalid_run_after" }, 400);
      const { data, error } = await db.from("ultron_jobs").insert({
        owner_id, job_type, title, payload, priority, max_attempts, idempotency_key, run_after,
      }).select("id,job_type,title,status,priority,run_after,attempts,max_attempts,created_at").single();
      if (error?.code === "23505" && idempotency_key) {
        const existing = await db.from("ultron_jobs").select("id,job_type,title,status,priority,run_after,attempts,max_attempts,created_at")
          .eq("owner_id", owner_id).eq("idempotency_key", idempotency_key).maybeSingle();
        if (existing.error) throw existing.error;
        return respond({ ok: true, deduplicated: true, job: existing.data });
      }
      if (error) throw error;
      return respond({ ok: true, deduplicated: false, job: data }, 201);
    }

    if (body.action === "list") {
      const limit = Math.max(1, Math.min(100, Math.trunc(Number(body.limit) || 50)));
      let query = db.from("ultron_jobs").select("id,job_type,title,payload,priority,status,run_after,attempts,max_attempts,heartbeat_at,lease_expires_at,result,error_message,created_at,updated_at,completed_at")
        .order("created_at", { ascending: false }).limit(limit);
      if (typeof body.status === "string") query = query.eq("status", body.status);
      const { data, error } = await query;
      if (error) throw error;
      return respond({ ok: true, jobs: data });
    }

    if (body.action === "claim") {
      const limit = Math.max(1, Math.min(5, Math.trunc(Number(body.limit) || 1)));
      const lease = Math.max(15, Math.min(300, Math.trunc(Number(body.lease_seconds) || 90)));
      const { data, error } = await db.rpc("ultron_claim_jobs", { p_limit: limit, p_lease_seconds: lease });
      if (error) throw error;
      return respond({ ok: true, jobs: data ?? [] });
    }

    if (body.action === "heartbeat" || body.action === "complete" || body.action === "fail") {
      const id = typeof body.id === "string" ? body.id : "";
      const lock_token = typeof body.lock_token === "string" ? body.lock_token : "";
      if (!id || !lock_token) return respond({ error: "job_id_and_lock_token_required" }, 400);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.action === "heartbeat") {
        const lease = Math.max(15, Math.min(300, Math.trunc(Number(body.lease_seconds) || 90)));
        patch.heartbeat_at = new Date().toISOString();
        patch.lease_expires_at = new Date(Date.now() + lease * 1000).toISOString();
      } else if (body.action === "complete") {
        patch.status = "completed";
        patch.result = isObject(body.result) ? body.result : {};
        patch.completed_at = new Date().toISOString();
        patch.lock_token = null;
        patch.lease_expires_at = null;
      } else {
        const { data: current, error: readError } = await db.from("ultron_jobs")
          .select("attempts,max_attempts").eq("owner_id", owner_id).eq("id", id)
          .eq("lock_token", lock_token).eq("status", "running").maybeSingle();
        if (readError) throw readError;
        if (!current) return respond({ error: "job_lease_not_found" }, 409);
        const exhausted = current.attempts >= current.max_attempts;
        const delay = Math.min(3600, 15 * (2 ** Math.max(0, current.attempts - 1)));
        patch.status = exhausted ? "failed" : "retry_wait";
        patch.run_after = new Date(Date.now() + delay * 1000).toISOString();
        patch.error_message = String(body.error ?? "job_failed").slice(0, 4000);
        patch.lock_token = null;
        patch.lease_expires_at = null;
        if (exhausted) patch.completed_at = new Date().toISOString();
      }
      const { data, error } = await db.from("ultron_jobs").update(patch)
        .eq("owner_id", owner_id).eq("id", id).eq("lock_token", lock_token).eq("status", "running")
        .select("id,status,attempts,max_attempts,run_after,heartbeat_at,completed_at").maybeSingle();
      if (error) throw error;
      if (!data) return respond({ error: "job_lease_not_found" }, 409);
      return respond({ ok: true, job: data });
    }

    if (body.action === "process") {
      const limit = Math.max(1, Math.min(5, Math.trunc(Number(body.limit) || 3)));
      const { data: claimed, error: claimError } = internalWorker
        ? await db.rpc("ultron_claim_jobs_system", { p_owner_id: owner_id, p_limit: limit, p_lease_seconds: 120 })
        : await db.rpc("ultron_claim_jobs", { p_limit: limit, p_lease_seconds: 120 });
      if (claimError) throw claimError;
      const outcomes: Array<Record<string, unknown>> = [];
      for (const job of claimed ?? []) {
        const started = Date.now();
        try {
          let result: Record<string, unknown>;
          if (job.job_type === "connector.tool.execute") {
            const response = await fetch(url + "/functions/v1/ultron-connectors", {
              method: "POST",
              headers: internalWorker
                ? { "x-ultron-cron-secret": cronSecret, "Content-Type": "application/json" }
                : { "Authorization": authorization, "apikey": key, "Content-Type": "application/json" },
              body: JSON.stringify({ action: "execute", ...(isObject(job.payload) ? job.payload : {}) }),
            });
            const data = await response.json() as Record<string, unknown>;
            if (!response.ok || data.ok !== true) throw new Error(String(data.message ?? data.error ?? "connector_tool_execution_failed"));
            result = data;
          } else if (job.job_type === "agent.workflow.execute") {
            const response = await fetch(url + "/functions/v1/ultron-runtime", {
              method: "POST",
              headers: internalWorker
                ? { "x-ultron-cron-secret": cronSecret, "Content-Type": "application/json" }
                : { "Authorization": authorization, "apikey": key, "Content-Type": "application/json" },
              body: JSON.stringify({ action: "run_tool", ...(isObject(job.payload) ? job.payload : {}) }),
            });
            const data = await response.json() as Record<string, unknown>;
            if (!response.ok || data.ok !== true) throw new Error(String(data.message ?? data.error ?? "workflow_execution_failed"));
            result = data;
          } else if (job.job_type === "maintenance.health_check") {
            const [queued, running, failed] = await Promise.all([
              db.from("ultron_jobs").select("id", { count: "exact", head: true }).eq("owner_id", owner_id).in("status", ["queued", "retry_wait"]),
              db.from("ultron_jobs").select("id", { count: "exact", head: true }).eq("owner_id", owner_id).eq("status", "running"),
              db.from("ultron_jobs").select("id", { count: "exact", head: true }).eq("owner_id", owner_id).eq("status", "failed"),
            ]);
            if (queued.error) throw queued.error;
            if (running.error) throw running.error;
            if (failed.error) throw failed.error;
            result = { healthy: true, queue: { queued: queued.count ?? 0, running: running.count ?? 0, failed: failed.count ?? 0 }, checked_at: new Date().toISOString() };
          } else if (job.job_type === "memory.consolidate") {
            result = await consolidateConversationMemory(db, owner_id, isObject(job.payload) ? job.payload : {}, serviceDb);
          } else {
            throw new Error("unsupported_job_type:" + String(job.job_type));
          }
          const { error: completeError } = await db.from("ultron_jobs").update({
            status: "completed", result, error_message: null, completed_at: new Date().toISOString(),
            lock_token: null, lease_expires_at: null, heartbeat_at: null, updated_at: new Date().toISOString(),
          }).eq("owner_id", owner_id).eq("id", job.id).eq("lock_token", job.lock_token).eq("status", "running");
          if (completeError) throw completeError;
          outcomes.push({ id: job.id, job_type: job.job_type, status: "completed", duration_ms: Date.now() - started });
        } catch (error) {
          const message = error instanceof Error ? error.message : "job_execution_failed";
          const terminal = /approval_required|unsupported_job_type|conversation_not_found|no_complete_messages/i.test(message);
          const attempts = Number(job.attempts ?? 1), maxAttempts = Number(job.max_attempts ?? 5);
          const exhausted = terminal || attempts >= maxAttempts;
          const delay = message.startsWith("model_not_configured") ? 3600 : Math.min(3600, 15 * (2 ** Math.max(0, attempts - 1)));
          const { error: failError } = await db.from("ultron_jobs").update({
            status: exhausted ? "failed" : "retry_wait",
            run_after: new Date(Date.now() + delay * 1000).toISOString(),
            error_message: message.slice(0, 4000), completed_at: exhausted ? new Date().toISOString() : null,
            lock_token: null, lease_expires_at: null, heartbeat_at: null, updated_at: new Date().toISOString(),
          }).eq("owner_id", owner_id).eq("id", job.id).eq("lock_token", job.lock_token).eq("status", "running");
          if (failError) throw failError;
          outcomes.push({ id: job.id, job_type: job.job_type, status: exhausted ? "failed" : "retry_wait", error: message.slice(0, 500) });
        }
      }
      return respond({ ok: true, processed: outcomes.length, outcomes });
    }

    if (body.action === "cancel") {
      if (typeof body.id !== "string") return respond({ error: "job_id_required" }, 400);
      const { data, error } = await db.from("ultron_jobs").update({
        status: "cancelled", lock_token: null, lease_expires_at: null, completed_at: new Date().toISOString(),
      }).eq("owner_id", owner_id).eq("id", body.id).in("status", ["queued", "retry_wait", "running"])
        .select("id,status,completed_at").maybeSingle();
      if (error) throw error;
      if (!data) return respond({ error: "job_not_cancellable" }, 409);
      return respond({ ok: true, job: data });
    }

    return respond({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    return respond({ error: "request_failed", message: message.slice(0, 400) }, 400);
  }
});
