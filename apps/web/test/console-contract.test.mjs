import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("legacy Next.js entrypoint redirects to the single canonical web and APK client", async () => {
  const page = await read("src/app/page.tsx");
  assert.match(page, /import \{ redirect \} from "next\/navigation"/);
  assert.match(page, /redirect\("https:\/\/ultron-app-web\.luo-chat-ops\.workers\.dev\/"\)/);
  assert.doesNotMatch(page, /UltronConsole|AvatarHero|UltronVoice/);
});

test("legacy shell retains the canonical charcoal and green design tokens", async () => {
  const css = await read("src/app/globals.css");
  assert.match(css, /--bg:\s*#212121/);
  assert.match(css, /--surface:\s*#2f2f2f/);
  assert.match(css, /--accent:\s*#10a37f/);
  assert.match(css, /--accent-hover:\s*#0e9272/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /--u-accent:\s*#d5b779|ultron-stage|ultron-nav/);
});

test("legacy orb and voice components are not mounted by the public entrypoint", async () => {
  const page = await read("src/app/page.tsx");
  assert.doesNotMatch(page, /AvatarHero|Core expression|Core environment|UltronVoice/);
  assert.match(page, /redirect\(/);
});

test("legacy Next.js shell metadata identifies the single private ULTRON experience", async () => {
  const layout = await read("src/app/layout.tsx");
  assert.match(layout, /title:\s*"ULTRON"/);
  assert.match(layout, /One consistent web and Android experience/);
});
