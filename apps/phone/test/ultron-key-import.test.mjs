import test from "node:test";
import assert from "node:assert/strict";
import { providerFromKeyFilename, parseProviderKeyFile, validateProviderKeyFiles } from "../src/ultron-key-import.mjs";

test("provider import recognises provider names in filenames", () => {
  assert.equal(providerFromKeyFilename("openrouter-keys.txt"), "openrouter");
  assert.equal(providerFromKeyFilename("Open Router.txt"), "openrouter");
  assert.equal(providerFromKeyFilename("open router api keys.txt"), "openrouter");
  assert.equal(providerFromKeyFilename("GROQ_API_KEYS.txt"), "groq");
  assert.equal(providerFromKeyFilename("groq api keys.txt"), "groq");
  assert.equal(providerFromKeyFilename("google-ai-studio.txt"), "google_ai_studio");
  assert.equal(providerFromKeyFilename("google ai studio api keys.txt"), "google_ai_studio");
  assert.equal(providerFromKeyFilename("gemini-keys.txt"), "google_ai_studio");
  assert.equal(providerFromKeyFilename("mistral.txt"), "mistral");
  assert.equal(providerFromKeyFilename("random.txt"), null);
});

test("provider key files parse plain and env-style lines without duplicates or comments", () => {
  const keys = parseProviderKeyFile("\uFEFF# private keys\r\n\r\nsk-or-v1-abcdefgh12345678\r\nOPENROUTER_API_KEY=sk-or-v1-abcdefgh12345678\r\nGROQ_API_KEY=\"gsk_abcdefgh12345678\"\r\n; ignored\nshort\nnot a key");
  assert.deepEqual(keys, ["sk-or-v1-abcdefgh12345678", "gsk_abcdefgh12345678"]);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const main = readFileSync(resolve(root, "src/main.ts"), "utf8");
const cloud = readFileSync(resolve(root, "src/cloud-llm.ts"), "utf8");
test("single pasted cloud API key is auto-detected, verified through Vercel and saved in the local encrypted vault", () => {
  assert.match(html, /id="cloud-llm-key"/);
  assert.match(html, /id="cloud-llm-detected"/);
  assert.match(html, /Paste any supported API key/);
  assert.match(html, /id="cloud-llm-provider"/);
  assert.match(main, /function detectCloudLlmProvider/);
  assert.match(main, /cloudLlmKeyInput\.addEventListener\("paste"/);
  assert.match(main, /addUltronCloudKey\(provider, key, label\)/);
  assert.match(main, /cloudLlmKeyInput\.value = ""/);
  assert.match(main, /Accepted · securely saved and enabled/);
  assert.match(cloud, /\/api\/ultron-brain/);
  assert.match(cloud, /saveLocalProviderKey/);
  assert.match(cloud, /action: "verify_key"/);
  assert.doesNotMatch(cloud, /functions\/v1\/ultron-brain/);
  assert.doesNotMatch(cloud, /ULTRON_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(cloud, /getCloudSession\(\)/);
});


test("provider file import accepts safe multi-file batches and rejects invalid batches", () => {
  const files = [
    { name: "openrouter-keys.txt", size: 1024 },
    { name: "groq-api-keys.txt", size: 2048 },
    { name: "google-ai-studio.txt", size: 4096 },
  ];
  assert.equal(validateProviderKeyFiles(files), null);
  assert.equal(validateProviderKeyFiles([]), "Choose at least one provider .txt file.");
  assert.match(validateProviderKeyFiles(Array.from({ length: 7 }, (_, index) => ({ name: `provider-${index}.txt`, size: 10 }))), /six provider files/);
  assert.match(validateProviderKeyFiles([{ name: "keys.json", size: 10 }]), /Only .txt/);
  assert.match(validateProviderKeyFiles([{ name: "keys.txt", size: 1024 * 1024 + 1 }]), /1 MB/);
});

test("the LLM API Keys screen exposes the local provider-file importer", () => {
  assert.match(html, /class="ultron-key-file-import"/);
  assert.match(html, /id="cloud-llm-files" type="file" accept="\.txt,text\/plain" multiple/);
  assert.match(html, /id="cloud-llm-import" class="ghost" type="button">Import and verify keys/);
  assert.match(html, /id="cloud-llm-import-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(main, /validateProviderKeyFiles\(files\)/);
  assert.match(main, /Source files stay on this device/);
});


test("provider key files parse the numbered labels used by the ULTRON import workflow", () => {
  const keys = parseProviderKeyFile([
    "ultron 1: sk-or-v1-test123456",
    "groq1: gsk_test123456",
    "google ai studio 1: AQ.test123456",
  ].join("\n"));
  assert.deepEqual(keys, ["sk-or-v1-test123456", "gsk_test123456", "AQ.test123456"]);
});
