import { cloudClient, getCloudSession } from "./cloud-sync";
export type UltronConnector={id:string;provider_key:string;toolkit_slug:string|null;connection_key:string;display_name:string;status:"pending"|"connected"|"refresh_required"|"revoked"|"error";external_account_id:string|null;last_verified_at?:string|null;last_error?:string|null;metadata?:Record<string,unknown>};
async function invoke(action:string,payload:Record<string,unknown>={}):Promise<Record<string,unknown>>{
 const session=await getCloudSession();if(!session)throw new Error("Sign in with the ULTRON owner account before managing connectors.");
 const {data,error}=await cloudClient.functions.invoke("ultron-connectors",{body:{...payload,action}});if(error)throw error;
 if(!data||typeof data!=="object")throw new Error("ULTRON connector gateway returned an invalid response.");
 const result=data as Record<string,unknown>;if(result.error)throw new Error(String(result.message??result.error));return result;
}
export async function saveUltronComposioApiKey(apiKey:string):Promise<void>{
 const value=apiKey.trim();
 if(value.length<8||value.length>8192)throw new Error("Enter a valid Composio API key.");
 await invoke("save_key",{api_key:value});
}
export async function listUltronConnectors():Promise<{configured:boolean;connections:UltronConnector[]}>{const r=await invoke("list");return{configured:r.configured===true,connections:Array.isArray(r.connections)?r.connections as UltronConnector[]:[]};}
export async function startUltronConnectorConnection(input:{providerKey:string;toolkitSlug:string;authConfigId?:string;displayName?:string;alias?:string}):Promise<{connection:UltronConnector;redirectUrl:string;expiresAt:string|null}>{
 const r=await invoke("connect",{provider_key:input.providerKey,toolkit_slug:input.toolkitSlug,auth_config_id:input.authConfigId ?? "",display_name:input.displayName,alias:input.alias});
 if(!r.connection||typeof r.connection!=="object"||typeof r.redirect_url!=="string")throw new Error("ULTRON did not receive a valid connector authorization link.");
 return{connection:r.connection as UltronConnector,redirectUrl:r.redirect_url,expiresAt:typeof r.expires_at==="string"?r.expires_at:null};
}
export async function refreshUltronConnectorStatus(id:string):Promise<UltronConnector>{const r=await invoke("status",{id});if(!r.connection||typeof r.connection!=="object")throw new Error("Connector status response was invalid.");return r.connection as UltronConnector;}
export async function disconnectUltronConnector(id:string):Promise<void>{await invoke("disconnect",{id});}

export async function executeUltronConnectorTool(input:{connectionId:string;toolSlug:string;arguments?:Record<string,unknown>}):Promise<Record<string,unknown>>{const r=await invoke("execute",{connection_id:input.connectionId,tool_slug:input.toolSlug,arguments:input.arguments??{}});return r.result&&typeof r.result==="object"?r.result as Record<string,unknown>:r;}

export async function queueUltronConnectorTool(input:{connectionId:string;toolSlug:string;arguments?:Record<string,unknown>;idempotencyKey?:string}):Promise<Record<string,unknown>>{return invoke("enqueue_tool",{connection_id:input.connectionId,tool_slug:input.toolSlug,arguments:input.arguments??{},idempotency_key:input.idempotencyKey});}

export type UltronConnectorTool={connection_id:string;provider_key:string;toolkit_slug:string;display_name:string;tool_slug:string;description:string;input_parameters:unknown};
export async function listUltronConnectorTools(toolkitSlug?:string):Promise<UltronConnectorTool[]>{const r=await invoke("tools",toolkitSlug?{toolkit_slug:toolkitSlug}:{});return Array.isArray(r.tools)?r.tools as UltronConnectorTool[]:[];}
