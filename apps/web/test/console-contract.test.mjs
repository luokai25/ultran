import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("secondary console composes the complete ULTRON owner surface", async () => {
  const page = await read("src/app/page.tsx");
  const consoleSource = await read("src/components/UltronConsole.tsx");
  assert.match(page, /import UltronConsole from "@\/components\/UltronConsole"/);
  assert.match(page, /return <UltronConsole \/>/);
  for (const section of ["overview", "brain", "voice", "architecture"]) {
    assert.match(consoleSource, new RegExp(`id="${section}"`));
    assert.match(consoleSource, new RegExp(`href="#${section}"`));
  }
  assert.match(consoleSource, /aria-label="ULTRON console navigation"/);
  assert.ok(consoleSource.includes("https://ultron-web-6et.pages.dev/"));
  assert.match(consoleSource, /<AvatarHero speaking=\{speaking\} \/>/);
  assert.match(consoleSource, /<ModelHub \/>/);
  assert.match(consoleSource, /<UltronVoice onSpeakingChange=\{setSpeaking\} \/>/);
  assert.match(consoleSource, /Four connected layers/);
});

test("secondary console uses shared tokens and deliberate responsive avatar sizing", async () => {
  const css = await read("src/app/globals.css");
  assert.match(css, /--u-accent:\s*#d5b779/);
  assert.match(css, /\.ultron-nav a/);
  assert.match(css, /\.ultron-stage \{/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.ultron-architecture-grid/);
});

test("avatar core exposes real expression and environment controls", async () => {
  const avatar = await read("src/components/AvatarHero.tsx");
  assert.match(avatar, /type Props = \{ speaking: boolean \}/);
  assert.match(avatar, /role="group" aria-label="Core expression"/);
  assert.match(avatar, /role="group" aria-label="Core environment"/);
  assert.match(avatar, /aria-pressed=\{emotion === id\}/);
  assert.match(avatar, /aria-pressed=\{scene === id\}/);
  assert.match(avatar, /data-core-fallback="true"/);
});

test("voice console owns speaking state and offers a browser speech fallback", async () => {
  const voice = await read("src/components/UltronVoice.tsx");
  const consoleSource = await read("src/components/UltronConsole.tsx");
  assert.match(voice, /speechSynthesis/);
  assert.match(voice, /onSpeakingChange/);
  assert.match(consoleSource, /const \[speaking, setSpeaking\] = useState\(false\)/);
  assert.match(consoleSource, /<UltronVoice onSpeakingChange=\{setSpeaking\} \/>/);
});

test("metadata identifies the personal AI control console", async () => {
  const layout = await read("src/app/layout.tsx");
  assert.match(layout, /ULTRON · Personal AI Control Console/);
  assert.match(layout, /local-first personal AI system/);
});
