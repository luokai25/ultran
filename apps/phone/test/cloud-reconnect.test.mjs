import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [main, cloudSync, html, chatUi] = await Promise.all([
  readFile(path.join(root, "src/main.ts"), "utf8"),
  readFile(path.join(root, "src/cloud-sync.ts"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "src/chatgpt-ui.css"), "utf8"),
]);

test("Supabase owner session restores automatically and reconnects after network recovery", () => {
  assert.match(main, /void restoreCloudAccount\(\)/);
  assert.match(main, /window\.addEventListener\("online",\s*\(\)\s*=>\s*\{\s*updateHeroCloudStatus\(true\);\s*void resumeCloudConnection\(\);/);
  assert.match(main, /window\.addEventListener\("offline"/);
  assert.match(main, /document\.addEventListener\("visibilitychange"/);
  assert.match(main, /cloudClient\.auth\.onAuthStateChange/);
  assert.match(main, /cloudAccountConnected = true/);
  assert.match(main, /cloudAccountConnected = false/);
});

test("cloud recovery revalidates the session, refreshes data and restores owner-scoped realtime", () => {
  const resume = main.slice(main.indexOf("async function resumeCloudConnection"), main.indexOf("async function disconnectCloudAccount"));
  assert.match(resume, /await getCloudSession\(\)/);
  assert.match(resume, /await refreshFromCloud\(\)/);
  assert.match(resume, /startCloudRealtime\(\)/);
  assert.match(cloudSync, /\.channel\('ultron-private-workspace'\)/);
  assert.match(cloudSync, /filter: `owner_id=eq\.\$\{ownerId\}`/);
});

test("Supabase sessions persist and refresh without embedding service-role credentials in the client", () => {
  assert.match(cloudSync, /persistSession:\s*true/);
  assert.match(cloudSync, /autoRefreshToken:\s*true/);
  assert.match(cloudSync, /cloudClient\.auth\.refreshSession\(\)/);
  assert.doesNotMatch(cloudSync, /service_role|SUPABASE_SERVICE_ROLE_KEY/i);
});


test("the clean ULTRON home state focuses the greeting and keeps the composer reachable", () => {
  assert.match(html, /How can I help\?/);
  assert.match(html, /id="composer"/);
  assert.match(html, /id="chat-model-button"/);
  assert.match(main, /greetingEl\.textContent = "How can I help\?"/);
  assert.match(main, /heroWakeButton\.addEventListener\("click"/);
  assert.match(main, /promptEl\.focus\(\{ preventScroll: true \}\)/);
  assert.match(chatUi, /\.composer\s*\{/);
  assert.match(chatUi, /#prompt\s*\{/);
  assert.doesNotMatch(html, /avatar-orbit|WATCHING[\s\S]*REASONING[\s\S]*ACTING/);
});


test("home status never claims Supabase is linked before an owner session is restored", () => {
  assert.match(main, /function updateHeroCloudStatus\(checking = false\)/);
  assert.match(main, /SUPABASE CLOUD LINKED/);
  assert.match(main, /LOCAL MODE · CLOUD NOT LINKED/);
  assert.match(main, /OFFLINE · LOCAL AVAILABLE/);
  assert.match(main, /updateHeroCloudStatus\(\);/);
  assert.match(html, /id="core-status-label">CHECKING SUPABASE/);
  assert.match(chatUi, /\.hero-status[\s\S]*display:\s*none\s*!important/);
  assert.match(main, /app\.dataset\.health = state === "online" \? "ready" : "local"/);
});
