import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const [main, css, runtimeClient, capabilityClient, runtimeEdge, capabilityEdge] = await Promise.all([
  read("src/main.ts"),
  read("src/chatgpt-ui.css"),
  read("src/runtime-cloud.ts"),
  read("src/capability-cloud.ts"),
  read("../../supabase/functions/ultron-runtime/index.ts"),
  read("../../supabase/functions/ultron-capabilities/index.ts"),
]);

test("Automatic model selection and status never open an owner sign-in flow", () => {
  const start = main.indexOf("async function openChatModelMenu(): Promise<void>");
  const end = main.indexOf("\nfunction openSheet(): void", start);
  assert.ok(start >= 0 && end > start, "model picker exists");
  const picker = main.slice(start, end);
  assert.match(picker, /getUltronCloudStatus\(\)/);
  assert.doesNotMatch(picker, /getCloudSession|owner session|sign in|openSheet\(\)/i);
});

test("chat model picker is a compact, scrollable, correctly anchored mobile popover", () => {
  assert.match(main, /const modelMenuWidth = Math\.min\(248, window\.innerWidth - 20\)/);
  assert.match(main, /chatModelMenu\.style\.transform = "none"/);
  assert.match(css, /\.chat-model-menu\s*\{[^}]*transform:\s*none/s);
  assert.match(css, /\.chat-model-options\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /max-height:\s*min\(194px/);
  assert.match(css, /\.chat-model-menu-head,\s*#chat-model-status,\s*\.chat-model-menu-actions\s*\{\s*display:\s*none/s);
});

test("user messages align to the right instead of being centered with their edit action", () => {
  assert.match(css, /\.msg\.user\s*\{[^}]*margin-left:\s*auto;[^}]*margin-right:\s*0/s);
  assert.match(css, /\.msg\.user \.actions\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(main, /edit\.textContent = "Edit & resend"/);
});

test("chat runtime and capability clients call the public single-instance gateways directly", () => {
  for (const source of [runtimeClient, capabilityClient]) {
    assert.match(source, /fetch\(\`\$\{ULTRON_SUPABASE_URL\}\/functions\/v1/);
    assert.match(source, /apikey:\s*ULTRON_SUPABASE_PUBLISHABLE_KEY/);
    assert.doesNotMatch(source, /getCloudSession|auth\.getSession|Sign in with the ULTRON owner account/);
  }
});

test("runtime resolves the singleton owner server-side for public web and Android requests", () => {
  assert.match(runtimeEdge, /serviceDb\.from\("ultron_instance"\)[\s\S]*?\.eq\("id",true\)/);
  assert.match(runtimeEdge, /systemAccess=true/);
  assert.match(runtimeEdge, /systemAccess\s*\?\s*await db\.rpc\("ultron_match_local_memories_system"/);
  assert.doesNotMatch(runtimeEdge, /auth\.getUser\(token\)/);
});

test("capability checkpoints resolve the singleton owner server-side without a visitor session", () => {
  assert.match(capabilityEdge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(capabilityEdge, /\.eq\("id", true\)/);
  assert.match(capabilityEdge, /const owner_id = String\(owner\.owner_id\)/);
  assert.doesNotMatch(capabilityEdge, /auth\.getUser\(|owner_id = user\.id/);
});
