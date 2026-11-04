import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordEvent(client: ReturnType<typeof createClient>, event: Record<string, unknown>): Promise<void> {
  const { error } = await client.from("ultron_capability_events").insert(event);
  if (error) throw error;
}

const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|private[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return response({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return response({ error: "server_configuration_missing" }, 500);

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(match[1]);
    const user = authData?.user;
    if (authError || !user) return response({ error: "unauthorized" }, 401);

    const { data: owner, error: ownerError } = await supabase
      .from("ultron_instance")
      .select("owner_id,display_name")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (ownerError || !owner) return response({ error: "owner_instance_required" }, 403);

    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 65536) return response({ error: "payload_too_large" }, 413);
    const body: unknown = JSON.parse(raw);
    if (!object(body) || typeof body.action !== "string") return response({ error: "invalid_request" }, 400);
    const owner_id = user.id;

    if (body.action === "status") {
      const [runs, tools, proposals] = await Promise.all([
        supabase.from("ultron_agent_runs").select("id", { count: "exact", head: true }),
        supabase.from("ultron_generated_tools").select("id", { count: "exact", head: true }),
        supabase.from("ultron_capability_proposals").select("id", { count: "exact", head: true }),
      ]);
      if (runs.error || tools.error || proposals.error) throw runs.error ?? tools.error ?? proposals.error;
      return response({
        ok: true, instance: owner.display_name,
        counts: { agent_runs: runs.count ?? 0, generated_tools: tools.count ?? 0, capability_proposals: proposals.count ?? 0 },
      });
    }

    if (body.action === "list") {
      const [runs, tools, proposals, events] = await Promise.all([
        supabase.from("ultron_agent_runs").select("*").order("updated_at", { ascending: false }).limit(50),
        supabase.from("ultron_generated_tools").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("ultron_capability_proposals").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("ultron_capability_events").select("*").order("created_at", { ascending: false }).limit(100),
      ]);
      if (runs.error || tools.error || proposals.error || events.error) throw runs.error ?? tools.error ?? proposals.error ?? events.error;
      return response({ ok: true, runs: runs.data, tools: tools.data, proposals: proposals.data, events: events.data });
    }

    if (body.action === "save_tool_draft") {
      const tool_key = String(body.tool_key ?? "");
      const version = String(body.version ?? "");
      const description = String(body.description ?? "");
      const source_code = String(body.source_code ?? "");
      const source_language = String(body.source_language ?? "python");
      const input_schema = body.input_schema;
      if (!/^[a-z][a-z0-9_]{1,47}$/.test(tool_key)) return response({ error: "invalid_tool_key" }, 400);
      if (!/^\d+\.\d+\.\d+$/.test(version)) return response({ error: "invalid_semver" }, 400);
      if (!description.trim() || description.length > 500) return response({ error: "invalid_description" }, 400);
      if (!source_code.trim() || new TextEncoder().encode(source_code).byteLength > 32768) return response({ error: "invalid_source_size" }, 400);
      if (source_language !== "python") return response({ error: "unsupported_source_language", supported: ["python"] }, 400);
      if (!object(input_schema) || input_schema.type !== "object") return response({ error: "input_schema_must_be_object" }, 400);
      if (SECRET_PATTERN.test(source_code)) return response({ error: "possible_secret_in_source" }, 400);
      const source_sha256 = await sha256(source_code);
      if (typeof body.source_sha256 === "string" && body.source_sha256 !== source_sha256) return response({ error: "source_hash_mismatch" }, 409);

      const { data, error } = await supabase.from("ultron_generated_tools").insert({
        owner_id, tool_key, version, description, input_schema, source_language,
        source_code, source_sha256, lifecycle_state: "draft",
        review_report: object(body.review_report) ? body.review_report : {},
      }).select("id,tool_key,version,source_sha256,lifecycle_state,created_at").single();
      if (error) throw error;
      await recordEvent(supabase, {
        owner_id, tool_id: data.id, event_type: "tool.draft_created",
        details: { tool_key, version, source_sha256 },
      });
      return response({ ok: true, tool: data }, 201);
    }

    if (body.action === "submit_tool") {
      if (typeof body.id !== "string" || typeof body.source_sha256 !== "string") return response({ error: "tool_id_and_hash_required" }, 400);
      const { data, error } = await supabase.from("ultron_generated_tools")
        .update({ lifecycle_state: "pending_approval" })
        .eq("id", body.id).eq("owner_id", owner_id).eq("source_sha256", body.source_sha256)
        .eq("lifecycle_state", "draft")
        .select("id,tool_key,version,source_sha256,lifecycle_state").maybeSingle();
      if (error) throw error;
      if (!data) return response({ error: "draft_not_found_or_hash_changed" }, 409);
      await recordEvent(supabase, {
        owner_id, tool_id: data.id, event_type: "tool.submitted_for_approval",
        details: { source_sha256: data.source_sha256 },
      });
      return response({ ok: true, tool: data });
    }

    if (body.action === "approve_tool") {
      if (body.owner_confirmation !== true || body.confirmation_phrase !== "APPROVE ULTRON TOOL") {
        return response({ error: "explicit_owner_confirmation_required" }, 403);
      }
      if (typeof body.id !== "string" || typeof body.source_sha256 !== "string") return response({ error: "tool_id_and_hash_required" }, 400);
      const { data, error } = await supabase.from("ultron_generated_tools")
        .update({ lifecycle_state: "approved", approved_by: owner_id, approved_at: new Date().toISOString() })
        .eq("id", body.id).eq("owner_id", owner_id).eq("source_sha256", body.source_sha256)
        .eq("lifecycle_state", "pending_approval")
        .select("id,tool_key,version,source_sha256,lifecycle_state,approved_at").maybeSingle();
      if (error) throw error;
      if (!data) return response({ error: "tool_not_pending_or_hash_changed" }, 409);
      await recordEvent(supabase, {
        owner_id, tool_id: data.id, event_type: "tool.owner_approved",
        details: { source_sha256: data.source_sha256 },
      });
      return response({ ok: true, tool: data, activation: "requires_verified_isolated_worker" });
    }

    if (body.action === "create_proposal") {
      const allowed = ["tool_activation", "edge_function", "database_migration", "connector", "policy_change", "runtime_upgrade"];
      const proposal_kind = String(body.proposal_kind ?? "");
      const title = String(body.title ?? "");
      const description = String(body.description ?? "");
      if (!allowed.includes(proposal_kind)) return response({ error: "invalid_proposal_kind" }, 400);
      if (!title.trim() || title.length > 180 || !description.trim() || description.length > 4000) return response({ error: "invalid_proposal_text" }, 400);
      const artifact = object(body.artifact) ? body.artifact : {};
      const artifact_sha256 = await sha256(JSON.stringify(artifact));
      const risk_level = ["low", "medium", "high", "critical"].includes(String(body.risk_level)) ? String(body.risk_level) : "medium";
      const { data, error } = await supabase.from("ultron_capability_proposals").insert({
        owner_id, agent_run_id: typeof body.agent_run_id === "string" ? body.agent_run_id : null,
        proposal_kind, title, description, artifact, artifact_sha256, risk_level, status: "pending",
      }).select("*").single();
      if (error) throw error;
      await recordEvent(supabase, {
        owner_id, agent_run_id: data.agent_run_id, proposal_id: data.id,
        event_type: "capability.proposed", details: { proposal_kind, risk_level, artifact_sha256 },
      });
      return response({ ok: true, proposal: data }, 201);
    }

    if (body.action === "resolve_proposal") {
      if (body.owner_confirmation !== true || body.confirmation_phrase !== "REVIEW ULTRON CHANGE") {
        return response({ error: "explicit_owner_confirmation_required" }, 403);
      }
      const decision = body.decision;
      if (!["approved", "rejected"].includes(String(decision))) return response({ error: "invalid_decision" }, 400);
      if (typeof body.id !== "string" || typeof body.artifact_sha256 !== "string") return response({ error: "proposal_id_and_hash_required" }, 400);
      const { data, error } = await supabase.from("ultron_capability_proposals")
        .update({ status: decision, approved_by: owner_id, approved_at: new Date().toISOString() })
        .eq("id", body.id).eq("owner_id", owner_id).eq("artifact_sha256", body.artifact_sha256)
        .eq("status", "pending").select("*").maybeSingle();
      if (error) throw error;
      if (!data) return response({ error: "proposal_not_pending_or_artifact_changed" }, 409);
      await recordEvent(supabase, {
        owner_id, agent_run_id: data.agent_run_id, proposal_id: data.id,
        event_type: "capability.owner_" + decision, details: { artifact_sha256: data.artifact_sha256 },
      });
      return response({ ok: true, proposal: data, applied: false });
    }

    if (body.action === "checkpoint_run") {
      const goal = String(body.goal ?? "");
      const id = typeof body.id === "string" ? body.id : crypto.randomUUID();
      const iteration = Number.isInteger(body.iteration) ? Number(body.iteration) : 0;
      const iteration_limit = Number.isInteger(body.iteration_limit) ? Number(body.iteration_limit) : 40;
      const tokens_used = Number.isInteger(body.tokens_used) ? Number(body.tokens_used) : 0;
      const token_budget = body.token_budget == null ? null : Number(body.token_budget);
      if (!goal.trim() || goal.length > 8000 || iteration < 0 || iteration_limit < 1 || iteration_limit > 1000 || iteration > iteration_limit || tokens_used < 0 || (token_budget !== null && (token_budget < 0 || tokens_used > token_budget))) {
        return response({ error: "invalid_run_checkpoint_or_budget_exceeded" }, 400);
      }
      const status = ["queued", "running", "waiting_approval", "paused", "completed", "failed", "cancelled"].includes(String(body.status)) ? String(body.status) : "running";
      const phase = String(body.phase ?? "planning").slice(0, 80);
      const checkpoint = object(body.checkpoint) ? body.checkpoint : {};
      const { data, error } = await supabase.from("ultron_agent_runs").upsert({
        id, owner_id, goal, status, phase, iteration, iteration_limit, tokens_used, token_budget, checkpoint,
        heartbeat_at: new Date().toISOString(),
        started_at: status === "queued" ? null : new Date().toISOString(),
        completed_at: ["completed", "failed", "cancelled"].includes(status) ? new Date().toISOString() : null,
        result: object(body.result) ? body.result : null,
        error_message: typeof body.error_message === "string" ? body.error_message.slice(0, 2000) : null,
      }, { onConflict: "id" }).select("*").single();
      if (error) throw error;
      await recordEvent(supabase, {
        owner_id, agent_run_id: data.id, event_type: "agent_run.checkpoint",
        details: { phase, iteration, status },
      });
      return response({ ok: true, run: data });
    }

    if (body.action === "disable_tool") {
      if (typeof body.id !== "string") return response({ error: "tool_id_required" }, 400);
      const { data, error } = await supabase.from("ultron_generated_tools")
        .update({ lifecycle_state: "disabled" }).eq("id", body.id).eq("owner_id", owner_id)
        .in("lifecycle_state", ["approved", "active"])
        .select("id,tool_key,version,lifecycle_state").maybeSingle();
      if (error) throw error;
      if (!data) return response({ error: "tool_not_disableable" }, 409);
      await recordEvent(supabase, {
        owner_id, tool_id: data.id, event_type: "tool.disabled", details: {},
      });
      return response({ ok: true, tool: data });
    }

    return response({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    return response({ error: "request_failed", message: message.slice(0, 500) }, 400);
  }
});
