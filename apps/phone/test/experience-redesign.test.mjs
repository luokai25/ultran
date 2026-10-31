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
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
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

test("fixed navigation cannot sit above the drawer, connector panel, or settings sheet", async () => {
  const [base, experience, workspace] = await Promise.all([
    read("src/styles.css"), read("src/experience.css"), read("src/workspace.css"),
  ]);
  assert.match(experience, /\.bottom-nav\{position:fixed;z-index:15;/);
  assert.match(base, /\.scrim\s*\{[\s\S]*?z-index:\s*20/);
  assert.match(base, /\.drawer\s*\{[\s\S]*?z-index:\s*30/);
  assert.match(experience, /\.sheet-wrap\{z-index:40;/);
  assert.match(workspace, /\.workspace-panel\{position:fixed;z-index:60;/);
});

test("new orbital U mark stays aligned across web, Android generator, and adaptive icon", async () => {
  const [mark, generator, vector, background] = await Promise.all([
    read("src/mark.ts"),
    read("android/tools/generate_assets.py"),
    read("android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml"),
    read("android/app/src/main/res/drawable/ic_launcher_background.xml"),
  ]);
  assert.match(mark, /<circle cx="54" cy="54" r="37"/);
  assert.match(mark, /M34 34v21c0 27 40 27 40 0V34/);
  assert.ok(generator.includes("ORBIT_CENTER = (54.0, 54.0)"));
  assert.ok(generator.includes("ORBIT_RADIUS = 37.0"));
  assert.ok(generator.includes("U_CURVE = ((34.0, 82.0), (74.0, 82.0), (74.0, 55.0))"));
  assert.match(vector, /android:strokeColor="#CDA94D" android:strokeWidth="5"/);
  assert.match(vector, /android:strokeColor="#F0D58A" android:strokeWidth="9"/);
  assert.match(background, /#0B0D0F/);
  assert.ok(generator.includes("Poly = list[tuple[float, float]]"));
});


test("reference-inspired five-tab mobile navigation and feature screens are present", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  for (const id of ["nav-chat", "nav-agents", "nav-worlds", "nav-luonix", "nav-more", "agents-screen", "worlds-screen", "luonix-screen", "more-screen", "vault-screen"]) {
    assert.ok(html.includes(`id=\"${id}\"`), `missing reference UI section: ${id}`);
  }
  assert.match(main, /showFeatureScreen\(\"agents-screen\", navAgentsButton\)/);
  assert.match(main, /showFeatureScreen\(\"worlds-screen\", navWorldsButton\)/);
  assert.match(main, /showFeatureScreen\(\"luonix-screen\", navLuonixButton\)/);
  assert.match(main, /showFeatureScreen\(\"more-screen\", navMoreButton\)/);
  assert.match(html, /No files are represented as encrypted until encrypted storage is implemented and verified/);
});
