import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../../../api/cohere-sse.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createCohereSseParser } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

test("parses complete Cohere text delta events", () => {
  const parser = createCohereSseParser();
  assert.deepEqual(parser.push('data: {"delta":{"message":{"content":{"text":"Hello"}}}}\n'), ["Hello"]);
});

test("buffers partial events across arbitrary network chunks", () => {
  const parser = createCohereSseParser();
  assert.deepEqual(parser.push('data: {"delta":{"text":"hel'), []);
  assert.deepEqual(parser.push('lo"}}\n'), ["hello"]);
});

test("handles CRLF event boundaries and multiple events in one chunk", () => {
  const parser = createCohereSseParser();
  assert.deepEqual(
    parser.push('data: {"delta":{"text":"one"}}\r\ndata: {"delta":{"text":"two"}}\r\n'),
    ["one", "two"],
  );
});

test("flushes a final event without a trailing newline", () => {
  const parser = createCohereSseParser();
  assert.deepEqual(parser.push('data: {"delta":{"text":"last"}}', true), ["last"]);
});

test("ignores metadata, malformed events, empty data and provider terminators", () => {
  const parser = createCohereSseParser();
  assert.deepEqual(
    parser.push(': keepalive\nevent: content-delta\ndata: not-json\ndata:\ndata: [DONE]\n'),
    [],
  );
});
