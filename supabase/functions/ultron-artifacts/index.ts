import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const safeName=(v:string)=>v.normalize("NFKC").replace(/[^\p{L}\p{N}._ -]/gu,"_").replace(/\s+/g,"_").slice(0,150)||"artifact";
const allowedTypes=new Set(["pdf","report","archive","image","document","code","data","file"]);
const MAX_BYTES=50*1024*1024;
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const authorization=req.headers.get("Authorization")??"",token=authorization.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return reply({error:"unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!key)return reply({error:"server_configuration_missing"},500);
 const db=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 try{
  const {data:authData,error:authError}=await db.auth.getUser(token),user=authData?.user;
  if(authError||!user)return reply({error:"unauthorized"},401);
  const {data:owner,error:ownerError}=await db.from("ultron_instance").select("owner_id").eq("owner_id",user.id).maybeSingle();
  if(ownerError||!owner)return reply({error:"owner_instance_required"},403);
  const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>32000)return reply({error:"payload_too_large"},413);
  const body:unknown=JSON.parse(raw);if(!object(body)||typeof body.action!=="string")return reply({error:"invalid_request"},400);
  const bucket=db.storage.from("ultron-private");
  if(body.action==="prepare_upload"){
   const name=typeof body.name==="string"?body.name.trim():"",mime=typeof body.mime_type==="string"?body.mime_type.slice(0,160):"application/octet-stream";
   const size=Number(body.byte_size),type=typeof body.artifact_type==="string"&&allowedTypes.has(body.artifact_type)?body.artifact_type:"file";
   if(!name||name.length>240||!Number.isSafeInteger(size)||size<1||size>MAX_BYTES)return reply({error:"invalid_artifact_metadata_or_size_limit_50mb"},400);
   const id=crypto.randomUUID(),path=user.id+"/"+id+"/"+safeName(name);
   const {data,error}=await bucket.createSignedUploadUrl(path,{upsert:false});if(error)throw error;
   return reply({ok:true,artifact_id:id,bucket:"ultron-private",path,token:data.token,signed_url:data.signedUrl,name,mime_type:mime,byte_size:size,artifact_type:type});
  }
  if(body.action==="register"){
   const id=typeof body.id==="string"?body.id:"",path=typeof body.storage_path==="string"?body.storage_path:"",name=typeof body.name==="string"?body.name.trim():"";
   if(!/^[0-9a-f-]{36}$/i.test(id)||!path.startsWith(user.id+"/"+id+"/")||!name||name.length>240)return reply({error:"invalid_artifact_reference"},400);
   const parts=path.split("/"),{data:files,error:listError}=await bucket.list(user.id+"/"+id,{limit:10});if(listError)throw listError;
   const file=files?.find(entry=>entry.name===parts.slice(2).join("/"));if(!file)return reply({error:"uploaded_object_not_found"},404);
   const size=Number(file.metadata?.size??0);if(!Number.isFinite(size)||size<1||size>MAX_BYTES){await bucket.remove([path]);return reply({error:"artifact_size_invalid"},400);}
   const {data,error}=await db.from("ultron_artifacts").insert({id,owner_id:user.id,name,description:typeof body.description==="string"?body.description.slice(0,2000):null,artifact_type:typeof body.artifact_type==="string"&&allowedTypes.has(body.artifact_type)?body.artifact_type:"file",mime_type:typeof body.mime_type==="string"?body.mime_type.slice(0,160):"application/octet-stream",bucket_id:"ultron-private",storage_path:path,byte_size:size,checksum_sha256:typeof body.checksum_sha256==="string"&&/^[a-f0-9]{64}$/.test(body.checksum_sha256)?body.checksum_sha256:null,source_job_id:typeof body.source_job_id==="string"?body.source_job_id:null,source_run_id:typeof body.source_run_id==="string"?body.source_run_id:null,metadata:object(body.metadata)?body.metadata:{}}).select("id,name,artifact_type,mime_type,storage_path,byte_size,created_at").single();
   if(error)throw error;return reply({ok:true,artifact:data},201);
  }
  if(body.action==="list"){
   const limit=Math.max(1,Math.min(100,Math.trunc(Number(body.limit)||50)));let query=db.from("ultron_artifacts").select("id,name,description,artifact_type,mime_type,byte_size,checksum_sha256,source_job_id,source_run_id,metadata,created_at,updated_at").order("created_at",{ascending:false}).limit(limit);
   if(typeof body.artifact_type==="string"&&allowedTypes.has(body.artifact_type))query=query.eq("artifact_type",body.artifact_type);
   const {data,error}=await query;if(error)throw error;return reply({ok:true,artifacts:data??[]});
  }
  if(body.action==="download"){
   if(typeof body.id!=="string")return reply({error:"artifact_id_required"},400);
   const {data:artifact,error:readError}=await db.from("ultron_artifacts").select("id,name,bucket_id,storage_path,mime_type").eq("id",body.id).eq("owner_id",user.id).maybeSingle();
   if(readError)throw readError;if(!artifact)return reply({error:"artifact_not_found"},404);
   const {data,error}=await db.storage.from(artifact.bucket_id).createSignedUrl(artifact.storage_path,300,{download:artifact.name});if(error)throw error;
   return reply({ok:true,url:data.signedUrl,expires_in:300,mime_type:artifact.mime_type});
  }
  if(body.action==="delete"){
   if(typeof body.id!=="string")return reply({error:"artifact_id_required"},400);
   const {data:artifact,error:readError}=await db.from("ultron_artifacts").select("id,bucket_id,storage_path").eq("id",body.id).eq("owner_id",user.id).maybeSingle();
   if(readError)throw readError;if(!artifact)return reply({error:"artifact_not_found"},404);
   const {error:removeError}=await db.storage.from(artifact.bucket_id).remove([artifact.storage_path]);if(removeError)throw removeError;
   const {error}=await db.from("ultron_artifacts").delete().eq("id",body.id).eq("owner_id",user.id);if(error)throw error;
   return reply({ok:true,deleted:body.id});
  }
  return reply({error:"unknown_action"},400);
 }catch(error){const message=error instanceof Error?error.message:"request_failed";return reply({error:"request_failed",message:message.slice(0,400)},400);}
});