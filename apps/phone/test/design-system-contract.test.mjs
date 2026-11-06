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
  for (const phase of ["THINK", "PLAN", "DESIGN", "BUILD", "REVIEW", "TEST", "SHIP", "REFLECT"]) {
    assert.ok(gstack.includes(`### ${phase}`), `gstack workflow is missing ${phase}`);
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
