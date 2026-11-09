import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("the canonical shell loads one replacement stylesheet and removes orb markup", async () => {
  const html = await read("index.html");
  const css = await read("src/chatgpt-ui.css");
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(links, ["./src/chatgpt-ui.css"]);
  for (const id of ["menu-btn", "new-btn", "thread", "hero", "greeting", "suggestions", "messages", "composer", "prompt", "send-btn", "drawer", "history", "workspace-panel", "connectors-panel", "sheet-wrap"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing live UI node: ${id}`);
  }
  assert.doesNotMatch(html, /avatar-orbit|id="avatar"|class="stage"/);
  assert.match(css, /--bg:\s*#212121/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "the rebuilt shell must not introduce duplicate IDs");
});

test("clean chat UI preserves responsive layout, focus visibility, and reduced motion", async () => {
  const css = await read("src/chatgpt-ui.css");
  assert.match(css, /@media \(max-width:\s*899px\)/);
  assert.match(css, /@media \(min-width:\s*900px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  for (const selector of [".hero-intro", ".quick-start", ".suggestions", ".composer", "#drawer", ".sheet", ".feature-screen"]) {
    assert.ok(css.includes(selector), `missing redesigned surface: ${selector}`);
  }
});

test("desktop sidebar, feature screens, and transient sheets have a safe stacking order", async () => {
  const css = await read("src/chatgpt-ui.css");
  assert.match(css, /#drawer\s*\{[\s\S]*?z-index:\s*50/);
  assert.match(css, /\.scrim\s*\{[\s\S]*?z-index:\s*45/);
  assert.match(css, /\.feature-screen,\s*#connectors-panel[\s\S]*?z-index:\s*30/);
  assert.match(css, /\.sheet-wrap\s*\{[\s\S]*?z-index:\s*80/);
});

test("monochrome orb identity stays aligned across web, Android generator, and adaptive icon", async () => {
  const [mark, generator, vector, background] = await Promise.all([
    read("src/mark.ts"),
    read("android/tools/generate_assets.py"),
    read("android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml"),
    read("android/app/src/main/res/drawable/ic_launcher_background.xml"),
  ]);
  assert.match(mark, /ultron-core/);
  assert.match(mark, /<circle cx="54" cy="54" r="11"/);
  assert.ok(generator.includes("ORBIT_CENTER = (54.0, 54.0)"));
  assert.ok(generator.includes("Two orbital ellipses and a three-layer plasma nucleus"));
  assert.doesNotMatch(generator, /U_START|U_CURVE|U_STROKE|CREST/);
  assert.match(vector, /android:strokeColor="#AEB4BD" android:strokeWidth="2.5"/);
  assert.match(vector, /android:strokeColor="#E2E5E9" android:strokeWidth="2.4"/);
  assert.doesNotMatch(mark, /M34 34v21/);
  assert.match(background, /#080609/);
  assert.ok(generator.includes("Poly = list[tuple[float, float]]"));
});


test("single-chat shell keeps tools and memory available from the drawer", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  for (const id of ["nav-chat", "agent-identities-screen", "vault-screen", "drawer-identities", "drawer-mindmap", "connectors-btn", "settings-btn"]) {
    assert.ok(html.includes(`id=\"${id}\"`), `missing drawer destination: ${id}`);
  }
  for (const id of ["agents-screen", "worlds-screen", "luonix-screen", "more-screen", "nav-agents", "nav-worlds", "nav-luonix", "nav-more"]) {
    assert.ok(!html.includes(`id=\"${id}\"`), `retired destination still exists: ${id}`);
  }
  assert.match(main, /showFeatureScreen\(\"agent-identities-screen\"/);
  assert.match(main, /showFeatureScreen\(\"vault-screen\"/);
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
  assert.match(main, /attachRequestedArtifact\(task, finalContent, progressBody\)/);
  assert.match(kernel, /pdf\|docx\|pptx/);
  assert.match(kernel, /invisible internal quality-control pass/);
  assert.doesNotMatch(kernel, /You are Ultron.s independent quality reviewer/);
});


test("chat has an in-place model switcher with model discovery shortcuts", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/chatgpt-ui.css", import.meta.url), "utf8");
  for (const id of ["chat-model-button", "chat-model-label", "chat-model-menu", "chat-model-current", "chat-model-status", "chat-model-options", "chat-model-download", "chat-model-settings"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing model switcher control ${id}`);
  }
  assert.match(main, /async function openChatModelMenu\(/);
  assert.match(main, /NativeLocalAI\.loadModel\(\{ name: model\.name, projectorName: selectedNativeProjectorName \|\| undefined \}\)/);
  assert.match(main, /NativeLocalAI\.unloadModel\(\)/);
  assert.match(css, /\.chat-model-menu\s*\{/);
  assert.match(css, /\.chat-model-button\s*\{/);
});

test("chat shell has no stray literal newline and composer respects mobile safe areas", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/chatgpt-ui.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /\\\\n<nav/);
  assert.match(css, /\.dock\s*\{[\s\S]*?flex:\s*0\s+0\s+auto/);
  assert.match(css, /\.bottom-nav\s*\{/);
  assert.match(css, /--safe-bottom:\s*env\(safe-area-inset-bottom/);
});

test("empty home state never auto-scrolls the greeting out of view", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /if \(has\) scrollToEnd\(false\);\s*else threadEl\.scrollTop = 0;/);
});

test("the conversation shell contains no orb renderer or orbital DOM", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(main, /initializeAvatar|import\(["']three["']\)|avatarSync|avatarTheme/);
  assert.doesNotMatch(html, /avatar-orbit|id="avatar"|class="stage"/);
});

test("mobile empty state keeps quick starts compact above the composer", async () => {
  const css = await readFile(new URL("../src/chatgpt-ui.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.hero \{[\s\S]*?padding: 24px 0/);
  assert.match(css, /\.suggestions\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /\.dock\s*\{[\s\S]*?var\(--safe-bottom\)/);
});

test("model picker lives above the composer and request progress survives streamed tokens", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const composer = html.indexOf('id="composer"');
  const modelButton = html.indexOf('id="chat-model-button"');
  const topbarEnd = html.indexOf("</header>");
  assert.ok(modelButton > composer && modelButton < html.indexOf('id="prompt"'));
  assert.ok(modelButton > topbarEnd, "model selector must not occupy the top header");
  assert.match(main, /function renderStreamedReply\(/);
  assert.match(main, /livePanel\?\.remove\(\)[\s\S]*?renderMarkdown\(content, body\)[\s\S]*?body\.appendChild\(livePanel\)/);
  assert.match(main, /stage: "starting", label: "Working on your request"/);
});

test("model downloads validate the catalogue size and tolerate slow mobile transfers", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const native = await readFile(new URL("../android/app/src/main/java/app/ultron/mobile/UltronLocalAiPlugin.java", import.meta.url), "utf8");
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

test("the neutral identity is unified and mobile content stays within the viewport", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const chatUi = await readFile(new URL("../src/chatgpt-ui.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /redline\.css/);
  assert.match(chatUi, /html, body\s*\{[^}]*width:\s*100%/);
  assert.match(chatUi, /#app\s*\{[^}]*width:\s*100%/);
  assert.match(chatUi, /height:\s*100dvh/);
  assert.match(chatUi, /min-width:\s*320px/);
});


test("version 3 uses a neutral ULTRON identity and retains native capability entry points", async () => {
  const [pkg, main, html, mark] = await Promise.all([
    read("package.json"), read("src/main.ts"), read("index.html"), read("src/mark.ts"),
  ]);
  assert.match(pkg, /"version"\s*:\s*"3\.\d+\.\d+"/);
  assert.ok(main.includes('type ThemeId = "ultron"'));
  assert.ok(main.includes("accent: 0x9ca3af"));
  assert.ok(main.includes("importNativeModel()"));
  assert.ok(main.includes("initConnectors("));
  assert.ok(main.includes("NativeRuntime"));
  assert.ok(main.includes("NativeCompanion"));
  assert.ok(html.includes('id="chat-model-import"'));
  assert.ok(!html.includes('id="ultron-runtime-download"'), "runtime installation controls must stay out of Settings");
  assert.ok(!html.includes('id="ultron-runtime-install"'), "runtime ZIP picker must stay out of Settings");
  assert.ok(main.includes("NativeRuntime"), "the headless runtime remains available to ULTRON's internal tools");
  assert.ok(mark.includes("ultron-core"));
  assert.ok(mark.includes("#9ca3af"));
});

test("chat is the only primary surface and retired Worlds, Luonix, Agents, and More screens are removed", async () => {
  const html = await read("index.html");
  const main = await read("src/main.ts");
  for (const retired of ["agents-screen", "worlds-screen", "luonix-screen", "more-screen", "nav-agents", "nav-worlds", "nav-luonix", "nav-more"]) {
    assert.doesNotMatch(html, new RegExp(`id=\\"${retired}\\"`), `${retired} must not ship as a destination`);
  }
  assert.match(html, /id="nav-chat"/);
  assert.match(html, /id="drawer-identities"/);
  assert.match(html, /id="drawer-mindmap"/);
  assert.match(html, /id="connectors-btn"/);
  assert.match(html, /id="settings-btn"/);
  assert.match(main, /showFeatureScreen\("agent-identities-screen"/);
  assert.match(main, /showFeatureScreen\("vault-screen"/);
});

test("ULTRON is the only active identity and its programmed brain is separate from the imported model", async () => {
  const [identity, brain, main, html] = await Promise.all([read("src/agent-identities.ts"), read("src/ultron-brain.ts"), read("src/main.ts"), read("index.html")]);
  assert.match(identity, /active: "ultron"/);
  assert.match(html, /data-identity="ultron"/);
  assert.doesNotMatch(html, /data-identity="(?:jarvis|luokai)"/);
  assert.match(brain, /ULTRON PROGRAMMED IDENTITY RUNTIME/);
  assert.match(brain, /classifyUltronTask/);
  assert.match(brain, /createUltronPlan/);
  assert.match(brain, /rankUltronMemory/);
  assert.match(brain, /assessUltronTool/);
  assert.match(brain, /validateUltronDraft/);
  assert.match(main, /buildUltronBrainContract/);
  assert.match(main, /resolveIdentityPrompt\(identityState\)/);
  assert.match(main, /identityState\.customInstructions/);
});

test("mind map combines semantic memory nodes and relationships with conversation-derived nodes", async () => {
  const map = await read("src/mind-map.ts");
  const main = await read("src/main.ts");
  assert.match(map, /type MemoryGraph/);
  assert.match(map, /memory\?\.nodes/);
  assert.match(map, /memory\?\.edges/);
  assert.match(map, /confidence\?: number/);
  assert.match(main, /buildMindMap\(store\.conversations,semanticGraph\)/);
});

test("active identity is visible beside the brain selector and opens the identity switcher", async () => {
  const html = await read("index.html");
  const main = await read("src/main.ts");
  assert.match(html, /id="active-identity-button"/);
  assert.match(main, /activeIdentityButton\.textContent = activeProfile\.name/);
  assert.match(main, /activeIdentityButton\.addEventListener\("click"/);
});

test("mind map export preserves graph confidence and semantic relationships", async () => {
  const map = await read("src/mind-map.ts");
  assert.match(map, /## Relationships/);
  assert.match(map, /confidence \$\{node\.confidence/);
  assert.match(map, /edge\.relation/);
  assert.match(map, /ULTRON Shared Mind Map/);
});


test("decorative identity theme picker is hidden while identity controls remain available", async () => {
  const [html, css] = await Promise.all([read("index.html"), read("src/chatgpt-ui.css")]);
  const identityStart = html.indexOf('id="agent-identities-screen"');
  const themePicker = html.indexOf('id="themes"');
  assert.ok(identityStart >= 0 && themePicker > identityStart);
  assert.match(html.slice(identityStart, themePicker), /ULTRON IDENTITY/);
  assert.match(css, /\.identity-visual-section\s*\{\s*display:none\s*!important/);
});

test("empty mind map hides the empty SVG canvas and removes its forced horizontal pan", async () => {
  const source = await readFile(path.join(root, "src/main.ts"), "utf8");
  const css = await readFile(path.join(root, "src/chatgpt-ui.css"), "utf8");
  assert.match(source, /classList\.toggle\("is-empty",empty\)/);
  assert.match(css, /\.mindmap-canvas-wrap\.is-empty \.mindmap-canvas \{ display: none; \}/);
  assert.match(css, /\.mindmap-canvas-wrap\.is-empty \{[\s\S]*?overflow: hidden/);
});

test("Learning Review filter controls meet the minimum touch target", async () => {
  const css = await read("src/chatgpt-ui.css");
  assert.match(css, /\.learning-filters button \{[\s\S]*?min-width:48px;[\s\S]*?min-height:48px;/);
});

test("the replacement interface avoids ambient motion and decorative atmosphere", async () => {
  const [html, css] = await Promise.all([read("index.html"), read("src/chatgpt-ui.css")]);
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(links, ["./src/chatgpt-ui.css"]);
  assert.doesNotMatch(css, /ultron-grid-drift|ultron-nebula-turn|ultron-core-float|backdrop-filter:\s*blur/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /transition:\s*background \.15s/);
});


test("LLM API Keys exposes an explicit owner-session and provider-pool reconnect action", async () => {
  const [html, main, css] = await Promise.all([read("index.html"), read("src/main.ts"), read("src/chatgpt-ui.css")]);
  assert.match(html, /id="cloud-llm-refresh"/);
  assert.match(main, /#cloud-llm-refresh/);
  assert.match(main, /Reconnecting…/);
  assert.match(css, /\.llm-key-card/);
  assert.match(css, /\.llm-key-actions/);
});
