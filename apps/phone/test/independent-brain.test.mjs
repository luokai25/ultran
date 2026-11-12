import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cloud = readFileSync(resolve(root, "src/cloud-llm.ts"), "utf8");
const vault = readFileSync(resolve(root, "src/local-llm-vault.ts"), "utf8");
const sync = readFileSync(resolve(root, "src/cloud-sync.ts"), "utf8");
const main = readFileSync(resolve(root, "src/main.ts"), "utf8");

test("provider verification and streaming run directly from the device with no hosted gateway", () => {
  assert.match(cloud, /verifyProviderKey\(provider, secret, defaultProviderTransport\(\)/);
  assert.match(cloud, /streamProviderChat\(/);
  assert.match(cloud, /getLocalProviderKeyCandidates/);
  assert.match(cloud, /REQUEST_DEADLINE_MS = 180_000/);
  assert.doesNotMatch(cloud, /vercel|\/api\/ultron-brain|functions\/v1\/ultron-brain/i);
  assert.doesNotMatch(cloud, /ULTRON_SUPABASE|getCloudSession|@supabase\/supabase-js/);
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
