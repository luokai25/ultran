import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFile(path.join(repo, relative), "utf8");

test("ULTRON design skill and canonical design system are present", async () => {
  const [design, skill, agents] = await Promise.all([
    read("DESIGN.md"),
    read(".agents/skills/ultron-design/SKILL.md"),
    read("AGENTS.md"),
  ]);
  assert.match(design, /# ULTRON Design System/);
  assert.match(design, /Page inventory and design requirements/);
  assert.match(design, /360×800/);
  assert.match(skill, /ULTRON Design Studio/);
  assert.match(skill, /Verify every screen/);
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
  const [design, html] = await Promise.all([read("DESIGN.md"), read("apps/phone/index.html")]);
  for (const viewport of ["360×800", "390×844", "768×1024", "1280×800", "1440×900"]) {
    assert.ok(design.includes(viewport), `missing viewport contract: ${viewport}`);
  }
  const fullScreens = [...html.matchAll(/<section id="([^"]+)" class="feature-screen[^"]*"/g)].map((match) => match[1]);
  assert.ok(fullScreens.length >= 5, "the inventory should cover all full-screen destinations");
  for (const id of [...fullScreens, "thread", "global-search", "chat-model-menu", "connectors-panel", "connector-detail-wrap", "workspace-panel", "workspace-team-builder", "workspace-tray", "composio-approvals", "sheet-wrap"]) {
    assert.ok(design.includes(`#${id}`), `missing screen inventory entry: #${id}`);
  }
});
