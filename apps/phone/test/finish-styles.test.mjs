import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("the canonical client loads one replacement stylesheet instead of stacked theme layers", async () => {
  const html = await read("index.html");
  const paths = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(paths, ["./src/chatgpt-ui.css"]);
});

test("new design tokens, responsive layouts and accessibility are present in the shipped stylesheet", async () => {
  const css = await read("src/chatgpt-ui.css");
  assert.match(css, /--bg:\s*#212121/i);
  assert.match(css, /--surface:\s*#2f2f2f/i);
  assert.match(css, /--accent:\s*#10a37f/i);
  assert.match(css, /--accent-hover:\s*#0e9272/i);
  assert.match(css, /max-width:\s*520px/);
  assert.match(css, /max-width:\s*899px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\[hidden\].*display: none !important/);
  assert.match(css, /overscroll-behavior/);
});


test("the active accent is restrained green and the interface uses neutral charcoal surfaces", async () => {
  const css = await read("src/chatgpt-ui.css");
  assert.match(css, /--accent:\s*#10a37f/i);
  assert.match(css, /--accent-hover:\s*#0e9272/i);
  assert.match(css, /--bg:\s*#212121/i);
  assert.match(css, /--surface:\s*#2f2f2f/i);
  assert.doesNotMatch(css, /#d5b779|#e8cb91|#e34b58|#ff2a2a/i);
});


test("local model import is available from the model picker without a duplicate home action", async () => {
  const html = await read("index.html");
  const app = await read("src/main.ts");
  assert.doesNotMatch(html, /id="hero-import-model"/);
  assert.match(html, /id="chat-model-import"/);
  assert.match(app, /#chat-model-import[\s\S]*?importNativeModel\(\)/);
});


test("knowledge map uses the neutral monochrome Ultron palette", async () => {
  const map = await read("src/mind-map.ts");
  assert.match(map, /root:\s*"#e5e7eb"/);
  assert.match(map, /project:\s*"#c4c9d1"/);
  assert.doesNotMatch(map, /#e5c36b|#c99b52/i);
});
