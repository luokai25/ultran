import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("Ultran v3 finishing stylesheet is loaded after all existing theme layers", async () => {
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
    "rgba(217,185,108", "rgba(196,155,77",
  ]) {
    assert.equal(css.toLowerCase().includes(legacyColor.toLowerCase()), false,
      "retired gold color " + legacyColor + " must not appear in the phone experience layer");
  }
});
