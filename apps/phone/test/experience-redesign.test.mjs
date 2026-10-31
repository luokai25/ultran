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

test("new monogram is shared by the web mark, Android generator, and adaptive launcher vector", async () => {
  const [mark, generator, vector, background] = await Promise.all([
    read("src/mark.ts"),
    read("android/tools/generate_assets.py"),
    read("android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml"),
    read("android/app/src/main/res/drawable/ic_launcher_background.xml"),
  ]);
  for (const coordinate of ["54,14", "83,29", "83,70", "54,94", "39,38", "69,60", "63,71"]) {
    assert.ok(mark.includes(coordinate), `web mark is missing geometry ${coordinate}`);
    assert.ok(generator.includes(coordinate), `launcher generator is missing geometry ${coordinate}`);
  }
  assert.match(vector, /M54,14 L83,29 L83,70 L54,94/);
  assert.match(vector, /M39,38 L48,38 L48,58/);
  assert.match(background, /#0B0D0F/);
  assert.ok(generator.includes("OBSIDIAN = (11, 13, 15)"));
});
