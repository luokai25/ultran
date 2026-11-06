import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [main, cloudSync, html, quietUi] = await Promise.all([
  readFile(path.join(root, "src/main.ts"), "utf8"),
  readFile(path.join(root, "src/cloud-sync.ts"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "src/quiet-ui.css"), "utf8"),
]);

test("Supabase owner session restores automatically and reconnects after network recovery", () => {
  assert.match(main, /void restoreCloudAccount\(\)/);
  assert.match(main, /window\.addEventListener\("online",\s*\(\)\s*=>\s*\{\s*void resumeCloudConnection\(\)/);
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


test("the cinematic landing concept is integrated into the real app and wakes the composer", () => {
  assert.match(html, /An intelligence that stays ready/);
  assert.match(html, /WATCHING[\s\S]*REASONING[\s\S]*ACTING/);
  assert.match(html, /It sees[\s\S]*It thinks[\s\S]*It acts/);
  assert.match(html, /id="hero-wake"/);
  assert.match(main, /heroWakeButton\.addEventListener\("click"/);
  assert.match(main, /promptEl\.focus\(\{ preventScroll: true \}\)/);
  assert.match(quietUi, /\.hero-manifesto/);
  assert.match(quietUi, /\.hero-wake/);
});
