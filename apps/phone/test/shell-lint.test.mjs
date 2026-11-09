import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const css = readFileSync(resolve(root, "src/chatgpt-ui.css"), "utf8");
const main = readFileSync(resolve(root, "src/main.ts"), "utf8");

function element(id) {
  const match = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`));
  assert.ok(match, `missing shell element #${id}`);
  return match[0];
}

// Legacy component styles assign display:flex to these full-screen surfaces.
// The global hidden rule must win so they cannot silently cover the app.
assert.match(css, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;/);
for (const id of ["connectors-panel", "sheet-wrap", "global-search", "chat-model-menu", "workspace-panel"]) {
  assert.match(element(id), /\shidden(?:\s|>)/, `#${id} must start hidden`);
}

// Every primary navigation destination must exist and have an explicit action.
const navigation = {
  "nav-chat": "navChatButton.addEventListener",
  "nav-models": "navModelsButton.addEventListener",
  "nav-vault": "navVaultButton.addEventListener",
  "nav-connectors": "navConnectorsButton.addEventListener",
  "nav-settings": "navSettingsButton.addEventListener",
};
for (const [id, handler] of Object.entries(navigation)) {
  element(id);
  assert.ok(main.includes(handler), `missing click handler for #${id}`);
}

// The unified API-key surface must be present, reachable from the drawer and backed by real handlers.
for (const id of ["llm-api-keys-screen", "drawer-llm-api-keys", "llm-api-key", "llm-api-key-provider", "llm-api-key-status", "llm-api-key-save", "llm-api-key-remove", "llm-api-key-models", "cloud-brain-state", "cloud-brain-status", "cloud-llm-provider", "cloud-llm-provider-note", "cloud-llm-provider-console", "cloud-llm-label", "cloud-llm-key", "cloud-llm-add", "cloud-llm-keys", "cloud-free-provider-count", "cloud-free-providers-refresh"]) {
  element(id);
}
assert.match(element("llm-api-keys-screen"), /\shidden(?:\s|>)/, "API key screen must start hidden");
assert.ok(main.includes('req<HTMLButtonElement>("#drawer-llm-api-keys").addEventListener'), "missing API key drawer navigation handler");
assert.ok(main.includes('apiKeySaveButton.addEventListener'), "missing API key save/test handler");
assert.ok(main.includes('apiKeyRemoveButton.addEventListener'), "missing API key removal handler");
assert.ok(main.includes('cloudLlmAddButton.addEventListener'), "missing Supabase API key save handler");
assert.ok(main.includes('refreshCloudLlmScreen'), "missing Supabase cloud key/status refresh");
assert.ok(main.includes('nativeSecureStorage.set'), "API keys must use Android encrypted storage");
assert.ok(main.includes('providerGenerationToken'), "API provider streaming must render token events");

// A missing required node aborts module evaluation before any interaction works.
// Keep the required DOM references aligned with the shipped HTML shell.
const requiredIds = [...main.matchAll(/req<[^>]+>\("#([^"]+)"\)/g)].map((match) => match[1]);
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
for (const id of new Set(requiredIds)) {
  assert.ok(htmlIds.has(id), `main.ts requires #${id}, but index.html does not provide it`);
}

console.log(`ULTRON shell checks passed: ${new Set(requiredIds).size} required nodes, 5 navigation handlers, hidden overlays protected.`);
