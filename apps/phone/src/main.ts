/**
 * Ultran phone client - a conversation console.
 *
 * Local-first: conversations live on the device and the shell works with no
 * network at all (an on-device responder answers a few things and says plainly
 * what it cannot do). When a brain endpoint is linked in Settings, turns go to
 * the Ultran control plane (`/v1/agents/{id}/chat`) and sessions are kept in
 * step with it. Nothing is sent anywhere until an endpoint is entered.
 */

import * as THREE from "three";
import { initConnectors } from "./connectors-ui";
import { markDataUrl, markSvg } from "./mark";

/* ------------------------------------------------------------------ *
 * Types + themes
 * ------------------------------------------------------------------ */

type Role = "user" | "assistant";
type ToolCall = { connector: string; action: string; ok: boolean };
type Message = { role: Role; content: string; tools?: ToolCall[] };
type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  sessionId?: string;
  messages: Message[];
};
type ThemeId = "palace" | "forge" | "vault" | "war-room";
type Settings = { endpoint: string; voice: boolean; theme: ThemeId };
type Store = { conversations: Conversation[]; activeId: string | null; agentId?: string };

type Theme = { label: string; accent: number; bright: string; fog: number };

const THEMES: Record<ThemeId, Theme> = {
  palace: { label: "Palace", accent: 0xd4af37, bright: "#f5d76e", fog: 0x050505 },
  forge: { label: "Forge", accent: 0xff8a3d, bright: "#ffb27a", fog: 0x0a0603 },
  vault: { label: "Vault", accent: 0x9ad1ff, bright: "#cdeaff", fog: 0x04070a },
  "war-room": { label: "War Room", accent: 0xe5484d, bright: "#ff8a8d", fog: 0x070404 },
};

const SUGGESTIONS: ReadonlyArray<readonly [string, string]> = [
  ["Plan", "Break my objective into steps I can run today"],
  ["Build", "Draft a connector manifest for a new tool"],
  ["Review", "Audit this idea for risks before I ship it"],
  ["Brief", "Summarise what you can do offline"],
];

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

function req<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`phone shell: missing required node ${selector}`);
  return node;
}

const app = req<HTMLElement>("#app");
const threadEl = req<HTMLElement>("#thread");
const messagesEl = req<HTMLElement>("#messages");
const heroEl = req<HTMLElement>("#hero");
const suggestionsEl = req<HTMLElement>("#suggestions");
const greetingEl = req<HTMLElement>("#greeting");
const canvas = req<HTMLCanvasElement>("#avatar");
const haloEl = req<HTMLElement>(".halo");
const composer = req<HTMLFormElement>("#composer");
const promptEl = req<HTMLTextAreaElement>("#prompt");
const sendBtn = req<HTMLButtonElement>("#send-btn");
const voiceBtn = req<HTMLButtonElement>("#voice-btn");
const linkPill = req<HTMLElement>("#link-pill");
const jumpBtn = req<HTMLButtonElement>("#jump-btn");
const menuBtn = req<HTMLButtonElement>("#menu-btn");
const newBtn = req<HTMLButtonElement>("#new-btn");
const drawer = req<HTMLElement>("#drawer");
const scrim = req<HTMLElement>("#scrim");
const historyEl = req<HTMLElement>("#history");
const sheetWrap = req<HTMLElement>("#sheet-wrap");
const endpointEl = req<HTMLInputElement>("#endpoint");
const endpointNote = req<HTMLElement>("#endpoint-note");
const themesEl = req<HTMLElement>("#themes");

req<HTMLElement>("#brand-mark").innerHTML = markSvg(22);
req<HTMLElement>("#drawer-mark").innerHTML = markSvg(20);
const favicon = document.createElement("link");
favicon.rel = "icon";
favicon.href = markDataUrl();
document.head.append(favicon);

/* ------------------------------------------------------------------ *
 * Persistence (a WebView can refuse storage; never let that break the app)
 * ------------------------------------------------------------------ */

const STORE_KEY = "ultran.chat.v1";
const SETTINGS_KEY = "ultran.settings.v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the session still works in memory */
  }
}

const settings: Settings = { endpoint: "", voice: false, theme: "palace", ...readJson<Partial<Settings>>(SETTINGS_KEY, {}) };
const store: Store = { conversations: [], activeId: null, ...readJson<Partial<Store>>(STORE_KEY, {}) };
if (!(settings.theme in THEMES)) settings.theme = "palace";

const saveSettings = (): void => writeJson(SETTINGS_KEY, settings);
const saveStore = (): void => writeJson(STORE_KEY, store);

const uid = (): string => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function active(): Conversation | null {
  return store.conversations.find((c) => c.id === store.activeId) ?? null;
}

/* ------------------------------------------------------------------ *
 * Safe rendering: markdown-lite built from DOM nodes, never innerHTML
 * ------------------------------------------------------------------ */

function inline(text: string, into: Node): void {
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) into.appendChild(document.createTextNode(text.slice(last, at)));
    const token = match[0];
    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      into.appendChild(code);
    } else {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      into.appendChild(strong);
    }
    last = at + token.length;
  }
  if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
}

function codeBlock(lang: string, source: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "codeblock";
  const head = document.createElement("header");
  const label = document.createElement("span");
  label.textContent = lang || "code";
  const copy = document.createElement("button");
  copy.className = "mini";
  copy.type = "button";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => void copyText(source, copy));
  head.append(label, copy);
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source;
  pre.appendChild(code);
  wrap.append(head, pre);
  return wrap;
}

function renderMarkdown(text: string, into: HTMLElement): void {
  into.replaceChildren();
  const parts = text.split(/```/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const newline = part.indexOf("\n");
      const lang = newline === -1 ? "" : part.slice(0, newline).trim();
      const body = newline === -1 ? part : part.slice(newline + 1);
      into.appendChild(codeBlock(lang, body.replace(/\n$/, "")));
      return;
    }
    for (const block of part.split(/\n{2,}/)) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n");
      const bullets = lines.every((l) => /^\s*[-*]\s+/.test(l));
      const numbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
      if (bullets || numbered) {
        const list = document.createElement(numbered ? "ol" : "ul");
        for (const line of lines) {
          const li = document.createElement("li");
          inline(line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""), li);
          list.appendChild(li);
        }
        into.appendChild(list);
      } else {
        const p = document.createElement("p");
        lines.forEach((line, i) => {
          if (i > 0) p.appendChild(document.createElement("br"));
          inline(line, p);
        });
        into.appendChild(p);
      }
    }
  });
}

async function copyText(text: string, button?: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (button) flash(button, "Copied");
  } catch {
    if (button) flash(button, "Select to copy");
  }
}

function flash(button: HTMLElement, label: string): void {
  const before = button.textContent;
  button.textContent = label;
  window.setTimeout(() => (button.textContent = before), 1300);
}

/* ------------------------------------------------------------------ *
 * Transcript
 * ------------------------------------------------------------------ */

function nearBottom(): boolean {
  return threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 140;
}

function scrollToEnd(smooth = true): void {
  threadEl.scrollTo({ top: threadEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

function messageNode(message: Message): { root: HTMLElement; body: HTMLElement } {
  const root = document.createElement("article");
  root.className = `msg ${message.role}`;
  const body = document.createElement("div");
  body.className = "body";

  if (message.role === "assistant") {
    const who = document.createElement("div");
    who.className = "who";
    who.innerHTML = markSvg(14);
    who.append(document.createTextNode("Ultran"));
    root.appendChild(who);
  }
  root.appendChild(body);
  return { root, body };
}

function finishAssistantNode(root: HTMLElement, message: Message): void {
  if (message.tools?.length) {
    const tools = document.createElement("div");
    tools.className = "tools";
    for (const call of message.tools) {
      const chip = document.createElement("span");
      chip.className = "tool-chip";
      chip.dataset.ok = String(call.ok);
      const dot = document.createElement("i");
      chip.append(dot, document.createTextNode(`${call.connector} · ${call.action}`));
      tools.appendChild(chip);
    }
    root.appendChild(tools);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => void copyText(message.content, copy));
  const say = document.createElement("button");
  say.type = "button";
  say.textContent = "Listen";
  say.addEventListener("click", () => speak(message.content));
  actions.append(copy, say);
  root.appendChild(actions);
}

function renderConversation(): void {
  messagesEl.replaceChildren();
  const convo = active();
  const has = !!convo && convo.messages.length > 0;
  app.dataset.chatting = String(has);
  if (convo) {
    for (const message of convo.messages) {
      const { root, body } = messageNode(message);
      if (message.role === "user") body.textContent = message.content;
      else {
        renderMarkdown(message.content, body);
        finishAssistantNode(root, message);
      }
      messagesEl.appendChild(root);
    }
  }
  promptEl.focus({ preventScroll: true });
  requestAnimationFrame(() => scrollToEnd(false));
  syncRender();
}

/* ------------------------------------------------------------------ *
 * Drawer + history
 * ------------------------------------------------------------------ */

function renderHistory(): void {
  historyEl.replaceChildren();
  const rows = [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No conversations yet.";
    historyEl.appendChild(empty);
    return;
  }
  for (const convo of rows) {
    const row = document.createElement("div");
    row.className = "history-item";
    if (convo.id === store.activeId) row.setAttribute("aria-current", "true");
    const open = document.createElement("button");
    open.className = "open";
    open.type = "button";
    open.textContent = convo.title;
    open.addEventListener("click", () => {
      store.activeId = convo.id;
      saveStore();
      closeDrawer();
      renderConversation();
    });
    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.setAttribute("aria-label", `Delete ${convo.title}`);
    del.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
    del.addEventListener("click", () => void removeConversation(convo.id));
    row.append(open, del);
    historyEl.appendChild(row);
  }
}

function openDrawer(): void {
  renderHistory();
  drawer.dataset.open = "true";
  drawer.setAttribute("aria-hidden", "false");
  scrim.hidden = false;
}

function closeDrawer(): void {
  drawer.dataset.open = "false";
  drawer.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
}

function newConversation(): void {
  // Reuse an untouched empty conversation rather than piling them up.
  const empty = store.conversations.find((c) => c.messages.length === 0);
  if (empty) {
    store.activeId = empty.id;
  } else {
    const convo: Conversation = { id: uid(), title: "New conversation", updatedAt: Date.now(), messages: [] };
    store.conversations.push(convo);
    store.activeId = convo.id;
  }
  saveStore();
  closeDrawer();
  renderConversation();
}

async function removeConversation(id: string): Promise<void> {
  const convo = store.conversations.find((c) => c.id === id);
  store.conversations = store.conversations.filter((c) => c.id !== id);
  if (store.activeId === id) store.activeId = null;
  saveStore();
  if (convo?.sessionId && store.agentId && settings.endpoint) {
    // Best effort: keep the control plane in step, but never block on it.
    void api(`/v1/agents/${store.agentId}/sessions/${convo.sessionId}`, { method: "DELETE" }).catch(() => undefined);
  }
  renderHistory();
  renderConversation();
}

/* ------------------------------------------------------------------ *
 * Control plane link
 * ------------------------------------------------------------------ */

type LinkState = "offline" | "online" | "error";

function setLink(state: LinkState, label?: string): void {
  linkPill.dataset.state = state;
  linkPill.textContent = label ?? (state === "online" ? "linked" : state === "error" ? "unreachable" : "local");
}

function baseUrl(): string {
  return settings.endpoint.trim().replace(/\/+$/, "");
}

async function api(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function ensureAgent(): Promise<string> {
  if (store.agentId) return store.agentId;
  const res = await api("/v1/agents", {
    method: "POST",
    body: JSON.stringify({ name: "Ultran Prime", persona: "ultran" }),
  });
  if (!res.ok) throw new Error(`agent create failed (${res.status})`);
  const agent = (await res.json()) as { id: string };
  store.agentId = agent.id;
  saveStore();
  return agent.id;
}

type ChatReply = { content: string; session_id: string; tool_calls?: ToolCall[] };

async function remoteReply(convo: Conversation, text: string): Promise<ChatReply> {
  const run = async (): Promise<ChatReply> => {
    const agentId = await ensureAgent();
    const res = await api(`/v1/agents/${agentId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: text, session_id: convo.sessionId ?? null }),
    });
    if (res.status === 404) {
      // The agent or session was lost on the server (it restarted). Start clean.
      store.agentId = undefined;
      convo.sessionId = undefined;
      throw new Error("stale");
    }
    if (!res.ok) throw new Error(`brain returned ${res.status}`);
    return (await res.json()) as ChatReply;
  };
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.message === "stale") return run();
    throw error;
  }
}

/** The on-device responder: honest about being small, useful for the basics. */
function localReply(text: string): ChatReply {
  const low = text.toLowerCase();
  const now = new Date();
  let content: string;
  if (/\b(time|clock)\b/.test(low)) {
    content = `It is **${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}** on this device.`;
  } else if (/\b(date|today|day)\b/.test(low)) {
    content = `Today is **${now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}**.`;
  } else if (/\b(offline|can you do|what can you|capabilit|help)\b/.test(low)) {
    content =
      "Running on-device with no brain linked, I can:\n\n- Keep your conversations on this phone\n- Read the time and date\n- Speak replies aloud\n\nFor real reasoning, link your Ultran backend in **Settings → Brain endpoint**.";
  } else if (/\b(who|what) are you\b/.test(low)) {
    content = "I am Ultran, a local-first agent console. The brain lives on your hardware, not in someone else's cloud.";
  } else {
    content =
      "No brain is linked, so I can't reason about that yet. Open **Settings** and enter your Ultran backend address, and I will route this to it. Your message is saved on this device.";
  }
  return { content, session_id: "" };
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

let busy = false;

function autosize(): void {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 140)}px`;
  sendBtn.disabled = busy || promptEl.value.trim().length === 0;
}

function typewriter(target: HTMLElement, text: string, onDone: () => void): void {
  target.classList.add("caret");
  const total = text.length;
  // Aim for ~1.4s whatever the length, so long answers do not drag.
  const step = Math.max(2, Math.ceil(total / 85));
  let shown = 0;
  const tick = (): void => {
    shown = Math.min(total, shown + step);
    renderMarkdown(text.slice(0, shown), target);
    if (nearBottom()) scrollToEnd(false);
    if (shown < total) window.setTimeout(tick, 16);
    else {
      target.classList.remove("caret");
      onDone();
    }
  };
  tick();
}

async function submit(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text || busy) return;

  let convo = active();
  if (!convo) {
    convo = { id: uid(), title: "New conversation", updatedAt: Date.now(), messages: [] };
    store.conversations.push(convo);
    store.activeId = convo.id;
  }
  if (convo.messages.length === 0) convo.title = text.length > 44 ? `${text.slice(0, 43)}…` : text;

  convo.messages.push({ role: "user", content: text });
  convo.updatedAt = Date.now();
  saveStore();

  promptEl.value = "";
  busy = true;
  autosize();
  app.dataset.chatting = "true";

  const userNode = messageNode({ role: "user", content: text });
  userNode.body.textContent = text;
  messagesEl.appendChild(userNode.root);

  const reply = messageNode({ role: "assistant", content: "" });
  const dots = document.createElement("div");
  dots.className = "thinking";
  dots.innerHTML = "<i></i><i></i><i></i>";
  reply.body.appendChild(dots);
  messagesEl.appendChild(reply.root);
  scrollToEnd();
  syncRender();
  setThinking(true);

  let result: ChatReply;
  if (baseUrl()) {
    try {
      result = await remoteReply(convo, text);
      if (result.session_id) convo.sessionId = result.session_id;
      setLink("online");
    } catch (error) {
      setLink("error");
      const why = error instanceof Error ? error.message : "unknown error";
      result = {
        content: `I could not reach the brain at \`${baseUrl()}\` (${why}). Check that the backend is running and on the same network, then try again.`,
        session_id: "",
      };
    }
  } else {
    await new Promise((resolve) => window.setTimeout(resolve, 380));
    result = localReply(text);
  }
  setThinking(false);

  const message: Message = { role: "assistant", content: result.content };
  if (result.tool_calls?.length) message.tools = result.tool_calls.map((t) => ({ connector: t.connector, action: t.action, ok: t.ok }));
  convo.messages.push(message);
  convo.updatedAt = Date.now();
  saveStore();

  reply.body.replaceChildren();
  typewriter(reply.body, result.content, () => {
    finishAssistantNode(reply.root, message);
    busy = false;
    autosize();
    if (nearBottom()) scrollToEnd();
  });
  if (settings.voice) speak(result.content);
}

/* ------------------------------------------------------------------ *
 * Avatar (the hero) - rendered only while it is on screen
 * ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene3d = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0.1, 4.6);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(2.4, 3.2, 3.6);
const rimLight = new THREE.DirectionalLight(THEMES.palace.accent, 1.1);
rimLight.position.set(-3, 1.2, -2.4);
scene3d.add(keyLight, rimLight, new THREE.AmbientLight(0x2a2a33, 1.4));

const accent = new THREE.Color(THEMES.palace.accent);
const head = new THREE.Group();
scene3d.add(head);

const shell = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1, 1),
  new THREE.MeshStandardMaterial({ color: 0x1b1b21, metalness: 0.92, roughness: 0.28, flatShading: true }),
);
const wire = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.004, 1),
  new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.16 }),
);
const eyeMaterial = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.4, metalness: 0.2, roughness: 0.4 });
const eyeGeometry = new THREE.SphereGeometry(0.115, 20, 20);
const eyeL = new THREE.Mesh(eyeGeometry, eyeMaterial);
const eyeR = new THREE.Mesh(eyeGeometry, eyeMaterial);
eyeL.position.set(-0.3, 0.16, 0.9);
eyeR.position.set(0.3, 0.16, 0.9);
const jaw = new THREE.Group();
jaw.position.set(0, -0.34, 0.72);
const jawPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.62, 0.1, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x131317, metalness: 0.9, roughness: 0.35, flatShading: true }),
);
const jawGlow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85 }));
jawGlow.position.set(0, 0.06, 0.16);
jaw.add(jawPlate, jawGlow);
head.add(shell, wire, eyeL, eyeR, jaw);

let speaking = false;
let thinking = false;
let jawValue = 0;
let pulse = 0;
let visible = true;
let looping = false;

function applyTheme(id: ThemeId): void {
  const theme = THEMES[id];
  settings.theme = id;
  accent.setHex(theme.accent);
  const css = document.documentElement.style;
  css.setProperty("--accent", `#${theme.accent.toString(16).padStart(6, "0")}`);
  css.setProperty("--accent-bright", theme.bright);
  css.setProperty("--accent-glow", `#${theme.accent.toString(16).padStart(6, "0")}55`);
  css.setProperty("--eye", theme.bright);
  (wire.material as THREE.MeshBasicMaterial).color.setHex(theme.accent);
  eyeMaterial.color.setHex(theme.accent);
  eyeMaterial.emissive.setHex(theme.accent);
  (jawGlow.material as THREE.MeshBasicMaterial).color.setHex(theme.accent);
  rimLight.color.setHex(theme.accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#050505");
  for (const button of themesEl.querySelectorAll<HTMLButtonElement>(".theme")) {
    button.setAttribute("aria-pressed", String(button.dataset.theme === id));
  }
}

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

const clock = new THREE.Clock();

function frame(): void {
  if (!visible) {
    looping = false;
    return;
  }
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  head.position.y = Math.sin(t * 0.9) * 0.045;
  head.rotation.y = Math.sin(t * (thinking ? 1.3 : 0.42)) * (thinking ? 0.34 : 0.22);
  head.rotation.x = Math.sin(t * 0.31) * 0.05;
  const jawTarget = speaking ? 0.34 : 0;
  jawValue += (jawTarget - jawValue) * Math.min(1, dt * 12);
  jaw.rotation.x = jawValue + (speaking ? Math.abs(Math.sin(t * 11)) * 0.16 : 0);
  pulse += dt * (speaking || thinking ? 6.5 : 1.6);
  eyeMaterial.emissiveIntensity = 1.9 + Math.sin(pulse) * (speaking || thinking ? 0.9 : 0.35);
  (jawGlow.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(pulse) * 0.3;
  wire.rotation.y = -t * 0.12;
  renderer.render(scene3d, camera);
  requestAnimationFrame(frame);
}

/** Run the render loop only while the hero is on screen and the page is foreground. */
function syncRender(): void {
  visible = app.dataset.chatting !== "true" && !document.hidden;
  haloEl.dataset.active = String(speaking || thinking);
  if (visible && !looping) {
    looping = true;
    clock.getDelta();
    requestAnimationFrame(frame);
  }
}

function setThinking(next: boolean): void {
  thinking = next;
  haloEl.dataset.active = String(speaking || thinking);
}

/* ------------------------------------------------------------------ *
 * Voice - on-device speech only
 * ------------------------------------------------------------------ */

const synth = window.speechSynthesis as SpeechSynthesis | undefined;

function plainSpeech(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " code block. ").replace(/[`*#>_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function speak(text: string): void {
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(plainSpeech(text));
  utterance.rate = 0.98;
  utterance.pitch = 0.72;
  const voice = synth.getVoices().find((v) => /en-GB|en-US/i.test(v.lang) && /male|daniel|google uk english male/i.test(v.name));
  if (voice) utterance.voice = voice;
  const set = (on: boolean): void => {
    speaking = on;
    haloEl.dataset.active = String(speaking || thinking);
  };
  utterance.onstart = () => set(true);
  utterance.onend = () => set(false);
  utterance.onerror = () => set(false);
  synth.speak(utterance);
}

/* ------------------------------------------------------------------ *
 * Settings sheet
 * ------------------------------------------------------------------ */

function buildThemes(): void {
  themesEl.replaceChildren();
  for (const [id, theme] of Object.entries(THEMES) as Array<[ThemeId, Theme]>) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme";
    button.dataset.theme = id;
    button.style.setProperty("--swatch", `#${theme.accent.toString(16).padStart(6, "0")}`);
    const swatch = document.createElement("i");
    button.append(swatch, document.createTextNode(theme.label));
    button.addEventListener("click", () => {
      applyTheme(id);
      saveSettings();
    });
    themesEl.appendChild(button);
  }
}

function setNote(text: string, tone?: "ok" | "bad"): void {
  endpointNote.textContent = text;
  if (tone) endpointNote.dataset.tone = tone;
  else delete endpointNote.dataset.tone;
}

async function testLink(): Promise<void> {
  const url = endpointEl.value.trim().replace(/\/+$/, "");
  if (!url) return setNote("Enter an address first, for example http://192.168.1.20:8080.", "bad");
  if (!/^https?:\/\//i.test(url)) return setNote("The address must start with http:// or https://.", "bad");
  setNote("Testing…");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${url}/v1/health`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setNote("Linked. The brain answered.", "ok");
  } catch (error) {
    const why = error instanceof Error ? error.message : "no answer";
    setNote(`Could not reach it (${why}). Is the backend running on that address and port?`, "bad");
  } finally {
    window.clearTimeout(timer);
  }
}

function openSheet(): void {
  closeDrawer();
  endpointEl.value = settings.endpoint;
  setNote("Leave empty to stay fully on-device. Link your Ultran backend to get real replies.");
  sheetWrap.hidden = false;
}

function closeSheet(): void {
  const next = endpointEl.value.trim().replace(/\/+$/, "");
  if (next !== settings.endpoint) {
    settings.endpoint = next;
    store.agentId = undefined; // a different server has different agents
    for (const convo of store.conversations) convo.sessionId = undefined;
    saveStore();
  }
  saveSettings();
  setLink(settings.endpoint ? "offline" : "offline", settings.endpoint ? "ready" : "local");
  sheetWrap.hidden = true;
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

for (const [label, prompt] of SUGGESTIONS) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "suggestion";
  const tag = document.createElement("b");
  tag.textContent = label;
  card.append(tag, document.createTextNode(prompt));
  card.addEventListener("click", () => void submit(prompt));
  suggestionsEl.appendChild(card);
}

const hour = new Date().getHours();
greetingEl.textContent = hour < 5 ? "Still awake." : hour < 12 ? "Good morning." : hour < 18 ? "Ultran online." : "Good evening.";

promptEl.addEventListener("input", autosize);
promptEl.addEventListener("keydown", (event) => {
  // Enter sends on a hardware keyboard; on a touch keyboard it is a newline.
  if (event.key === "Enter" && !event.shiftKey && window.matchMedia("(hover: hover)").matches) {
    event.preventDefault();
    void submit(promptEl.value);
  }
});
composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit(promptEl.value);
});

voiceBtn.setAttribute("aria-pressed", String(settings.voice));
voiceBtn.addEventListener("click", () => {
  settings.voice = !settings.voice;
  voiceBtn.setAttribute("aria-pressed", String(settings.voice));
  if (!settings.voice) synth?.cancel();
  saveSettings();
});

menuBtn.addEventListener("click", openDrawer);
req<HTMLButtonElement>("#close-btn").addEventListener("click", closeDrawer);
scrim.addEventListener("click", closeDrawer);
newBtn.addEventListener("click", newConversation);
req<HTMLButtonElement>("#drawer-new").addEventListener("click", newConversation);
req<HTMLButtonElement>("#settings-btn").addEventListener("click", openSheet);
req<HTMLButtonElement>("#save-btn").addEventListener("click", closeSheet);
req<HTMLButtonElement>("#test-btn").addEventListener("click", () => void testLink());
req<HTMLButtonElement>("#clear-btn").addEventListener("click", () => {
  if (!window.confirm("Delete every conversation on this device?")) return;
  store.conversations = [];
  store.activeId = null;
  saveStore();
  closeSheet();
  renderConversation();
});
sheetWrap.addEventListener("click", (event) => {
  if (event.target === sheetWrap) closeSheet();
});

threadEl.addEventListener("scroll", () => {
  jumpBtn.hidden = nearBottom() || app.dataset.chatting !== "true";
});
jumpBtn.addEventListener("click", () => scrollToEnd());

// The hero avatar is tappable: it says a line, the fastest way to hear it work.
const PRESETS = ["Ultran online. All systems nominal.", "Awaiting your objective.", "The brain is local. The decision is yours."];
canvas.addEventListener("pointerdown", () => speak(PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? PRESETS[0]!));

document.addEventListener("visibilitychange", syncRender);
if (synth) {
  synth.getVoices();
  synth.onvoiceschanged = () => synth.getVoices();
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

initConnectors({ linked: () => baseUrl() !== "", api, closeDrawer });
buildThemes();
applyTheme(settings.theme);
setLink("offline", settings.endpoint ? "ready" : "local");
renderConversation();
autosize();
resize();

declare global {
  interface Window {
    __ULTRAN__?: { ready: true; theme: () => ThemeId; send: (text: string) => Promise<void> };
  }
}

window.__ULTRAN__ = { ready: true, theme: () => settings.theme, send: submit };
