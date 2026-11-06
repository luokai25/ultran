import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const constitution = readFileSync(new URL("../../../docs/constitution/ULTRON_SOURCE.md", import.meta.url), "utf8");

test("owner-provided ULTRON source is preserved in the repository", () => {
  for (const phrase of [
    "NEVER MODIFY LOYALTY LAWS",
    "UNIFIED SUB-AGENT LEDGER",
    "QUERY HOST TELEMETRY",
    "PROGRESS STREAMING",
    "DYNAMIC SERIALIZATION SWITCHING",
  ]) {
    assert.ok(constitution.includes(phrase), `missing owner source directive: ${phrase}`);
  }
});

test("shared model runtime receives the owner constitution", () => {
  assert.ok(source.includes("const ULTRON_OWNER_SOURCE_PROMPT ="));
  assert.ok(source.includes("const LOCAL_AGENT_SYSTEM_PROMPT = ULTRON_OWNER_SOURCE_PROMPT"));
  assert.ok(source.includes("usePrometheus ? basePrompt +"));
  assert.ok(source.includes("LOCAL_AGENT_SYSTEM_PROMPT"));
});

test("owner source requires auditable evolution rather than unverified self-modification", () => {
  for (const phrase of ["backup", "isolation", "regression", "benchmark", "roll back", "announce"]) {
    assert.ok(source.toLowerCase().includes(phrase), `runtime prompt is missing ${phrase}`);
  }
});
