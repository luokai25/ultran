import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const [html, main, localAI, runtime, capabilityKernel] = await Promise.all([
  read("index.html"),
  read("src/main.ts"),
  read("android/app/src/main/java/app/ultran/mobile/UltranLocalAiPlugin.java"),
  read("android/app/src/main/java/app/ultran/mobile/UltranRuntimePlugin.java"),
  read("src/capability-kernel.ts"),
]);

test("every required phone UI selector exists exactly once", () => {
  const requiredIds = [...main.matchAll(/req<[^>]+>\("#([^"]+)"\)/g)].map((match) => match[1]);
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const counts = new Map();
  for (const id of htmlIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  assert.deepEqual([...new Set(requiredIds.filter((id) => !counts.has(id)))], []);
  assert.deepEqual([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id), []);
});

test("Hugging Face model hub controls are connected to native download and progress", () => {
  for (const id of ["model-search-form", "model-size-filter", "model-download-progress", "model-library-results"]) {
    assert.ok(html.includes(`id="${id}"`), `missing model hub control: ${id}`);
  }
  assert.match(main, /modelSearchForm\.addEventListener\("submit"/);
  assert.match(main, /NativeLocalAI\.downloadModel\(/);
  assert.match(main, /hubSearchSequence/);
  assert.match(main, /modelDownloadProgressEl\.value = percent/);
});

test("native GGUF downloads enforce trusted URLs, size limits, digest and file signature", () => {
  assert.match(localAI, /https:\/\/huggingface\.co/);
  assert.match(localAI, /expectedSha256\.matches\("\[a-f0-9\]\{64\}"\)/);
  assert.match(localAI, /received > maxBytes/);
  assert.match(localAI, /SHA-256 checksum mismatch/);
  assert.match(localAI, /magic\[0\] != 'G'.*magic\[3\] != 'F'/s);
  assert.match(localAI, /atomically finalize downloaded model/);
});

test("device capability profile is shown in the model settings UI", () => {
  assert.ok(html.includes('id="device-profile"'));
  assert.match(localAI, /public void getDeviceProfile\(/);
  assert.match(main, /NativeLocalAI\.getDeviceProfile\(\)\.then\(renderDeviceProfile\)/);
  assert.match(main, /Start with 1B–2B Q4 models/);
});

test("Termux runtime download verifies the published checksum before installation", () => {
  assert.ok(html.includes('id="ultran-runtime-download"'));
  assert.match(main, /NativeRuntime\.downloadBootstrap\(\)/);
  assert.match(runtime, /public void downloadBootstrap\(/);
  assert.match(runtime, /SHA256SUMS/);
  assert.match(runtime, /Termux runtime SHA-256 verification failed/);
  assert.match(runtime, /host\.endsWith\("\.githubusercontent\.com"\)/);
  assert.match(runtime, /notifyListeners\("runtimeDownloadProgress", progress\)/);
});

test("brain-independent capability policy is applied to native and Ollama brains", () => {
  assert.match(main, /from "\.\/capability-kernel"/);
  assert.match(main, /buildCapabilityPrompt\(text, "on-device llama\.cpp"\)/);
  assert.match(main, /buildCapabilityPrompt\(task, "Ollama-compatible local model"\)/);
  assert.match(main, /shouldVerifyDraft\(text\)/);
  assert.match(main, /shouldVerifyDraft\(task\)/);
  assert.match(main, /reviewLocalDraft\(task, content\)/);
  assert.match(capabilityKernel, /export function profileTask/);
  assert.match(capabilityKernel, /export function buildCapabilityPrompt/);
  assert.match(capabilityKernel, /export function buildReviewPrompt/);
  assert.match(capabilityKernel, /verifyDraft: true/);
  assert.match(capabilityKernel, /Never pretend to browse, read files, run commands, test code, or change external systems/);
});

test("complex local answers receive an independent review without discarding the first draft on failure", () => {
  assert.match(main, /const review = await NativeLocalAI\.generate/);
  assert.match(main, /if \(review\.content\.trim\(\)\) finalContent = review\.content\.trim\(\)/);
  assert.match(main, /catch \{\s*\/\/ Review is a quality enhancement; never discard a usable first answer\./);
  assert.match(main, /if \(!response\.ok\) return draft/);
  assert.match(main, /return payload\.message\?\.content\?\.trim\(\) \|\| draft/);
});
