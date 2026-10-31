import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("new mobile experience stylesheet is loaded after the base and workspace styles", async () => {
  const html = await read("index.html");
  const base = html.indexOf("./src/styles.css");
  const workspace = html.indexOf("./src/workspace.css");
  const experience = html.indexOf("./src/experience.css");
  assert.ok(base >= 0 && workspace > base && experience > workspace);
  for (const id of ["menu-btn", "new-btn", "thread", "hero", "avatar", "greeting", "suggestions", "messages", "composer", "prompt", "send-btn", "drawer", "history", "workspace-panel", "connectors-panel", "sheet-wrap"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing live UI node: ${id}`);
  }
  const ids = [...html.matchAll(/\\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "the rebuilt shell must not introduce duplicate IDs");
});

test("redesigned UI preserves mobile layout, focus visibility, and reduced-motion support", async () => {
  const css = await read("src/experience.css");
  assert.ok(css.includes("@media(max-width:430px)"));
  assert.ok(css.includes("@media(min-width:700px)"));
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /:focus-visible/);
  for (const selector of [".hero-intro", ".quick-start", ".suggestions", ".composer", ".drawer", ".sheet", ".workspace-panel"]) {
    assert.ok(css.includes(selector), `missing redesigned surface: ${selector}`);
  }
});

test("orbital U identity is shared by the web mark and Android launcher generator", async () => {
  const [mark, generator, vector, background] = await Promise.all([
    read("src/mark.ts"),
    read("android/tools/generate_assets.py"),
    read("android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml"),
    read("android/app/src/main/res/drawable/ic_launcher_background.xml"),
  ]);
  for (const detail of ['cx="54" cy="54" r="37"', "M34 34v21c0 27 40 27 40 0V34", "M54 23l6 7-6 7-6-7z", 'cx="81" cy="35" r="3"']) {
    assert.ok(mark.includes(detail), `web mark is missing orbital detail ${detail}`);
  }
  assert.ok(generator.includes("ORBIT_RADIUS = 37.0"));
  assert.ok(generator.includes("U_CURVE = ((34.0, 82.0), (74.0, 82.0), (74.0, 55.0))"));
  assert.match(vector, /android:strokeColor="#CDA94D"/);
  assert.match(vector, /android:strokeColor="#F0D58A"/);
  assert.match(vector, /M34,34 L34,55 C34,82 74,82 74,55 L74,34/);
  assert.match(background, /#0B0D0F/);
  assert.ok(generator.includes("OBSIDIAN = (11, 13, 15)"));
});
