import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/llm-provider.ts", import.meta.url), "utf8");
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Set, RegExp, String, Array, Object });
const { detectProvider, classifyProviderResponse, selectChatModels, providerStatusLabel } = module.exports;

test("detects supported OpenAI-compatible key formats without a provider selector", () => {
  assert.equal(detectProvider("sk-proj-12345678901234567890").id, "openai");
  assert.equal(detectProvider("gsk_12345678901234567890").id, "groq");
  assert.equal(detectProvider("sk-or-v1-12345678901234567890").id, "openrouter");
  assert.equal(detectProvider("csk-12345678901234567890").id, "cerebras");
  assert.equal(detectProvider("fw_12345678901234567890").id, "fireworks");
});

test("recognises known but currently incompatible provider protocols", () => {
  assert.equal(detectProvider("sk-ant-api03-12345678901234567890").id, "anthropic");
  assert.equal(detectProvider("AIza123456789012345678901234567890").id, "gemini");
  assert.equal(detectProvider("random-key-format").id, "unknown");
});

test("maps provider responses to distinct status states", () => {
  assert.equal(classifyProviderResponse(200), "connected");
  assert.equal(classifyProviderResponse(401), "invalid");
  assert.equal(classifyProviderResponse(403), "expired");
  assert.equal(classifyProviderResponse(404), "incompatible");
  assert.equal(classifyProviderResponse(503), "unreachable");
  assert.equal(providerStatusLabel("connected"), "Connected");
  assert.match(providerStatusLabel("incompatible"), /not compatible/i);
});

test("filters non-chat model IDs and removes duplicates", () => {
  assert.deepEqual(selectChatModels(["gpt-4o", "text-embedding-3-small", "gpt-4o", "whisper-1", "claude-sonnet"]), ["claude-sonnet", "gpt-4o"]);
});
