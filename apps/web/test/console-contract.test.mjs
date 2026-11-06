import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("secondary console exposes section navigation and a clear production handoff", async () => {
  const page = await read("src/app/page.tsx");
  assert.match(page, /className="ultron-shell"/);
  assert.match(page, /aria-label="Page sections"/);
  assert.match(page, /href="#overview"/);
  assert.match(page, /href="#avatar"/);
  assert.match(page, /href="#model-hub"/);
  assert.match(page, /href="#architecture"/);
  assert.match(page, /https:\/\/ultron-app-web\.luo-chat-ops\.workers\.dev\//);
  assert.match(page, /AvatarHero/);
  assert.match(page, /ModelHub/);
  assert.doesNotMatch(page, /Pre-alpha/);
});

test("secondary console uses shared tokens and responsive avatar sizing", async () => {
  const css = await read("src/app/globals.css");
  assert.match(css, /--u-accent:\s*#d5b779/);
  assert.match(css, /\.ultron-nav a/);
  assert.match(css, /\.ultron-avatar-stage \.ultron-stage/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.ultron-avatar-stage \.ultron-stage \{ height: 280px !important; \}/);
});

test("avatar button describes the jaw animation as a preview, not live audio", async () => {
  const avatar = await read("src/components/AvatarHero.tsx");
  assert.match(avatar, /"Preview speech"/);
  assert.match(avatar, /"Animating"/);
});

test("metadata identifies this as a secondary console", async () => {
  const layout = await read("src/app/layout.tsx");
  assert.match(layout, /ULTRON \| Secondary Owner Console/);
  assert.match(layout, /shared apps\/phone client/);
});
