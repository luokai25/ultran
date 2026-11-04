import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2,"0")).join("");
const slug = /^[a-z][a-z0-9_]{1,63}$/;
const semver = /^\d+\.\d+\.\d+$/;
const OPS = new Set(["text.template","json.pick","http.request","memory.search","memory.save","database.select","database.insert","database.update"]);
const READ_TABLES = new Set(["ultron_tasks","ultron_conversations","ultron_messages","ultron_memory_items","ultron_documents","ultron_skills","ultron_tool_specs","ultron_tool_runs","ultron_model_profiles","ultron_settings","ultron_capability_events","ultron_generated_tools","ultron_capability_proposals","ultron_agent_runs"]);
const INSERT_TABLES = new Set(["ultron_tasks","ultron_memory_items","ultron_memory_relations"]);
const UPDATE_TABLES = new Set(["ultron_tasks","ultron_memory_items","ultron_settings","ultron_model_profiles"]);
const CATALOG = [
  { id:"http.request",category:"internet",runtime:"supabase",description:"Call public HTTPS APIs and websites; GET, POST, PUT, PATCH or DELETE." },
  { id:"database.select",category:"data",runtime:"supabase",description:"Read owner-scoped ULTRON data tables." },
  { id:"database.insert",category:"data",runtime:"supabase",description:"Create owner-scoped tasks and memory records." },
  { id:"database.update",category:"data",runtime:"supabase",description:"Update owner-scoped tasks, settings and model profiles." },
  { id:"memory.search",category:"memory",runtime:"supabase",description:"Search persistent long-term memory by shared 96-dimensional semantic vectors." },
  { id:"memory.save",category:"memory",runtime:"supabase",description:"Write a persistent memory item." },
  { id:"text.template",category:"transform",runtime:"supabase",description:"Compose text from input and earlier step results." },
  { id:"json.pick",category:"transform",runtime:"supabase",description:"Select a value from JSON input or earlier results." },
  { id:"runtime.exec",category:"device",runtime:"android",description:"Run commands in the phone's local Termux-compatible workspace." },
  { id:"phone.app.open",category:"device",runtime:"android",description:"Open Android applications." },
  { id:"phone.notifications",category:"device",runtime:"android",description:"Post Android notifications and task alerts." },
  { id:"phone.voice",category:"device",runtime:"android",description:"Use local speech and background voice capabilities." },
  { id:"local.inference",category:"ai",runtime:"android",description:"Run downloaded on-device models without internet." },
  { id:"cloud.memory",category:"memory",runtime:"supabase",description:"Persistent searchable memory shared by every model." },
  { id:"cloud.skills",category:"skills",runtime:"supabase",description:"Versioned skills created, revised and reused by ULTRON." },
  { id:"cloud.tool_registry",category:"tools",runtime:"supabase",description:"Create, version, run, inspect and archive ULTRON-authored workflow tools." },
];
const MEMORY_STOP = new Set("the a an and or but if then than this that these those with from into about for to of in on at by as is are was were be been it its i me my we our you your what why how when where which can could should would do does did have has had please help want need make build create use using now next continue more same all every also just very really".split(" "));
function memoryHash(value: string): number { let h=2166136261; for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619); return h>>>0; }
function embedMemoryText(text: string): number[] {
  const tokens=(text.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu)??[]).filter(term=>!MEMORY_STOP.has(term)).slice(0,240);
  const vector=Array.from({length:96},()=>0);
  const features=[...tokens,...tokens.slice(0,-1).map((token,index)=>token+"_"+tokens[index+1])];
  for(const feature of features){const value=memoryHash(feature),index=value%96;vector[index]=(vector[index]??0)+((value&0x100)===0?1:-1);}
  const norm=Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0));
  return norm?vector.map(value=>value/norm):vector;
}
function getPath(value: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/,"").split(".").filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
function resolveValue(value: unknown, input: Record<string, unknown>, results: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const direct = value.match(/^\$(input|steps\.[a-z][a-z0-9_-]*)(?:\.(.+))?$/);
    if (direct) {
      if (direct[1] === "input") return getPath(input, direct[2] ?? "");
      const [stepId, ...path] = (direct[1] + (direct[2] ? "." + direct[2] : "")).split(".").slice(1);
      return getPath(results[stepId] ?? {}, path.join("."));
    }
    return value.replace(/\{\{\s*(input|steps\.[a-z][a-z0-9_-]*)(?:\.([a-zA-Z0-9_.-]+))?\s*\}\}/g, (_match, root: string, path: string | undefined) => {
      const value = root === "input" ? getPath(input, path ?? "") : (() => { const [id,...rest]=root.split("."); return getPath(results[id] ?? {}, [ ...(rest.length ? rest : []), ...(path ? path.split(".") : []) ].join(".")); })();
      return value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    });
  }
  if (Array.isArray(value)) return value.map(v => resolveValue(v,input,results));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveValue(v,input,results)]));
  return value;
}
function validateWorkflow(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return false;
  const ids = new Set<string>();
  return value.every(step => {
    if (!isObject(step) || typeof step.id !== "string" || !/^[a-z][a-z0-9_-]{1,47}$/.test(step.id) || ids.has(step.id) || typeof step.op !== "string" || !OPS.has(step.op) || !isObject(step.params ?? {})) return false;
    ids.add(step.id); return true;
  });
}
function validateInput(schema: Record<string, unknown>, input: Record<string, unknown>): string | null {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === "string") : [];
  for (const key of required) if (!(key in input)) return "Missing required input: " + key;
  for (const [key,value] of Object.entries(input)) {
    if (schema.additionalProperties === false && !(key in properties)) return "Unexpected input: " + key;
    const spec = properties[key];
    if (!isObject(spec) || typeof spec.type !== "string") continue;
    const ok = spec.type === "string" ? typeof value === "string"
      : spec.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : spec.type === "integer" ? Number.isInteger(value)
      : spec.type === "boolean" ? typeof value === "boolean"
      : spec.type === "array" ? Array.isArray(value)
      : spec.type === "object" ? isObject(value) : true;
    if (!ok) return "Invalid type for input: " + key;
  }
  return null;
}
function validatePublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("http.request only supports HTTP or HTTPS URLs.");
  if (url.username || url.password) throw new Error("URL credentials are not supported.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
      host === "metadata.google.internal" || host === "169.254.169.254" ||
      /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    throw new Error("Private and loopback network addresses are not available to generated tools.");
  }
  return url;
}
async function runStep(step: Record<string, unknown>, input: Record<string, unknown>, results: Record<string, unknown>, db: ReturnType<typeof createClient>, ownerId: string): Promise<unknown> {
  const op = String(step.op);
  const params = resolveValue(isObject(step.params) ? step.params : {}, input, results) as Record<string, unknown>;
  if (op === "text.template") {
    if (typeof params.template !== "string" || params.template.length > 20000) throw new Error("text.template requires a template under 20 KB.");
    return params.template.replace(/\{\{\s*(input|steps\.[a-z][a-z0-9_-]*)(?:\.([a-zA-Z0-9_.-]+))?\s*\}\}/g, (_m, root: string, path: string | undefined) => {
      const value = root === "input" ? getPath(input,path??"") : (()=>{const [id,...rest]=root.split(".");return getPath(results[id]??{},[...rest,...(path?path.split("."):[])].join("."));})();
      return value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    });
  }
  if (op === "json.pick") {
    const source = params.from === undefined ? "$input" : params.from;
    const resolved = typeof source === "string" && source === "$input" ? input : resolveValue(source,input,results);
    const picked = getPath(resolved, String(params.path ?? ""));
    return picked === undefined ? null : picked;
  }
  if (op === "http.request") {
    const url = validatePublicUrl(String(params.url ?? ""));
    const method = String(params.method ?? "GET").toUpperCase();
    if (!["GET","POST","PUT","PATCH","DELETE"].includes(method)) throw new Error("Unsupported HTTP method.");
    const headersIn = isObject(params.headers) ? params.headers : {};
    const outgoing = new Headers();
    for (const [key,value] of Object.entries(headersIn)) {
      if (typeof value !== "string" || /^(authorization|cookie|host|connection|content-length)$/i.test(key)) throw new Error("Generated HTTP tools cannot embed credentials or transport headers.");
      outgoing.set(key,value);
    }
    let body: string | undefined;
    if (method !== "GET" && method !== "DELETE" && params.body !== undefined) {
      body = typeof params.body === "string" ? params.body : JSON.stringify(params.body);
      if (body.length > 100000) throw new Error("HTTP request body exceeds 100 KB.");
      if (!outgoing.has("content-type")) outgoing.set("content-type","application/json");
    }
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), Math.min(15000,Math.max(1000,Number(params.timeout_ms)||10000)));
    try {
      const response = await fetch(url,{method,headers:outgoing,body,signal:controller.signal,redirect:"manual"});
      const text = await response.text();
      if (text.length > 200000) throw new Error("HTTP response exceeded 200 KB.");
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* plain text response */ }
      return { ok:response.ok,status:response.status,url:response.url,headers:Object.fromEntries(response.headers.entries()),body:parsed };
    } finally { clearTimeout(timeout); }
  }
  if (op === "memory.search") {
    const query = String(params.query ?? "").trim();
    if (!query) throw new Error("memory.search requires a query.");
    const {data,error}=await db.rpc("ultron_match_local_memories",{query_embedding:embedMemoryText(query),match_count:Math.min(20,Math.max(1,Number(params.limit)||8)),min_similarity:0.08});
    if(error)throw error;return data;
  }
  if (op === "memory.save") {
    const content=String(params.content??"").trim(); if(!content||content.length>12000)throw new Error("memory.save requires content up to 12 KB.");
    const memoryType=String(params.memory_type??"semantic"); const allowedTypes=new Set(["identity","preference","fact","episodic","semantic","goal","decision","procedure","relationship"]);
    const {data,error}=await db.from("ultron_memory_items").insert({owner_id:ownerId,memory_type:allowedTypes.has(memoryType)?memoryType:"semantic",content,summary:String(params.summary??content.slice(0,300)).slice(0,500),importance:Math.max(1,Math.min(5,Math.round(Number(params.importance)||3))),confidence:Math.max(0,Math.min(1,Number(params.confidence)||0.8)),source:"generated_tool",source_ref:String(params.source_ref??"").slice(0,300)||null,local_embedding:embedMemoryText(content),metadata:isObject(params.metadata)?params.metadata:{}}).select("id,memory_type,summary,importance,confidence,created_at").single();
    if(error)throw error;return data;
  }
  if (op === "database.select" || op === "database.insert" || op === "database.update") {
    const table=String(params.table??"");
    const allowed=op==="database.select"?READ_TABLES:op==="database.insert"?INSERT_TABLES:UPDATE_TABLES;
    if(!allowed.has(table))throw new Error("Table is not available to generated tools: "+table);
    if(op==="database.select"){
      const columns=String(params.columns??"*");if(!/^(\*|[a-zA-Z0-9_, ]{1,500})$/.test(columns))throw new Error("Invalid select columns.");
      let query=db.from(table).select(columns);
      if(isObject(params.filters))for(const [key,value]of Object.entries(params.filters)){if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)||!(["string","number","boolean"].includes(typeof value)))throw new Error("Invalid database filter.");query=query.eq(key,value);}
      const {data,error}=await query.limit(Math.min(50,Math.max(1,Number(params.limit)||20)));if(error)throw error;return data;
    }
    if(op==="database.insert"){
      if(!isObject(params.data))throw new Error("database.insert requires an object payload.");
      const row={...params.data,owner_id:ownerId};const {data,error}=await db.from(table).insert(row).select("*").single();if(error)throw error;return data;
    }
    if(!isObject(params.data)||!isObject(params.filters)||!Object.keys(params.filters).length)throw new Error("database.update requires data and at least one equality filter.");
    const data={...params.data};delete data.owner_id;delete data.id;
    let query=db.from(table).update(data).eq("owner_id",ownerId);
    for(const [key,value]of Object.entries(params.filters)){if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)||!(["string","number","boolean"].includes(typeof value)))throw new Error("Invalid database filter.");query=query.eq(key,value);}
    const {data:updated,error}=await query.select("*").limit(20);if(error)throw error;return updated;
  }
  throw new Error("Unsupported workflow operation: "+op);
}

Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
  const auth=req.headers.get("Authorization")??"";
  const token=auth.match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply({error:"unauthorized"},401);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??Deno.env.get("SUPABASE_ANON_KEY");
  if(!url||!key)return reply({error:"server_configuration_missing"},500);
  const db=createClient(url,key,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  try{
    const {data:authData,error:authError}=await db.auth.getUser(token);const user=authData?.user;
    if(authError||!user)return reply({error:"unauthorized"},401);
    const {data:owner,error:ownerError}=await db.from("ultron_instance").select("owner_id").eq("owner_id",user.id).maybeSingle();
    if(ownerError||!owner)return reply({error:"owner_instance_required"},403);
    const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>100000)return reply({error:"payload_too_large"},413);
    const body:unknown=JSON.parse(raw);if(!isObject(body)||typeof body.action!=="string")return reply({error:"invalid_request"},400);
    const owner_id=user.id, action=body.action;
    if(action==="search_memory"){
      const vector=Array.isArray(body.query_embedding)?body.query_embedding.map(Number):embedMemoryText(String(body.query??""));
      if(vector.length!==96||vector.some(value=>!Number.isFinite(value)))return reply({error:"query_embedding_must_have_96_finite_values"},400);
      const {data,error}=await db.rpc("ultron_match_local_memories",{query_embedding:vector,match_count:Math.min(20,Math.max(1,Number(body.limit)||8)),min_similarity:Math.max(0,Math.min(1,Number(body.min_similarity)||0.08))});
      if(error)throw error;return reply({ok:true,matches:data});
    }
    if(action==="catalog")return reply({ok:true,tools:CATALOG,workflow_operations:CATALOG.filter(x=>OPS.has(x.id))});
    if(action==="list_tools"){
      const {data,error}=await db.from("ultron_tool_specs").select("id,tool_key,version,title,description,input_schema,workflow,workflow_sha256,lifecycle_state,created_by,run_count,last_run_at,last_run_status,created_at,updated_at").order("updated_at",{ascending:false}).limit(100);
      if(error)throw error;return reply({ok:true,tools:data});
    }
    if(action==="create_tool"){
      const tool_key=String(body.tool_key??""),version=String(body.version??""),title=String(body.title??""),description=String(body.description??"");
      if(!slug.test(tool_key)||!semver.test(version)||!title.trim()||title.length>140||!description.trim()||description.length>1200)return reply({error:"invalid_tool_metadata"},400);
      if(!validateWorkflow(body.workflow))return reply({error:"invalid_workflow",supported_operations:[...OPS],max_steps:30},400);
      const input_schema=isObject(body.input_schema)?body.input_schema:{type:"object",properties:{},additionalProperties:false};
      if(input_schema.type!=="object")return reply({error:"input_schema_must_be_object"},400);
      const workflow_sha256=await sha256(JSON.stringify(body.workflow));
      if(typeof body.workflow_sha256==="string"&&body.workflow_sha256!==workflow_sha256)return reply({error:"workflow_hash_mismatch"},409);
      const {data,error}=await db.from("ultron_tool_specs").insert({owner_id,tool_key,version,title,description,input_schema,workflow:body.workflow,workflow_sha256,lifecycle_state:"active",created_by:"ultron"}).select("*").single();
      if(error)throw error;
      await db.from("ultron_capability_events").insert({owner_id,event_type:"tool_spec.created",tool_id:null,details:{tool_key,version,workflow_sha256,steps:body.workflow.length}});
      return reply({ok:true,tool:data,execution:"active"});
    }
    if(action==="archive_tool"){
      if(typeof body.id!=="string")return reply({error:"tool_id_required"},400);
      const {data,error}=await db.from("ultron_tool_specs").update({lifecycle_state:"archived"}).eq("owner_id",owner_id).eq("id",body.id).select("id,tool_key,version,lifecycle_state").maybeSingle();
      if(error)throw error;if(!data)return reply({error:"tool_not_found"},404);
      await db.from("ultron_capability_events").insert({owner_id,event_type:"tool_spec.archived",details:{tool_key:data.tool_key,version:data.version}});
      return reply({ok:true,tool:data});
    }
    if(action==="run_tool"){
      const tool_key=String(body.tool_key??"");if(!slug.test(tool_key))return reply({error:"invalid_tool_key"},400);
      const {data:tool,error:toolError}=await db.from("ultron_tool_specs").select("*").eq("owner_id",owner_id).eq("tool_key",tool_key).eq("lifecycle_state","active").order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(toolError)throw toolError;if(!tool)return reply({error:"active_tool_not_found"},404);
      if(await sha256(JSON.stringify(tool.workflow))!==tool.workflow_sha256)return reply({error:"workflow_integrity_mismatch"},409);
      const input=isObject(body.input)?body.input:{};
      const inputError=validateInput(isObject(tool.input_schema)?tool.input_schema:{},input);if(inputError)return reply({error:"invalid_tool_input",message:inputError},400);
      const {data:run,error:runError}=await db.from("ultron_tool_runs").insert({owner_id,tool_key:"ultron."+tool_key,status:"running",input,metadata:{tool_spec_id:tool.id,version:tool.version,workflow_sha256:tool.workflow_sha256}}).select("id").single();
      if(runError)throw runError;
      const started=Date.now(),results:Record<string,unknown>={};
      try{
        for(const step of tool.workflow as Array<Record<string,unknown>>){if(Date.now()-started>45000)throw new Error("Tool execution exceeded the 45-second workflow budget.");results[String(step.id)]=await runStep(step,input,results,db,owner_id);}
        const output={tool_key,version:tool.version,steps:results};
        await db.from("ultron_tool_runs").update({status:"succeeded",output,finished_at:new Date().toISOString(),metadata:{tool_spec_id:tool.id,version:tool.version,workflow_sha256:tool.workflow_sha256,latency_ms:Date.now()-started}}).eq("id",run.id).eq("owner_id",owner_id);
        await db.from("ultron_tool_specs").update({run_count:Number(tool.run_count??0)+1,last_run_at:new Date().toISOString(),last_run_status:"succeeded"}).eq("id",tool.id).eq("owner_id",owner_id);
        await db.from("ultron_capability_events").insert({owner_id,event_type:"tool_spec.run_succeeded",details:{tool_key,version,run_id:run.id,latency_ms:Date.now()-started}});
        return reply({ok:true,run_id:run.id,tool_key,version,output});
      }catch(error){
        const message=error instanceof Error?error.message:"tool_execution_failed";
        await db.from("ultron_tool_runs").update({status:"failed",error_message:message.slice(0,2000),finished_at:new Date().toISOString(),metadata:{tool_spec_id:tool.id,version:tool.version,latency_ms:Date.now()-started}}).eq("id",run.id).eq("owner_id",owner_id);
        await db.from("ultron_tool_specs").update({run_count:Number(tool.run_count??0)+1,last_run_at:new Date().toISOString(),last_run_status:"failed"}).eq("id",tool.id).eq("owner_id",owner_id);
        await db.from("ultron_capability_events").insert({owner_id,event_type:"tool_spec.run_failed",details:{tool_key,version,run_id:run.id,error:message.slice(0,500)}});
        return reply({ok:false,run_id:run.id,tool_key,version,error:message},422);
      }
    }
    if(action==="list_tool_runs"){
      const {data,error}=await db.from("ultron_tool_runs").select("id,tool_key,status,input,output,error_message,requested_at,finished_at,metadata").like("tool_key","ultron.%").order("requested_at",{ascending:false}).limit(100);
      if(error)throw error;return reply({ok:true,runs:data});
    }
    if(action==="list_skills"){
      const {data,error}=await db.from("ultron_skills").select("id,skill_key,version,title,description,triggers,instructions,evidence,confidence,verified_runs,status,source,usage_count,last_used_at,created_at,updated_at").in("status",["active","provisional"]).order("updated_at",{ascending:false}).limit(200);
      if(error)throw error;return reply({ok:true,skills:data});
    }
    if(action==="save_skill"){
      const skill_key=String(body.skill_key??""),version=String(body.version??""),title=String(body.title??""),description=String(body.description??"");
      const triggers=Array.isArray(body.triggers)?body.triggers.filter((x):x is string=>typeof x==="string").slice(0,20):[];
      const instructions=Array.isArray(body.instructions)?body.instructions.filter((x):x is string=>typeof x==="string").slice(0,16):[];
      if(!slug.test(skill_key)||!semver.test(version)||!title.trim()||title.length>140||description.length>800||instructions.length<2||instructions.some(x=>!x.trim()||x.length>1000))return reply({error:"invalid_skill"},400);
      const status=body.status==="provisional"?"provisional":"active";
      const {data,error}=await db.from("ultron_skills").insert({owner_id,skill_key,version,title,description,triggers,instructions,evidence:isObject(body.evidence)?body.evidence:{},confidence:Math.max(0,Math.min(1,Number(body.confidence)||0.7)),verified_runs:Math.max(0,Math.floor(Number(body.verified_runs)||0)),status,source:body.source==="distilled"?"distilled":"agent_created"}).select("*").single();
      if(error)throw error;
      await db.from("ultron_capability_events").insert({owner_id,event_type:"skill.created",details:{skill_key,version,status}});
      return reply({ok:true,skill:data});
    }
    if(action==="archive_skill"){
      if(typeof body.id!=="string")return reply({error:"skill_id_required"},400);
      const {data,error}=await db.from("ultron_skills").update({status:"archived"}).eq("owner_id",owner_id).eq("id",body.id).select("id,skill_key,version,status").maybeSingle();
      if(error)throw error;if(!data)return reply({error:"skill_not_found"},404);
      await db.from("ultron_capability_events").insert({owner_id,event_type:"skill.archived",details:{skill_key:data.skill_key,version:data.version}});
      return reply({ok:true,skill:data});
    }
    if(action==="record_skill_use"){
      if(typeof body.id!=="string")return reply({error:"skill_id_required"},400);
      const {data:skill,error:readError}=await db.from("ultron_skills").select("usage_count").eq("owner_id",owner_id).eq("id",body.id).maybeSingle();
      if(readError)throw readError;if(!skill)return reply({error:"skill_not_found"},404);
      const {data,error}=await db.from("ultron_skills").update({usage_count:Number(skill.usage_count??0)+1,last_used_at:new Date().toISOString()}).eq("owner_id",owner_id).eq("id",body.id).select("id,usage_count,last_used_at").single();
      if(error)throw error;return reply({ok:true,skill:data});
    }
    return reply({error:"unknown_action"},400);
  }catch(error){
    const message=error instanceof Error?error.message:"request_failed";
    return reply({error:"request_failed",message:message.slice(0,500)},400);
  }
});
