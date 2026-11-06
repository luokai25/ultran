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
test("LLM key file import reads locally and routes individual keys through the authenticated Vault gateway", () => {
  assert.match(html, /id="cloud-llm-files"/);
  assert.match(html, /<strong>Import<\/strong>/);
  assert.match(html, />Send<\/button>/);
  assert.match(html, /google_ai_studio/);
  assert.match(html, /id="cloud-llm-import"/);
  assert.match(main, /providerFromKeyFilename/);
  assert.match(main, /contents = await file\.text\(\)/);
  assert.match(main, /parseProviderKeyFile\(contents\)/);
  assert.match(main, /addUltronCloudKey\(provider, secret/);
  assert.match(main, /attempted < 100/);
  assert.match(html, /The file is read locally, never uploaded/);
});
