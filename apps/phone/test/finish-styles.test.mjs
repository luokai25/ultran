import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("Ultron v3 finishing stylesheet is loaded after all existing theme layers", async () => {
  const html = await read("index.html");
  const paths = [
    "./src/styles.css",
    "./src/workspace.css",
    "./src/experience.css",
    "./src/finish.css",
  ];
  const positions = paths.map((path) => html.indexOf(path));
  assert.ok(positions.every((position) => position >= 0), "every required stylesheet must be loaded");
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b),
    "finishing layer must load after base, workspace, and experience styles");
});

test("finishing layer maintains one accent and supports narrow devices and accessibility", async () => {
  const css = await read("src/finish.css");
  assert.match(css, /--gold:\s*#e52d41/i);
  assert.match(css, /--gold-bright:\s*#ff7180/i);
  assert.match(css, /max-width:\s*360px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /overscroll-behavior-x:\s*none/);
});


test("phone experience visuals do not reintroduce the retired gold palette", async () => {
  const css = await read("src/experience.css");
  for (const legacyColor of [
    "#fff5d8", "#f2ead8", "#f1d58e", "#a58f5b", "#e6cb83",
    "#e6c77a", "#e6c878", "#8e7140", "#6d532c", "#f0d99a", "#c49b4d",
    "rgba(217,185,108", "rgba(196,155,77", "rgba(220,196,131",
    "#9d8a5e", "#82734e", "#a18b58", "#c49b42", "#a48b51", "#9c906f",
    "#e5c77a", "#b88d37", "#e3c778", "#ebd18c", "#e8cf8b", "#ad9559",
    "#e9cd82", "#bb913e", "#b8a36d", "#d4b763", "#d9a852", "#cdb165",
    "#e8d39a", "#e7ca79", "#e9d18c", "#e6d39a", "#d7bb6c", "#e5d29a",
    "#ead28c", "#d9c17e", "#c99b52", "#c4a95f",
  ]) {
    assert.equal(css.toLowerCase().includes(legacyColor.toLowerCase()), false,
      "retired gold color " + legacyColor + " must not appear in the phone experience layer");
  }
});


test("local model import is directly discoverable on the home screen and wired to native import", async () => {
  const html = await read("index.html");
  const app = await read("src/main.ts");
  assert.match(html, /id="hero-import-model"[^>]*>Import a local model/);
  assert.match(app, /#hero-import-model[\s\S]{0,120}importNativeModel\(\)/);
});


test("knowledge map uses the unified Ultron plasma accent instead of legacy gold", async () => {
  const map = await read("src/mind-map.ts");
  assert.match(map, /root:\s*"#ff7180"/);
  assert.match(map, /project:\s*"#e52d41"/);
  assert.doesNotMatch(map, /#e5c36b|#c99b52/i);
});
