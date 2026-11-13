import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync(new URL("../src/model-eligibility.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { automaticModels, freeModel } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("Automatic only routes to models on the free-tier policy and never to an unknown or paid model", () => {
  assert.deepEqual(automaticModels("groq", ["llama-3.3-70b-versatile", "brand-new-model"]), ["llama-3.3-70b-versatile"]);
  assert.deepEqual(automaticModels("groq", ["brand-new-model"]), []);
  assert.deepEqual(automaticModels("google_ai_studio", ["gemini-2.5-flash", "gemini-2.5-pro"]), ["gemini-2.5-flash"]);
  assert.deepEqual(automaticModels("openrouter", ["openai/gpt-5", "meta-llama/llama-3.3-70b-instruct:free"]), ["meta-llama/llama-3.3-70b-instruct:free"]);
});

test("Cerebras keys are stored but excluded from zero-cost Automatic routing (trial credits need a payment method)", () => {
  assert.equal(freeModel("cerebras", "llama3.1-8b"), false);
  assert.deepEqual(automaticModels("cerebras", ["llama3.1-8b", "gpt-oss-120b"]), []);
});

test("Mistral's free-plan model families are recognised", () => {
  assert.deepEqual(automaticModels("mistral", ["mistral-small-latest", "ministral-8b-latest", "pixtral-12b-2409", "codestral-latest", "devstral-small-latest", "magistral-small-latest"]).length, 6);
  assert.deepEqual(automaticModels("mistral", ["mistral-embed", "mistral-moderation-latest"]), []);
});

test("non-chat and temporarily blocked models are excluded", () => {
  assert.deepEqual(automaticModels("groq", ["whisper-large-v3", "playai-tts", "llama-3.3-70b-versatile"]), ["llama-3.3-70b-versatile"]);
  const future = new Date(Date.now() + 3_600_000).toISOString();
  assert.deepEqual(automaticModels("groq", ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], { "llama-3.3-70b-versatile": future }), ["llama-3.1-8b-instant"]);
  const past = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual(automaticModels("groq", ["llama-3.3-70b-versatile"], { "llama-3.3-70b-versatile": past }), ["llama-3.3-70b-versatile"]);
});
