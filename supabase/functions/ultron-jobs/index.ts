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
