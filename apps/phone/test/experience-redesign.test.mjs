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

test("plasma orb identity stays aligned across web, Android generator, and adaptive icon", async () => {
  const [mark, generator, vector, background] = await Promise.all([
    read("src/mark.ts"),
    read("android/tools/generate_assets.py"),
    read("android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml"),
    read("android/app/src/main/res/drawable/ic_launcher_background.xml"),
  ]);
  assert.match(mark, /ultran-core/);
  assert.match(mark, /<circle cx="54" cy="54" r="11"/);
  assert.ok(generator.includes("ORBIT_CENTER = (54.0, 54.0)"));
  assert.ok(generator.includes("Two orbital ellipses and a three-layer plasma nucleus"));
  assert.doesNotMatch(generator, /U_START|U_CURVE|U_STROKE|CREST/);
  assert.match(vector, /android:strokeColor="#E52D41" android:strokeWidth="2.5"/);
  assert.match(vector, /android:strokeColor="#FF7180" android:strokeWidth="2.4"/);
  assert.doesNotMatch(mark, /M34 34v21/);
  assert.match(background, /#080609/);
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


test("local file requests have a real PDF fallback and artifact card actions", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const kernel = await readFile(new URL("../src/capability-kernel.ts", import.meta.url), "utf8");
  assert.match(main, /low\.split\(\/\\s\+\/\)/, "artifact intent detection must split on actual whitespace");
  assert.match(main, /chat-deliverable/, "the final answer should surface a visible deliverable card");
  assert.match(main, /portable Markdown version preserves the generated content/);
  assert.match(main, /function localPdfBlob\(/);
  assert.match(main, /async function attachRequestedArtifact\(/);
  assert.match(main, /URL\.createObjectURL\(blob\)/);
  assert.match(main, /downloadArtifact\(call\.artifact/);
  assert.match(main, /function artifactPreviewUrl\(/);
  assert.match(main, /baseUrl\(\)\}\$\{url/);
  assert.match(main, /attachRequestedArtifact\(text, finalContent, reply\.body\)/);
  assert.match(main, /attachRequestedArtifact\(task, content, progressBody\)/);
  assert.match(kernel, /pdf\|docx\|pptx/);
  assert.match(kernel, /invisible internal quality-control pass/);
  assert.doesNotMatch(kernel, /You are Ultran.s independent quality reviewer/);
});


test("chat has an in-place model switcher with model discovery shortcuts", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/experience.css", import.meta.url), "utf8");
  for (const id of ["chat-model-button", "chat-model-label", "chat-model-menu", "chat-model-current", "chat-model-status", "chat-model-options", "chat-model-download", "chat-model-settings"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing model switcher control ${id}`);
  }
  assert.match(main, /async function openChatModelMenu\(/);
  assert.match(main, /NativeLocalAI\.loadModel\(\{ name: model\.name \}\)/);
  assert.match(main, /NativeLocalAI\.unloadModel\(\)/);
  assert.match(css, /\.chat-model-menu\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.chat-model-button\[data-ready="true"\]/);
});

test("model downloads validate the catalogue size and tolerate slow mobile transfers", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const native = await readFile(new URL("../android/app/src/main/java/app/ultran/mobile/UltranLocalAiPlugin.java", import.meta.url), "utf8");
  assert.match(main, /NativeLocalAI\.downloadModel\(/);
  assert.match(main, /CURATED_MODELS/);
  assert.match(native, /optLong\("expectedBytes", -1L\)/);
  assert.match(native, /setReadTimeout\(120000\)/);
  assert.match(native, /received != expectedBytes/);
});


test("generic file requests produce a deliverable and live tool events update in place", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /low.includes\("file"\) \|\| low.includes\("attachment"\)/);
  assert.match(main, /data-tool-key/);
  assert.match(main, /candidate.dataset.toolKey === toolKey/);
});


test("model import is directly reachable from the model picker", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(html, /id=\"chat-model-import\"/);
  assert.match(main, /#chat-model-import[\s\S]*?importNativeModel\(\)/);
});

test("the plasma-red identity is unified and mobile content stays within the viewport", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const experience = await readFile(new URL("../src/experience.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /redline\.css/);
  assert.match(experience, /html,body\{width:100%;max-width:100%;overflow-x:hidden\}/);
  assert.match(experience, /#app\{width:100%;max-width:760px;min-width:0/);
});

\ntest("version 3 keeps one red theme and retains native capability entry points", async () => {
  const [pkg, main, html, mark] = await Promise.all([
    read("package.json"), read("src/main.ts"), read("index.html"), read("src/mark.ts"),
  ]);
  assert.match(pkg, /"version": "3\\.0\\.0"/);
  assert.match(main, /type ThemeId = "ultran"/);
  assert.match(main, /accent: 0xe52d41/);
  assert.match(main, /importNativeModel\\(\\)/);
  assert.match(main, /initConnectors\\(/);
  assert.match(main, /NativeRuntime/);
  assert.match(main, /NativeCompanion/);
  assert.match(html, /id="chat-model-import"/);
  assert.match(html, /id="ultran-runtime-download"/);
  assert.match(mark, /ultran-core/);
  assert.match(mark, /#ff304b/);
});
