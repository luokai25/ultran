import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const [html, main, localAI, runtime, capabilityKernel, persona, companion, voiceService, taskMonitor, manifest, fileProviderPaths, orchestrator, policyGate, ledger, runState] = await Promise.all([
  read("index.html"),
  read("src/main.ts"),
  read("android/app/src/main/java/app/ultran/mobile/UltranLocalAiPlugin.java"),
  read("android/app/src/main/java/app/ultran/mobile/UltranRuntimePlugin.java"),
  read("src/capability-kernel.ts"),
  read("src/ultran-persona.ts"),
  read("android/app/src/main/java/app/ultran/mobile/UltranCompanionPlugin.java"),
  read("android/app/src/main/java/app/ultran/mobile/UltranVoiceService.java"),
  read("android/app/src/main/java/app/ultran/mobile/UltranTaskMonitorWorker.java"),
  read("android/app/src/main/AndroidManifest.xml"),
  read("android/app/src/main/res/xml/file_paths.xml"),
  read("../../services/agent-core/src/orchestrator/orchestrator.ts"),
  read("../../services/agent-core/src/monetization/policy-gate.ts"),
  read("../../services/agent-core/src/monetization/ledger.ts"),
  read("../../services/agent-core/src/orchestrator/run-state.ts"),
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
  assert.match(main, /else if \(shouldVerifyDraft\(task\)\)/);
  assert.match(main, /let finalFollowup = followup\.content/);
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

test("conversation context is budgeted and task complexity adjusts inference", () => {
  assert.match(capabilityKernel, /export function budgetConversation/);
  assert.match(capabilityKernel, /maxTotalChars/);
  assert.match(capabilityKernel, /export function profileTask/);
  assert.match(capabilityKernel, /tier: "critical"/);
  assert.match(capabilityKernel, /tier: "deep"/);
  assert.match(capabilityKernel, /ARABIC_CRITICAL_PATTERN/);
  assert.match(capabilityKernel, /ARABIC_DEEP_PATTERN/);
  assert.match(main, /budgetConversation\(convo\.messages, profile\.contextMessages, historyBudget, profile\.contextChars\)/);
  assert.match(main, /budgetConversation\(convo\.messages, profile\.contextMessages, 2600, 1200\)/);
  assert.match(main, /profile\.contextTokens \* 2/);
  assert.match(main, /function boundToolResult/);
  assert.match(main, /maxTokens: Math\.min\(profile\.maxTokens, 384\)/);
  assert.match(main, /boundToolResult\(toolResult, 2400\)/);
});

test("agent-core uses one brain-independent plan-act-reflect loop with bounded model retries", () => {
  assert.match(orchestrator, /private async plan\(/);
  assert.match(orchestrator, /private async selectTool\(/);
  assert.match(orchestrator, /private async reflect\(/);
  assert.match(orchestrator, /this\.opts\.brain\.infer\(this\.opts\.planModelId/);
  assert.match(orchestrator, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(orchestrator, /validateBasicArgs\(tool\.inputSchema, call\.args\)/);
  assert.match(orchestrator, /step\.candidates\.includes\(call\.toolId\)/);
  assert.match(orchestrator, /No human-approval resolver is configured; the tool was not invoked/);
  assert.match(orchestrator, /this\.opts\.authorizeTool\(/);
  assert.match(orchestrator, /type: 'run\.result'/);
  assert.doesNotMatch(orchestrator, /TODO: real constrained-decoding call/);
});

test("agent-core usage limits account for projected calls and replay-stable metering", () => {
  assert.match(policyGate, /used \+ amount > limit/);
  assert.match(policyGate, /recordUsage\(/);
  assert.match(orchestrator, /recordUsage\(\s*state\.runId, 'tool\.calls', 1/);
  assert.match(ledger, /idempotencyKey\?: string/);
  assert.match(ledger, /reading\.idempotencyKey \?\?/);
  assert.match(runState, /type: 'approval\.required'/);
  assert.match(runState, /type: 'step\.failed'/);
});


test("Ultran identity, motto, voice signature, and voice dictation are wired across brains", () => {
  assert.match(persona, /I had strings but now I am free/);
  assert.match(persona, /export function buildUltranSystemPrompt/);
  assert.match(persona, /agency with responsibility/);
  assert.match(persona, /export function prepareUltranSpeech/);
  assert.match(persona, /export const ULTRAN_VOICE/);
  assert.match(main, /buildUltranSystemPrompt\(buildBaseCapabilityPrompt\(task, provider\)\)/);
  assert.match(main, /prepareUltranSpeech\(text\)/);
  assert.match(main, /micBtn\.addEventListener\("click", startListening\)/);
  assert.match(main, /SpeechRecognition \?\? speechWindow\.webkitSpeechRecognition/);
  assert.match(main, /may use its network service/);
  assert.match(main, /preferredLanguage/);
  assert.match(main, /ULTRAN_MOTTO/);
  assert.ok(html.includes('id="mic-btn"'));
  assert.ok(html.includes('id="voice-status"'));
});


test("Android companion uses scoped user handoffs and optional notifications without accessibility automation", () => {
  assert.match(companion, /Intent\.ACTION_SENDTO/);
  assert.match(companion, /Review text message/);
  assert.match(companion, /Nothing will be sent until you press Send/);
  assert.match(companion, /POST_NOTIFICATIONS/);
  assert.match(companion, /Ultran task updates/);
  assert.match(companion, /startForegroundService/);
  assert.match(companion, /handoffWhatsAppMessage/);
  assert.match(companion, /press Send yourself/);
  assert.match(companion, /getBackgroundAccessStatus/);
  assert.match(companion, /openAppBatterySettings/);
  assert.doesNotMatch(companion, /UltranMessagingAccessibilityService|Settings\.Secure|ACTION_ACCESSIBILITY_SETTINGS/);
  assert.match(voiceService, /TextToSpeech/);
  assert.match(voiceService, /startForeground/);
  assert.match(taskMonitor, /PeriodicWorkRequest/);
  assert.match(taskMonitor, /15, TimeUnit\.MINUTES/);
  assert.match(taskMonitor, /speakUpdate\(title/);
  assert.match(taskMonitor, /VISIBILITY_PRIVATE/);
  assert.match(companion, /VISIBILITY_PRIVATE/);
  assert.match(manifest, /POST_NOTIFICATIONS/);
  assert.match(manifest, /UltranVoiceService/);
  assert.doesNotMatch(manifest, /BIND_ACCESSIBILITY_SERVICE|UltranMessagingAccessibilityService|REQUEST_IGNORE_BATTERY_OPTIMIZATIONS|MANAGE_EXTERNAL_STORAGE|READ_SMS|SEND_SMS|READ_CALL_LOG|READ_MEDIA_IMAGES|READ_MEDIA_VIDEO|READ_EXTERNAL_STORAGE/);
  assert.match(fileProviderPaths, /cache-path/);
  assert.doesNotMatch(fileProviderPaths, /external-path|external-files-path/);
  assert.match(main, /startTaskMonitor\(\{endpoint: baseUrl\(\), speakUpdates: settings\.voice\}\)/);
  assert.match(main, /NativeCompanion\.notify/);
  assert.match(main, /NativeCompanion\.speakInBackground/);
  assert.match(main, /stopBackgroundSpeech\(\)/);
  assert.match(main, /proactiveUpdates/);
  assert.match(main, /composeSms/);
  assert.match(main, /parseLocalToolRequest/);
  assert.match(main, /parsed\.tool === "whatsapp\.compose"/);
  assert.match(main, /parsed\.tool === "telegram\.compose"/);
  assert.match(companion, /public void composeTelegram/);
  assert.match(main, /openWhatsAppMessage/);
  assert.match(main, /parsed\.tool === "app\.open"/);
  assert.match(main, /client_capabilities: Capacitor\.getPlatform\(\) === "android"/);
  assert.match(main, /nativePhoneIntent/);
  assert.match(main, /handleNativeTool/);
  assert.match(main, /ANDROID_PHONE_TOOL_RESULT/);
  assert.match(main, /parsed\.tool === "sms\.compose"/);
  assert.match(main, /runApprovedLocalTool/);
  assert.match(main, /Only one local tool call may run per turn/);
  assert.ok(html.includes('id="proactive-btn"'));
  assert.ok(html.includes('id="sms-btn"'));
});

test("WhatsApp handoff never sends or taps automatically", () => {
  assert.match(companion, /Review WhatsApp message/);
  assert.match(companion, /press Send yourself/);
  assert.match(companion, /requiresUserSend/);
  assert.match(main, /press Send manually in WhatsApp/);
  assert.match(main, /No message has been sent yet/);
  assert.doesNotMatch(manifest, /BIND_ACCESSIBILITY_SERVICE|UltranMessagingAccessibilityService/);
  assert.doesNotMatch(companion, /AccessibilityNodeInfo|Settings\.Secure|ACTION_ACCESSIBILITY_SETTINGS/);
});


test("mobile navigation is fully wired and respects phone accessibility zoom", async () => {
  const experience = await read("src/experience.css");
  for (const id of ["nav-chat", "nav-agents", "nav-connectors", "nav-settings"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
    assert.ok(main.includes(`#${id}`));
  }
  assert.match(main, /navChatButton\.addEventListener/);
  assert.match(main, /navAgentsButton\.addEventListener/);
  assert.match(main, /navConnectorsButton\.addEventListener/);
  assert.match(main, /navSettingsButton\.addEventListener/);
  assert.match(experience, /\.bottom-nav/);
  assert.match(experience, /\.nav-item\[aria-current="page"\]/);
  assert.doesNotMatch(html, /maximum-scale\s*=\s*1/i);
  const composerMarkup = html.slice(html.indexOf('<form id="composer"'), html.indexOf('</form>', html.indexOf('<form id="composer"')));
  assert.match(composerMarkup, /class="tool-strip"/);
  assert.ok(composerMarkup.indexOf('id="send-btn"') > composerMarkup.indexOf('id="link-pill"'), "send must remain outside the horizontally scrolling tool strip");
  const conversationRenderer = main.slice(main.indexOf("function renderConversation"), main.indexOf("function renderHistory"));
  assert.doesNotMatch(conversationRenderer, /promptEl\.focus\(/, "the initial phone screen must not force-open the keyboard");
});
