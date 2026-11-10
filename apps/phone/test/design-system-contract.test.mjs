import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFile(path.join(repo, relative), "utf8");

test("ULTRON design workflow and complete screen inventory remain installed", async () => {
  const [design, skill, gstack, ledger, agents] = await Promise.all([
    read("DESIGN.md"),
    read(".agents/skills/ultron-design/SKILL.md"),
    read(".agents/skills/ultron-gstack/SKILL.md"),
    read("docs/ULTRON-SCREEN-COVERAGE.md"),
    read("AGENTS.md"),
  ]);
  assert.match(design, /# ULTRON Design System/);
  assert.match(design, /Page inventory and design requirements/);
  assert.match(design, /ChatGPT/);
  assert.match(design, /No orb/);
  assert.match(skill, /ULTRON Design Studio/);
  assert.match(skill, /Verify every screen/);
  for (const [index, phase] of ["THINK", "PLAN", "DESIGN", "BUILD", "REVIEW", "TEST", "SHIP", "REFLECT"].entries()) {
    assert.ok(gstack.includes(`### ${index + 1}. ${phase}`), `gstack workflow is missing ${phase}`);
  }
  for (const area of ["Main conversation experience", "Models and provider credentials", "Memory and learning", "Agent configuration and capabilities", "Connectors and workspace", "Settings and transient surfaces", "Shared client screen inventory"]) {
    assert.ok(ledger.includes(area), `screen ledger is missing ${area}`);
  }
  assert.match(agents, /\.agents\/skills\/ultron-gstack\/SKILL\.md/);
  assert.match(agents, /\.agents\/skills\/ultron-design\/SKILL\.md/);
});

test("canonical phone client uses one clean stylesheet and keeps the existing backend client", async () => {
  const [html, css, main, cloudSync] = await Promise.all([
    read("apps/phone/index.html"),
    read("apps/phone/src/chatgpt-ui.css"),
    read("apps/phone/src/main.ts"),
    read("apps/phone/src/cloud-sync.ts"),
  ]);
  const stylesheetLinks = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(stylesheetLinks, ["./src/chatgpt-ui.css"]);
  assert.match(html, /<title>ULTRON<\/title>/);
  assert.doesNotMatch(html, /avatar-orbit|id="avatar"|class="stage"/);
  assert.match(css, /\.hero-kicker,\s*\.stage,\s*\.hero-status/);
  assert.match(css, /\.brand-mark,\s*#drawer-mark/);
  assert.match(css, /--bg:\s*#212121/);
  assert.match(css, /--surface:\s*#2f2f2f/);
  assert.match(css, /--accent:\s*#10a37f/);
  assert.match(css, /\.composer\s*\{/);
  assert.match(css, /#prompt\s*\{/);
  assert.match(css, /#drawer\s*\{/);
  for (const selector of [".identity-cards", ".llm-key-card", ".product-studio-form", ".learning-stats", ".capability-stats", ".conn-list", ".workspace-stats", ".mindmap-toolbar"]) {
    assert.ok(css.includes(selector), `missing shared secondary-page treatment: ${selector}`);
  }
  assert.match(css, /\.identity-visual-section, \.capability-hero-mark, \.github-mark/);
  assert.match(css, /\.feature-screen > :not\(\.feature-head\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(html, /src\/(?:styles|workspace|experience|finish|learning|design-system|quiet-ui|motion-experience|product-studio)\.css/);
  assert.match(main, /streamUltronSupabaseChat/);
  assert.match(main, /getCloudSession/);
  assert.match(main, /addUltronCloudKey/);
  assert.doesNotMatch(main, /initializeAvatar|import\(["']three["']\)|markSvg|markDataUrl/);
  assert.match(main, /nativeSecureStorage/);
  assert.doesNotMatch(main, /registerPlugin[^;]+UltronSecureStorage/);
  assert.equal((cloudSync.match(/registerPlugin<UltronSecureStoragePlugin>\(['"]UltronSecureStorage['"]\)/g) ?? []).length, 1);
  assert.match(main, /app\.dataset\.health = state === "online" \? "ready" : state === "connecting" \? "checking" : "local"/);
});

test("responsive requirements and every full-screen destination remain covered", async () => {
  const [design, ledger, html, css] = await Promise.all([
    read("DESIGN.md"),
    read("docs/ULTRON-SCREEN-COVERAGE.md"),
    read("apps/phone/index.html"),
    read("apps/phone/src/chatgpt-ui.css"),
  ]);
  for (const viewport of ["360×800", "390×844", "768×1024", "1280×800", "1440×900"]) {
    assert.ok(design.includes(viewport), `missing viewport contract: ${viewport}`);
  }
  const fullScreens = [...html.matchAll(/<section id="([^"]+)" class="feature-screen[^"]*"/g)].map((match) => match[1]);
  assert.ok(fullScreens.length >= 5, "the inventory should cover all full-screen destinations");
  for (const id of [...fullScreens, "thread", "hero", "global-search", "chat-model-menu", "connectors-panel", "connector-detail-wrap", "workspace-panel", "workspace-team-builder", "workspace-tray", "composio-approvals", "sheet-wrap"]) {
    assert.ok(design.includes(`#${id}`), `missing design inventory entry: #${id}`);
  }
  for (const id of fullScreens) {
    assert.ok(ledger.includes(id), `missing screen coverage ledger entry: ${id}`);
  }
  assert.match(css, /@media \(min-width:\s*900px\)/);
  assert.match(css, /#drawer\s*\{[\s\S]*?width:\s*var\(--sidebar-width\)/);
  assert.match(css, /\.feature-screen,\s*#connectors-panel[\s\S]*?left:\s*var\(--sidebar-width\)/);
  assert.match(css, /@media \(max-width:\s*899px\)/);
});

test("hidden overlays, focus states and mobile composer remain protected", async () => {
  const [css, html] = await Promise.all([
    read("apps/phone/src/chatgpt-ui.css"),
    read("apps/phone/index.html"),
  ]);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.bottom-nav\s*\{/);
  assert.match(css, /\.dock\s*\{/);
  assert.match(css, /--safe-bottom:\s*env\(safe-area-inset-bottom/);
  for (const id of ["connectors-panel", "sheet-wrap", "global-search", "chat-model-menu", "workspace-panel", "llm-api-keys-screen"]) {
    const element = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`));
    assert.ok(element, `missing #${id}`);
    assert.match(element[0], /\shidden(?:\s|>)/, `#${id} must start hidden`);
  }
});
