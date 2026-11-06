import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFile(path.join(repo, relative), "utf8");

test("ULTRON gstack workflow, design skill and screen ledger are installed", async () => {
  const [design, skill, gstack, ledger, agents] = await Promise.all([
    read("DESIGN.md"),
    read(".agents/skills/ultron-design/SKILL.md"),
    read(".agents/skills/ultron-gstack/SKILL.md"),
    read("docs/ULTRON-SCREEN-COVERAGE.md"),
    read("AGENTS.md"),
  ]);
  assert.match(design, /# ULTRON Design System/);
  assert.match(design, /Page inventory and design requirements/);
  assert.match(design, /360×800/);
  assert.match(skill, /ULTRON Design Studio/);
  assert.match(skill, /Verify every screen/);
  for (const [index, phase] of ["THINK", "PLAN", "DESIGN", "BUILD", "REVIEW", "TEST", "SHIP", "REFLECT"].entries()) {
    assert.ok(gstack.includes(`### ${index + 1}. ${phase}`), `gstack workflow is missing ${phase}`);
  }
  for (const area of ["Main conversation experience", "Models and provider credentials", "Memory and learning", "Agent configuration and capabilities", "Connectors and workspace", "Settings and transient surfaces", "Secondary web surface"]) {
    assert.ok(ledger.includes(area), `screen ledger is missing ${area}`);
  }
  assert.match(agents, /\.agents\/skills\/ultron-gstack\/SKILL\.md/);
  assert.match(agents, /\.agents\/skills\/ultron-design\/SKILL\.md/);
});

test("shared canonical design tokens are defined in both shipped UI surfaces", async () => {
  const [phoneHtml, phoneTokens, webTokens] = await Promise.all([
    read("apps/phone/index.html"),
    read("apps/phone/src/quiet-ui.css"),
    read("apps/web/src/app/globals.css"),
  ]);
  assert.ok(phoneHtml.indexOf("./src/design-system.css") < phoneHtml.indexOf("./src/quiet-ui.css"));
  for (const token of ["--u-bg", "--u-surface-1", "--u-surface-2", "--u-accent", "--u-core", "--u-success", "--u-danger"]) {
    assert.ok(phoneTokens.includes(token), `phone client is missing ${token}`);
    assert.ok(webTokens.includes(token), `Next.js client is missing ${token}`);
  }
});

test("mobile and desktop design requirements remain explicit", async () => {
  const [design, ledger, html] = await Promise.all([
    read("DESIGN.md"),
    read("docs/ULTRON-SCREEN-COVERAGE.md"),
    read("apps/phone/index.html"),
  ]);
  for (const viewport of ["360×800", "390×844", "768×1024", "1280×800", "1440×900"]) {
    assert.ok(design.includes(viewport), `missing viewport contract: ${viewport}`);
  }
  const fullScreens = [...html.matchAll(/<section id="([^"]+)" class="feature-screen[^"]*"/g)].map((match) => match[1]);
  assert.ok(fullScreens.length >= 5, "the inventory should cover all full-screen destinations");
  for (const id of [...fullScreens, "thread", "global-search", "chat-model-menu", "connectors-panel", "connector-detail-wrap", "workspace-panel", "workspace-team-builder", "workspace-tray", "composio-approvals", "sheet-wrap"]) {
    assert.ok(design.includes(`#${id}`), `missing design inventory entry: #${id}`);
  }
  for (const id of fullScreens) {
    assert.ok(ledger.includes(id), `missing screen coverage ledger entry: ${id}`);
  }
});

test("desktop client promotes the mobile bottom navigation into a persistent side rail", async () => {
  const css = await read("apps/phone/src/quiet-ui.css");
  assert.match(css, /@media\s*\(min-width:\s*900px\)/);
  assert.match(css, /\.bottom-nav\s*\{[\s\S]*?inset:\s*0 auto 0 0/);
  assert.match(css, /\.feature-screen\s*\{[\s\S]*?inset:\s*0 0 0 80px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});


test("active product surfaces use warm-metal accents while semantic danger remains separate", async () => {
  const css = await read("apps/phone/src/quiet-ui.css");
  assert.match(css, /\.chat-model-option\[aria-current="true"\][\s\S]*?var\(--u-accent-strong\)/);
  assert.match(css, /\.curated-model-card\s*\{[\s\S]*?var\(--u-border\)/);
  assert.match(css, /\.workspace-stat strong\s*\{\s*color:\s*var\(--u-accent-strong\)/);
  assert.match(css, /\.learning-safety-note\s*\{[\s\S]*?rgba\(213,183,121/);
  assert.match(css, /\.message-feedback button\[aria-pressed="true"\][\s\S]*?var\(--u-accent-strong\)/);
  assert.match(css, /--u-core:\s*#e34b58/);
});


test("primary navigation remains visible and the composer stays clear of it", async () => {
  const [experience, design, css] = await Promise.all([
    read("apps/phone/src/experience.css"),
    read("apps/phone/src/design-system.css"),
    read("apps/phone/src/quiet-ui.css"),
  ]);
  assert.doesNotMatch(experience, /\.bottom-nav\s*\{\s*display:\s*none\s*!important/);
  assert.match(design, /\.bottom-nav\{[^}]*display:grid/);
  assert.match(css, /#app\s*\{\s*padding-bottom:\s*calc\(62px \+ var\(--safe-bottom\)\) !important/);
  assert.match(css, /\.composer-model-row \.chat-model-button #chat-model-label\s*\{[^}]*max-width:\s*none !important/);
  assert.match(css, /@media \(min-width: 900px\) \{[\s\S]*?padding-bottom: 0 !important/);
});


test("mobile hero keeps the complete ULTRON core visible above navigation", async () => {
  const css = await read("apps/phone/src/quiet-ui.css");
  assert.match(css, /@media \(max-width: 520px\) \{[\s\S]*?#app\[data-page="chat"\] \.hero\s*\{[\s\S]*?justify-content:\s*flex-start/);
  assert.match(css, /#app\[data-page="chat"\] \.stage\s*\{\s*width:\s*clamp\(132px, 34vw, 160px\)/);
});


test("active navigation uses warm-metal rather than the legacy red theme", async () => {
  const css = await read("apps/phone/src/quiet-ui.css");
  assert.match(css, /\.bottom-nav \.nav-item\[aria-current="page"\][\s\S]*?color:\s*var\(--u-accent-strong\) !important/);
  assert.match(css, /\.bottom-nav \.nav-item\[aria-current="page"\]::before[\s\S]*?background:\s*var\(--u-accent\) !important/);
});


test("connector filters, paid-tier badges and capability approvals use warm-metal accents", async () => {
  const css = await read("apps/phone/src/quiet-ui.css");
  assert.match(css, /\.chip\[aria-pressed="true"\][\s\S]*?var\(--u-accent-strong\)/);
  assert.match(css, /\.badge\.tier-paid\s*\{[\s\S]*?var\(--u-accent-strong\)/);
  assert.match(css, /\.capability-source summary,[\s\S]*?\.capability-approve[\s\S]*?var\(--u-accent-strong\)/);
});


test("secondary feature screens start below the persistent top bar", async () => {
  const css = await read("apps/phone/src/quiet-ui.css");
  assert.match(css, /\.feature-screen\s*\{\s*inset:\s*58px 0 calc\(62px \+ var\(--safe-bottom\)\) !important/);
  assert.match(css, /@media \(min-width: 900px\) \{[\s\S]*?\.feature-screen\s*\{\s*inset:\s*68px 0 0 80px !important/);
});
