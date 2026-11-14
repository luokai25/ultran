import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const toUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const src = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const transpile = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;

const cohere = toUrl(transpile(src("cohere-sse.ts")));
const adapters = toUrl(transpile(src("provider-adapters.ts")).replace('"./cohere-sse"', JSON.stringify(cohere)));
const cloudStub = toUrl("export const addUltronCloudKey = async () => { throw new Error('not used'); };");
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const mod = await import(toUrl(transpile(src("bundled-keys.ts")).replace('"./cloud-llm"', JSON.stringify(cloudStub)).replace('"./provider-adapters"', JSON.stringify(adapters))));
const { parseBundledKeys, seedBundledKeys, isFinalKeyFailure } = mod;

const raw = (rows) => JSON.stringify(rows);
const KEYS = [
  { p: "groq", k: "gsk_aaaaaaaaaaaaaaaaaaaa" }, { p: "groq", k: "gsk_bbbbbbbbbbbbbbbbbbbb" },
  { p: "openrouter", k: "sk-or-v1-cccccccccccccccc" }, { p: "google_ai_studio", k: "AQ.Ab8dddddddddddddddd" },
];

test("parsing keeps valid provider keys, drops junk and duplicates, and tolerates garbage input", () => {
  assert.deepEqual(parseBundledKeys(undefined), []);
  assert.deepEqual(parseBundledKeys(""), []);
  assert.deepEqual(parseBundledKeys("not json"), []);
  assert.deepEqual(parseBundledKeys('{"p":"groq"}'), []);
  const rows = parseBundledKeys(raw([...KEYS, KEYS[0], { p: "nope", k: "x".repeat(30) }, { p: "groq", k: "short" }, { p: "groq", k: "has space in key here" }, null, 7]));
  assert.deepEqual(rows.map((r) => r.provider), ["groq", "groq", "openrouter", "google_ai_studio"]);
});

test("each key is verified and added once, labelled by provider, and never re-added", async () => {
  store.clear();
  const added = [];
  const add = async (provider, key, label) => { added.push({ provider, key, label }); return { ok: true }; };
  const first = await seedBundledKeys(raw(KEYS), add);
  assert.deepEqual(first, { total: 4, added: 4, invalid: 0, pending: 0 });
  assert.deepEqual(added.map((a) => a.label).sort(), ["Built-in Google AI Studio 1", "Built-in Groq 1", "Built-in Groq 2", "Built-in OpenRouter 1"]);
  const second = await seedBundledKeys(raw(KEYS), add);
  assert.equal(second.added, 0);
  assert.equal(added.length, 4, "a key the owner removed later is not put back");
});

test("a rejected key is final, while offline or rate-limited keys are retried on the next launch", async () => {
  store.clear();
  const calls = [];
  const flaky = async (provider, key) => {
    calls.push(key);
    if (key.startsWith("gsk_aaaa")) throw new Error("Groq rejected this API key (HTTP 401). Invalid API Key");
    if (key.startsWith("gsk_bbbb")) throw new Error("Could not reach Groq from this device: Failed to fetch");
    if (key.startsWith("sk-or")) throw new Error("OpenRouter is rate limiting this key right now (HTTP 429). Try again shortly.");
    return { ok: true };
  };
  const first = await seedBundledKeys(raw(KEYS), flaky);
  assert.deepEqual(first, { total: 4, added: 1, invalid: 1, pending: 2 });
  calls.length = 0;
  const second = await seedBundledKeys(raw(KEYS), async (p, k) => { calls.push(k); return { ok: true }; });
  assert.deepEqual(calls.sort(), ["gsk_bbbbbbbbbbbbbbbbbbbb", "sk-or-v1-cccccccccccccccc"], "only the transient failures are retried; the invalid key is not");
  assert.equal(second.added, 2);
});

test("failure classification and secret hygiene", () => {
  assert.equal(isFinalKeyFailure("Groq rejected this API key (HTTP 401)."), true);
  assert.equal(isFinalKeyFailure("Google denied access for this API key (HTTP 403)."), true);
  assert.equal(isFinalKeyFailure("The provider accepted the key but returned no compatible chat models."), true);
  assert.equal(isFinalKeyFailure("Groq is temporarily unavailable (HTTP 503)."), false);
  assert.equal(isFinalKeyFailure("Could not reach Groq from this device."), false);
  const seeder = src("bundled-keys.ts");
  assert.match(seeder, /crypto\.subtle\.digest\("SHA-256"/, "seeding state stores hashes, not keys");
  assert.match(src("main.ts"), /void seedBundledKeys\(\)/);
  const workflow = readFileSync(new URL("../../../.github/workflows/android-release.yml", import.meta.url), "utf8");
  assert.match(workflow, /VITE_ULTRON_BUNDLED_KEYS: \$\{\{ secrets\.ULTRON_BUNDLED_KEYS \}\}/);
  assert.doesNotMatch(readFileSync(new URL("../../../.gitignore", import.meta.url), "utf8") + "", /API_keys/, "no key file is tracked by name");
});
