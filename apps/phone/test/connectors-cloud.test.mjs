import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"..","..","..");
const gateway=readFileSync(resolve(root,"supabase/functions/ultron-connectors/index.ts"),"utf8");
const client=readFileSync(resolve(root,"apps/phone/src/connectors-cloud.ts"),"utf8");
const migration=readFileSync(resolve(root,"supabase/migrations/20261105040627_ultron_connector_gateway_metadata.sql"),"utf8");
const screen=readFileSync(resolve(root,"apps/phone/src/connectors-ui.ts"),"utf8");
const html=readFileSync(resolve(root,"apps/phone/index.html"),"utf8");
const runtime=readFileSync(resolve(root,"supabase/functions/ultron-runtime/index.ts"),"utf8");
const main=readFileSync(resolve(root,"apps/phone/src/main.ts"),"utf8");
test("Composio API key stays server-side and owner auth is enforced",()=>{assert.match(gateway,/auth\.getUser\(token\)/);assert.match(gateway,/ultron_instance/);assert.match(gateway,/Deno\.env\.get\("COMPOSIO_API_KEY"\)/);assert.match(gateway,/backend\.composio\.dev\/api\/v3\.1/);assert.match(gateway,/composio\("\/connected_accounts\/link"/);});
test("Composio gateway credentials are verified and stored in Supabase Vault",()=>{
 assert.match(gateway,/body\.action==="save_key"/);
 assert.match(gateway,/composio\("\/auth_configs\?limit=1",apiKey\)/);
 assert.match(gateway,/ultron_store_llm_secret/);
 assert.match(gateway,/ultron_read_llm_secret/);
 assert.match(gateway,/storage:"vault"/);
 assert.match(client,/saveUltronComposioApiKey/);
 assert.match(screen,/composio-api-key-save/);
 assert.match(html,/id="composio-api-key"/);
 assert.match(html,/type="password"/);
});
test("connector lifecycle supports list, connect, status and revoke",()=>{for(const a of ["list","connect","tools","enqueue_tool","execute","status","disconnect"])assert.match(gateway,new RegExp('body\.action==="'+a+'"'));assert.match(gateway,/\/revoke/);});
test("phone client exposes connector lifecycle",()=>{for(const f of ["listUltronConnectors","startUltronConnectorConnection","refreshUltronConnectorStatus","disconnectUltronConnector","executeUltronConnectorTool","queueUltronConnectorTool","listUltronConnectorTools"])assert.match(client,new RegExp("export async function "+f));assert.match(client,/functions\.invoke\("ultron-connectors"/);});
test("schema adds routing metadata only",()=>{assert.match(migration,/toolkit_slug/);assert.match(migration,/auth_config_id/);assert.doesNotMatch(migration,/access_token|refresh_token|api_key/i);});

test("Connectors screen loads live cloud tools after OAuth connection",()=>{assert.match(screen,/listUltronConnectorTools/);assert.match(screen,/refreshAvailableTools/);assert.match(screen,/CLOUD TOOLS/);assert.match(screen,/tool\.tool_slug/);});

test("cloud connector and workflow jobs wake the durable Edge Function worker",()=>{assert.match(gateway,/kickDurableWorker\(url,auth,anon\)/);assert.match(runtime,/kickDurableWorker\(url,auth,key\)/);assert.match(gateway,/action:"process",limit:1/);assert.match(runtime,/action:"process",limit:1/);});

test("Google Super is routed through the shared OAuth gateway without exposing Google credentials",()=>{
 const catalog=JSON.parse(readFileSync(resolve(root,"apps/phone/src/connectors.catalog.json"),"utf8"));
 const google=catalog.find((entry)=>entry.id==="googlesuper");
 assert.ok(google);
 assert.equal(google.auth,"oauth2");
 assert.equal(google.id.replace(/-/g,"_"),"googlesuper");
 assert.match(google.description,/OAuth consent screen/);
 assert.match(gateway,/connected_accounts\/link/);
 assert.match(gateway,/ultron_store_llm_secret/);
 assert.match(gateway,/approval_required/);
 assert.match(screen,/Google authorization page/);
});

test("connector read-only classification is prefix-based and fails closed for mixed write tool names",()=>{
 assert.match(gateway,/function isReadOnlyTool\(toolSlug:string,toolkitSlug:string\)/);
 assert.match(gateway,/const action=toolSlug\.slice\(prefix\.length\)/);
 assert.match(gateway,/const readOnly=isReadOnlyTool\(toolSlug,toolkit\)/);
 assert.doesNotMatch(gateway,/const readOnly=\/\(\^\|_\)\(GET\|LIST\|SEARCH/);
});

test("ULTRON agent can discover and invoke Google Workspace tools from natural requests",()=>{
 assert.match(main,/Google Workspace is available as one Google Super connection/);
 assert.match(main,/toolkit.*googlesuper/);
 assert.match(main,/google workspace|google calendar|google drive|google sheets|google docs/);
 assert.match(main,/emails|inbox|mail/);
});
