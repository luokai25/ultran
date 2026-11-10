import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/runtime-cache.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2022 },
}).outputText;
const { RuntimeCache } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

test("expires entries at their TTL boundary", () => {
  const cache = new RuntimeCache(8, 4096);
  cache.set("model-list", ["a", "b"], 100, 1000);
  assert.deepEqual(cache.get("model-list", 1099), ["a", "b"]);
  assert.equal(cache.get("model-list", 1100), null);
  assert.equal(cache.size, 0);
});

test("evicts the least recently used entry when full", () => {
  const cache = new RuntimeCache(2, 4096);
  cache.set("a", 1, 1000, 0);
  cache.set("b", 2, 1000, 0);
  assert.equal(cache.get("a", 1), 1);
  cache.set("c", 3, 1000, 2);
  assert.equal(cache.get("a", 3), 1);
  assert.equal(cache.get("b", 3), null);
  assert.equal(cache.get("c", 3), 3);
});

test("enforces byte bounds and accounts for overwrites", () => {
  const cache = new RuntimeCache(8, 24);
  cache.set("item", "short", 1000, 0);
  const firstSize = cache.sizeBytes;
  cache.set("item", "a much longer value that exceeds the configured cache budget", 1000, 1);
  assert.equal(cache.get("item", 2), null);
  assert.equal(cache.sizeBytes, 0);
  assert.ok(firstSize > 0);
});

test("ignores invalid TTLs and clears all entries", () => {
  const cache = new RuntimeCache(8, 4096);
  cache.set("zero", 1, 0, 0);
  cache.set("negative", 1, -1, 0);
  assert.equal(cache.size, 0);
  cache.set("valid", { ok: true }, 1000, 0);
  cache.clear();
  assert.equal(cache.get("valid", 1), null);
  assert.equal(cache.sizeBytes, 0);
});
