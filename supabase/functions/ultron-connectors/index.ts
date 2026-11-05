import { createClient } from "npm:@supabase/supabase-js@2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-ultron-cron-secret","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const str=(v:unknown,n=160)=>typeof v==="string"?v.trim().slice(0,n):"";
async function kickDurableWorker(url:string,authorization:string,publishableKey:string):Promise<Record<string,unknown>>{
 try{
  const response=await fetch(url+"/functions/v1/ultron-jobs",{method:"POST",headers:{"Authorization":authorization,"apikey":publishableKey,"Content-Type":"application/json"},body:JSON.stringify({action:"process",limit:1}),signal:AbortSignal.timeout(25000)});
  const raw=await response.text();let data:unknown={};try{data=raw?JSON.parse(raw):{};}catch{data={};}
  return {triggered:response.ok,response_status:response.status,...(obj(data)?data:{})};
 }catch(error){return {triggered:false,deferred:true,reason:error instanceof Error?error.message:"worker_kick_failed"};}
}
async function composio(path:string,key:string,method="GET",body?:unknown){
 const r=await fetch("https://backend.composio.dev/api/v3.1"+path,{method,headers:{"x-api-key":key,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await r.text();let data:unknown={};try{data=raw?JSON.parse(raw):{};}catch{data={};}
 if(!r.ok){const msg=obj(data)&&obj(data.error)&&typeof data.error.message==="string"?data.error.message:"Composio request failed ("+r.status+")";throw new Error(msg.slice(0,300));}
 return data;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const auth=req.headers.get("Authorization")??"",token=auth.match(/^Bearer\s+(.+)$/i)?.[1];
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("SUPABASE_SECRET_KEY");
 if(!url||!anon||!serviceKey)return reply({error:"server_configuration_missing"},500);
 const serviceDb=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 let db:ReturnType<typeof createClient>,ownerId="",internalWorker=false;
 try{
  const cronSecret=req.headers.get("x-ultron-cron-secret")??"";
  if(cronSecret){
   const {data:expected,error:secretError}=await serviceDb.rpc("ultron_get_system_secret",{p_name:"ultron_brain_cron_secret"});
   if(secretError||typeof expected!=="string"||expected!==cronSecret)return reply({error:"unauthorized_worker"},401);
   const {data:instance,error:ie}=await serviceDb.from("ultron_instance").select("owner_id").eq("id",true).maybeSingle();
   if(ie||!instance?.owner_id)return reply({error:"owner_instance_required"},403);
   db=serviceDb;ownerId=instance.owner_id;internalWorker=true;
  }else{
   if(!token)return reply({error:"unauthorized"},401);
   const userDb=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   const {data:a,error:ae}=await userDb.auth.getUser(token),user=a?.user;
   if(ae||!user)return reply({error:"unauthorized"},401);
   const {data:instance,error:ie}=await userDb.from("ultron_instance").select("owner_id").eq("owner_id",user.id).maybeSingle();
   if(ie||!instance)return reply({error:"owner_instance_required"},403);
   db=userDb;ownerId=user.id;
  }
  const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>24000)return reply({error:"payload_too_large"},413);
  const body:unknown=JSON.parse(raw);if(!obj(body)||typeof body.action!=="string")return reply({error:"invalid_request"},400);
  if(internalWorker&&body.action!=="execute")return reply({error:"worker_action_not_allowed"},403);
  const key=Deno.env.get("COMPOSIO_API_KEY");
  if(body.action==="list"){
   const {data,error}=await db.from("ultron_connector_connections").select("id,provider_key,toolkit_slug,auth_config_id,connection_key,display_name,status,scopes,external_account_id,external_account_label,last_verified_at,last_error,metadata,created_at,updated_at").eq("owner_id",ownerId).order("provider_key");
   if(error)throw error;return reply({ok:true,configured:Boolean(key),connections:data??[]});
  }
  if(body.action==="connect"){
   const provider=str(body.provider_key,64).toLowerCase(),toolkit=str(body.toolkit_slug,80).toLowerCase();let authConfig=str(body.auth_config_id,120)||Deno.env.get("COMPOSIO_AUTH_CONFIG_"+toolkit.toUpperCase())||"";const alias=str(body.alias||body.display_name||provider,120),display=str(body.display_name||alias,160);
   if(!/^[a-z][a-z0-9_.-]{1,63}$/.test(provider)||!/^[a-z][a-z0-9_-]{1,79}$/.test(toolkit)||!alias||!display)return reply({error:"invalid_connector_metadata"},400);
   if(!key)return reply({error:"composio_not_configured",required_secret:"COMPOSIO_API_KEY"},503);
   if(!authConfig){
    const configs=await composio("/auth_configs?toolkit_slug="+encodeURIComponent(toolkit)+"&limit=100",key);
    const items=obj(configs)&&Array.isArray(configs.items)?configs.items:[];
    const enabled=items.filter((item)=>obj(item)&&item.status==="ENABLED"&&obj(item.toolkit)&&item.toolkit.slug===toolkit&&item.auth_scheme==="OAUTH2");
    const preferred=enabled.find((item)=>obj(item)&&item.is_composio_managed===true)??enabled[0];
    if(obj(preferred))authConfig=str(preferred.id,120);
    if(!authConfig){
     const created=await composio("/auth_configs",key,"POST",{toolkit,options:{type:"use_composio_managed_auth",name:"ULTRON "+display}});
     if(obj(created))authConfig=str(created.id??(obj(created.auth_config)?created.auth_config.id:""),120);
    }
   }
   if(!authConfig)return reply({error:"composio_auth_config_unavailable",message:"Composio did not return an enabled OAuth configuration for "+toolkit},503);
   const linked=await composio("/connected_accounts/link",key,"POST",{auth_config_id:authConfig,user_id:ownerId,alias});
   if(!obj(linked)||typeof linked.connected_account_id!=="string"||typeof linked.redirect_url!=="string")throw new Error("Composio returned an incomplete connection link");
   const {data,error}=await db.from("ultron_connector_connections").upsert({owner_id:ownerId,provider_key:provider,toolkit_slug:toolkit,auth_config_id:authConfig,connection_key:alias,display_name:display,status:"pending",external_account_id:linked.connected_account_id,last_error:null,metadata:{link_expires_at:linked.expires_at??null}},{onConflict:"owner_id,provider_key,connection_key"}).select("id,provider_key,toolkit_slug,connection_key,display_name,status,external_account_id,metadata").single();
   if(error)throw error;return reply({ok:true,connection:data,redirect_url:linked.redirect_url,expires_at:linked.expires_at??null},201);
  }
  if(body.action==="tools"){
   if(!key)return reply({error:"composio_not_configured",required_secret:"COMPOSIO_API_KEY"},503);
   let query=db.from("ultron_connector_connections").select("id,provider_key,toolkit_slug,display_name,external_account_id").eq("owner_id",ownerId).eq("status","connected");
   const filter=str(body.toolkit_slug,80).toLowerCase();if(filter)query=query.eq("toolkit_slug",filter);
   const {data:connections,error}=await query.order("provider_key");if(error)throw error;
   const available:Record<string,unknown>[]=[];
   for(const connection of connections??[]){
    if(!connection.toolkit_slug||!connection.external_account_id)continue;
    const remote=await composio("/tools?toolkit_slug="+encodeURIComponent(connection.toolkit_slug)+"&toolkit_versions=latest&limit=100",key);
    const candidates=obj(remote)&&Array.isArray(remote.items)?remote.items:obj(remote)&&Array.isArray(remote.tools)?remote.tools:obj(remote)&&Array.isArray(remote.data)?remote.data:[];
    for(const item of candidates){
     if(!obj(item))continue;
     const slug=str(item.slug||item.name||item.tool_slug,120).toUpperCase();if(!/^[A-Z][A-Z0-9_]{2,119}$/.test(slug))continue;
     available.push({connection_id:connection.id,provider_key:connection.provider_key,toolkit_slug:connection.toolkit_slug,display_name:connection.display_name,tool_slug:slug,description:str(item.description,1000),input_parameters:item.input_parameters??item.parameters??item.input_schema??{}});
    }
   }
   return reply({ok:true,tools:available});
  }
  if(body.action==="enqueue_tool"){
   const id=str(body.connection_id,80),toolSlug=str(body.tool_slug,120).toUpperCase(),args=obj(body.arguments)?body.arguments:{};
   if(!id||! /^[A-Z][A-Z0-9_]{2,119}$/.test(toolSlug))return reply({error:"invalid_tool_execution"},400);
   const {data:connection,error:connectionError}=await db.from("ultron_connector_connections").select("provider_key,toolkit_slug,status").eq("owner_id",ownerId).eq("id",id).maybeSingle();
   if(connectionError)throw connectionError;if(!connection||connection.status!=="connected")return reply({error:"connector_not_connected"},409);
   const toolkit=String(connection.toolkit_slug??"").toUpperCase().replace(/-/g,"_");
   if(!toolkit||!toolSlug.startsWith(toolkit+"_"))return reply({error:"toolkit_connection_mismatch"},403);
   const idempotencyKey=str(body.idempotency_key,160)||null;
   const {data:job,error:jobError}=await db.from("ultron_jobs").insert({
    owner_id:ownerId,job_type:"connector.tool.execute",title:"Run "+toolSlug,
    payload:{connection_id:id,tool_slug:toolSlug,arguments:args},priority:Math.max(-10,Math.min(10,Number(body.priority)||0)),
    idempotency_key:idempotencyKey
   }).select("id,job_type,title,status,created_at").single();
   if(jobError?.code==="23505"&&idempotencyKey){
    const existing=await db.from("ultron_jobs").select("id,job_type,title,status,created_at").eq("owner_id",ownerId).eq("idempotency_key",idempotencyKey).maybeSingle();
    if(existing.error)throw existing.error;
    const worker=existing.data&&["queued","retry_wait"].includes(String(existing.data.status))?await kickDurableWorker(url,auth,anon):{triggered:false,already_claimed:true};
    return reply({ok:true,deduplicated:true,job:existing.data,worker});
   }
   if(jobError)throw jobError;
   const worker=await kickDurableWorker(url,auth,anon);
   return reply({ok:true,deduplicated:false,job,worker},201);
  }
  if(body.action==="execute"){
   const id=str(body.connection_id,80),toolSlug=str(body.tool_slug,120).toUpperCase();
   const args=obj(body.arguments)?body.arguments:{};
   if(!id||! /^[A-Z][A-Z0-9_]{2,119}$/.test(toolSlug))return reply({error:"invalid_tool_execution"},400);
   const {data:connection,error:connectionError}=await db.from("ultron_connector_connections").select("provider_key,toolkit_slug,external_account_id,status").eq("owner_id",ownerId).eq("id",id).maybeSingle();
   if(connectionError)throw connectionError;
   if(!connection||connection.status!=="connected"||!connection.external_account_id)return reply({error:"connector_not_connected"},409);
   const toolkit=String(connection.toolkit_slug??"").toUpperCase().replace(/-/g,"_");
   if(!toolkit||!toolSlug.startsWith(toolkit+"_"))return reply({error:"toolkit_connection_mismatch"},403);
   if(!key)return reply({error:"composio_not_configured",required_secret:"COMPOSIO_API_KEY"},503);
   const readOnly=/(^|_)(GET|LIST|SEARCH|FETCH|READ|FIND|QUERY|ENUM|DOWNLOAD|PROFILE|STATUS)(_|$)/.test(toolSlug);
   if(!readOnly){
    const permissionKey="composio."+toolSlug.toLowerCase();
    const {data:permission,error:permissionError}=await db.from("ultron_tool_permissions").select("access_mode,require_confirmation").eq("owner_id",ownerId).eq("tool_key",permissionKey).maybeSingle();
    if(permissionError)throw permissionError;
    if(!permission||permission.access_mode!=="allow"||permission.require_confirmation!==false)
      return reply({error:"approval_required",tool_slug:toolSlug,permission_key:permissionKey,message:"This connector action changes data. It requires an explicit owner grant before execution."},403);
   }
   const result=await composio("/tools/execute/"+encodeURIComponent(toolSlug),key,"POST",{connected_account_id:connection.external_account_id,user_id:ownerId,version:"latest",arguments:args});
   return reply({ok:true,tool_slug:toolSlug,provider_key:connection.provider_key,result});
  }
  if(body.action==="status"||body.action==="disconnect"){
   const id=str(body.id,80);if(!id)return reply({error:"connection_id_required"},400);
   const {data:c,error:ce}=await db.from("ultron_connector_connections").select("id,external_account_id").eq("owner_id",ownerId).eq("id",id).maybeSingle();
   if(ce)throw ce;if(!c)return reply({error:"connection_not_found"},404);if(!c.external_account_id)return reply({error:"external_connection_not_created"},409);
   if(!key)return reply({error:"composio_not_configured",required_secret:"COMPOSIO_API_KEY"},503);
   if(body.action==="disconnect"){
    await composio("/connected_accounts/"+encodeURIComponent(c.external_account_id)+"/revoke",key,"POST",{});
    const {data,error}=await db.from("ultron_connector_connections").update({status:"revoked",last_verified_at:new Date().toISOString(),last_error:null}).eq("owner_id",ownerId).eq("id",id).select("id,status").single();
    if(error)throw error;return reply({ok:true,connection:data});
   }
   const remote=await composio("/connected_accounts/"+encodeURIComponent(c.external_account_id),key);
   const state=obj(remote)&&typeof remote.status==="string"?remote.status.toUpperCase():"UNKNOWN";
   const status=state==="ACTIVE"?"connected":state==="EXPIRED"||state==="INACTIVE"?"refresh_required":state==="FAILED"||state==="ERROR"?"error":"pending";
   const {data,error}=await db.from("ultron_connector_connections").update({status,last_verified_at:new Date().toISOString(),last_error:status==="error"?"Provider connection failed":null,metadata:{composio_status:state}}).eq("owner_id",ownerId).eq("id",id).select("id,provider_key,toolkit_slug,display_name,status,external_account_id,last_verified_at,last_error,metadata").single();
   if(error)throw error;return reply({ok:true,connection:data});
  }
  return reply({error:"unknown_action"},400);
 }catch(e){return reply({error:"connector_request_failed",message:(e instanceof Error?e.message:"request_failed").slice(0,400)},400);}
});