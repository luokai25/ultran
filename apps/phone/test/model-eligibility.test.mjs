import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync(new URL("../src/model-eligibility.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { automaticModels, freeModel } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("a Cerebras key is usable in Automatic mode (its free tier is attached to the key)", () => {
  assert.deepEqual(automaticModels("cerebras", ["llama3.1-8b", "gpt-oss-120b"]).sort(), ["gpt-oss-120b", "llama3.1-8b"]);
  assert.equal(freeModel("cerebras", "llama3.1-8b"), true);
});

test("known free-tier models win; unknown model names no longer make a valid key useless", () => {
  assert.deepEqual(automaticModels("groq", ["llama-3.3-70b-versatile", "brand-new-model"]), ["llama-3.3-70b-versatile"]);
  assert.deepEqual(automaticModels("groq", ["brand-new-model"]), ["brand-new-model"]);
  assert.deepEqual(automaticModels("mistral", ["pixtral-large-latest", "ministral-8b-latest"]).sort(), ["ministral-8b-latest", "pixtral-large-latest"]);
  assert.deepEqual(automaticModels("google_ai_studio", ["gemini-9-ultra"]), ["gemini-9-ultra"]);
});

test("OpenRouter never auto-selects paid models, because they bill per token", () => {
  assert.deepEqual(automaticModels("openrouter", ["openai/gpt-5", "meta-llama/llama-3.3-70b-instruct:free"]), ["meta-llama/llama-3.3-70b-instruct:free"]);
  assert.deepEqual(automaticModels("openrouter", ["openai/gpt-5"]), []);
});

test("non-chat and temporarily blocked models are excluded", () => {
  assert.deepEqual(automaticModels("groq", ["whisper-large-v3", "playai-tts", "llama-3.3-70b-versatile"]), ["llama-3.3-70b-versatile"]);
  const future = new Date(Date.now() + 3_600_000).toISOString();
  assert.deepEqual(automaticModels("groq", ["llama-3.3-70b-versatile", "mystery-model"], { "llama-3.3-70b-versatile": future }), ["mystery-model"]);
  const past = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual(automaticModels("groq", ["llama-3.3-70b-versatile"], { "llama-3.3-70b-versatile": past }), ["llama-3.3-70b-versatile"]);
});
