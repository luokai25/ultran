import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gateway = readFileSync(resolve(root, "../../api/ultron-brain.ts"), "utf8");
const cloud = readFileSync(resolve(root, "src/cloud-llm.ts"), "utf8");
const vault = readFileSync(resolve(root, "src/local-llm-vault.ts"), "utf8");
const sync = readFileSync(resolve(root, "src/cloud-sync.ts"), "utf8");
const main = readFileSync(resolve(root, "src/main.ts"), "utf8");

test("Vercel Brain gateway handles provider verification and streaming without Supabase", () => {
  assert.match(gateway, /action === "verify_key"/);
  assert.match(gateway, /action !== "chat"/);
  assert.match(gateway, /text\/event-stream/);
  assert.match(gateway, /api\.cohere\.com\/v2\/chat/);
  assert.match(gateway, /maxDuration = 60/);
  assert.doesNotMatch(gateway, /supabase|SUPABASE/i);
});

test("cloud model routing no longer calls Supabase Edge Functions", () => {
  assert.match(cloud, /\/api\/ultron-brain/);
  assert.match(cloud, /getLocalProviderKeyCandidates/);
  assert.match(cloud, /api_key: candidate\.apiKey/);
  assert.match(cloud, /58_000/);
  assert.doesNotMatch(cloud, /functions\/v1\/ultron-brain/);
  assert.doesNotMatch(cloud, /ULTRON_SUPABASE/);
  assert.doesNotMatch(cloud, /getCloudSession/);
});

test("provider credentials are encrypted locally and Android uses native secure storage", () => {
  assert.match(vault, /AES-GCM/);
  assert.match(vault, /generateKey/);
  assert.match(vault, /nativeSecureStorage\.get/);
  assert.match(vault, /nativeSecureStorage\.set/);
  assert.match(vault, /native-secure-storage/);
  assert.doesNotMatch(vault, /cloud-sync/);
  assert.match(vault, /indexedDB/);
  assert.match(vault, /blocked_models/);
  assert.match(vault, /cooldown_until/);
  assert.doesNotMatch(vault, /localStorage\.setItem\(VAULT_KEY, serialized/);
});

test("Supabase data sync is optional and local Prometheus checkpoints survive disconnection", () => {
  assert.match(sync, /createClient\(ULTRON_SUPABASE_URL/);
  assert.doesNotMatch(cloud, /@supabase\/supabase-js/);
  assert.match(main, /prometheusCheckpoint/);
  assert.match(main, /if \(!cloudAccountConnected\)/);
});
