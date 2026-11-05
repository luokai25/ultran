import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
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
async function consolidateConversationMemory(db: ReturnType<typeof createClient>, ownerId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("ULTRON_MODEL_API_KEY");
  if (!apiKey) throw new Error("model_not_configured: set ULTRON_MODEL_API_KEY to enable cloud memory consolidation");
  const conversationId = typeof payload.conversation_id === "string" ? payload.conversation_id : "";
  if (!conversationId) throw new Error("conversation_id_required");
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
  const transcript = messages.map((row) => String(row.role).toUpperCase() + ": " + String(row.content ?? "").slice(0, 5000)).join("\n").slice(-42000);
  const memoryContext = (existing ?? []).map((row) => ({ id: row.id, type: row.memory_type, summary: row.summary, content: String(row.content).slice(0, 500) }));
  const baseUrl = (Deno.env.get("ULTRON_MODEL_BASE_URL") ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : baseUrl + "/chat/completions";
  const model = Deno.env.get("ULTRON_MODEL_ID") ?? "llama-3.3-70b-versatile";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, temperature: 0.1, max_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are ULTRON's long-term memory consolidation engine. Extract only durable, useful facts, preferences, decisions, goals, procedures, and relationship context. Ignore transient chatter, secrets, passwords, API keys, and unsupported inferences. Merge with existing memories instead of repeating them. Return JSON only: {summary:string, memories:[{memory_type:string,content:string,summary:string,importance:number,confidence:number,relations:[{target_id:string,relation_type:string,weight:number}]}]}. Use only allowed memory_type values: identity, preference, fact, episodic, semantic, goal, decision, procedure, relationship. At most 8 new memories. Existing memory ids may be used as relation targets." },
        { role: "user", content: JSON.stringify({ conversation: { title: conversation.title, existing_memories: memoryContext }, transcript }) },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error("memory_model_http_" + response.status + ":" + raw.slice(0, 500));
  const envelope = JSON.parse(raw) as Record<string, unknown>;
  const choices = Array.isArray(envelope.choices) ? envelope.choices as Array<Record<string, unknown>> : [];
  const message = choices[0]?.message as Record<string, unknown> | undefined;
  let content = typeof message?.content === "string" ? message.content : "";
  content = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const proposal = JSON.parse(content) as Record<string, unknown>;
  const rows = Array.isArray(proposal.memories) ? proposal.memories.slice(0, 8) : [];
  const allowed = new Set(["identity","preference","fact","episodic","semantic","goal","decision","procedure","relationship"]);
  const existingIds = new Set((existing ?? []).map((row) => String(row.id)));
  let created = 0, relationCount = 0;
  for (const rawMemory of rows) {
    if (!isObject(rawMemory)) continue;
    const text = typeof rawMemory.content === "string" ? rawMemory.content.trim().slice(0, 12000) : "";
    if (text.length < 12) continue;
    const type = typeof rawMemory.memory_type === "string" && allowed.has(rawMemory.memory_type) ? rawMemory.memory_type : "semantic";
    const { data: inserted, error: insertError } = await db.from("ultron_memory_items").insert({
      owner_id: ownerId, memory_type: type, content: text,
      summary: String(rawMemory.summary ?? text.slice(0, 300)).slice(0, 500),
      importance: Math.max(1, Math.min(5, Math.round(Number(rawMemory.importance) || 3))),
      confidence: Math.max(0, Math.min(1, Number(rawMemory.confidence) || 0.8)),
      source: "model_consolidation", source_ref: sourceRef, local_embedding: embedMemoryText(text),
      metadata: { model, conversation_id: conversationId, sequence_watermark: watermark, consolidation_version: 1 },
    }).select("id").single();
    if (insertError) throw insertError;
    created++;
    const relations = Array.isArray(rawMemory.relations) ? rawMemory.relations.slice(0, 6) : [];
    for (const rel of relations) {
      if (!isObject(rel) || typeof rel.target_id !== "string" || !existingIds.has(rel.target_id)) continue;
      const { error: relationError } = await db.from("ultron_memory_relations").insert({
        owner_id: ownerId, source_memory_id: inserted.id, target_memory_id: rel.target_id,
        relation_type: String(rel.relation_type ?? "related_to").slice(0, 60),
        weight: Math.max(0, Math.min(1, Number(rel.weight) || 0.7)),
      });
      if (relationError) throw relationError;
      relationCount++;
    }
  }
  const summary = typeof proposal.summary === "string" ? proposal.summary.trim().slice(0, 3000) : "";
  if (summary) { const { error } = await db.from("ultron_conversations").update({ summary }).eq("owner_id", ownerId).eq("id", conversationId); if (error) throw error; }
  return { conversation_id: conversationId, source_ref: sourceRef, memories_created: created, relations_created: relationCount, model, sequence_watermark: watermark };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return respond({ error: "server_configuration_missing" }, 500);

  const db = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { data: authData, error: authError } = await db.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return respond({ error: "unauthorized" }, 401);
    const { data: owner, error: ownerError } = await db.from("ultron_instance")
      .select("owner_id").eq("owner_id", user.id).maybeSingle();
    if (ownerError || !owner) return respond({ error: "owner_instance_required" }, 403);

    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 100_000) return respond({ error: "payload_too_large" }, 413);
    const body: unknown = JSON.parse(raw);
    if (!isObject(body) || typeof body.action !== "string") return respond({ error: "invalid_request" }, 400);
    const owner_id = user.id;

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
      const { data: claimed, error: claimError } = await db.rpc("ultron_claim_jobs", { p_limit: limit, p_lease_seconds: 120 });
      if (claimError) throw claimError;
      const outcomes: Array<Record<string, unknown>> = [];
      for (const job of claimed ?? []) {
        const started = Date.now();
        try {
          let result: Record<string, unknown>;
          if (job.job_type === "connector.tool.execute") {
            const response = await fetch(url + "/functions/v1/ultron-connectors", {
              method: "POST",
              headers: { "Authorization": authorization, "apikey": key, "Content-Type": "application/json" },
              body: JSON.stringify({ action: "execute", ...(isObject(job.payload) ? job.payload : {}) }),
            });
            const data = await response.json() as Record<string, unknown>;
            if (!response.ok || data.ok !== true) throw new Error(String(data.message ?? data.error ?? "connector_tool_execution_failed"));
            result = data;
          } else if (job.job_type === "agent.workflow.execute") {
            const response = await fetch(url + "/functions/v1/ultron-runtime", {
              method: "POST",
              headers: { "Authorization": authorization, "apikey": key, "Content-Type": "application/json" },
              body: JSON.stringify({ action: "run_tool", ...(isObject(job.payload) ? job.payload : {}) }),
            });
            const data = await response.json() as Record<string, unknown>;
            if (!response.ok || data.ok !== true) throw new Error(String(data.message ?? data.error ?? "workflow_execution_failed"));
            result = data;
          } else if (job.job_type === "memory.consolidate") {
            result = await consolidateConversationMemory(db, owner_id, isObject(job.payload) ? job.payload : {});
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
