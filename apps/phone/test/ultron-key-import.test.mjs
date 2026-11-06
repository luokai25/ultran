import test from "node:test";
import assert from "node:assert/strict";
import { providerFromKeyFilename, parseProviderKeyFile } from "../src/ultron-key-import.mjs";

test("provider import recognises provider names in filenames", () => {
  assert.equal(providerFromKeyFilename("openrouter-keys.txt"), "openrouter");
  assert.equal(providerFromKeyFilename("Open Router.txt"), "openrouter");
  assert.equal(providerFromKeyFilename("GROQ_API_KEYS.txt"), "groq");
  assert.equal(providerFromKeyFilename("google-ai-studio.txt"), "google_ai_studio");
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
test("single pasted cloud API key is auto-detected, verified and sent through the authenticated Vault gateway", () => {
  assert.match(html, /id="cloud-llm-key"/);
  assert.match(html, /id="cloud-llm-detected"/);
  assert.match(html, /Paste an OpenRouter, Groq or Google AI Studio key/);
  assert.match(html, /id="cloud-llm-provider"/);
  assert.match(main, /function detectCloudLlmProvider/);
  assert.match(main, /cloudLlmKeyInput\.addEventListener\("paste"/);
  assert.match(main, /addUltronCloudKey\(provider, key, label\)/);
  assert.match(main, /cloudLlmKeyInput\.value = ""/);
  assert.match(main, /Accepted · securely saved and enabled/);
  assert.match(main, /ultron_store_llm_secret/);
});
