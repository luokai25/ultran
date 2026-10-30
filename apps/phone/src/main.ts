/**
 * Ultran phone shell - the avatar stage and the voice console.
 *
 * The phone client is deliberately self-contained: the brain runs on the device,
 * so the shell must render and speak with no network at all. When a local control
 * plane is reachable it is used for scene/emotion state; when it is not, the
 * client degrades to its built-in palette and the on-device speech engine.
 */

import * as THREE from "three";

type SceneId = "palace" | "forge" | "marketplace" | "war-room";

type SceneSpec = {
  label: string;
  accent: number;
  floor: number;
  fog: number;
  spawn: [number, number, number];
};

const SCENES: Record<SceneId, SceneSpec> = {
  palace: { label: "Obsidian Palace", accent: 0xd4af37, floor: 0x0b0b0d, fog: 0x050505, spawn: [0, 0, 0] },
  forge: { label: "The Forge", accent: 0xff8a3d, floor: 0x120d07, fog: 0x0a0603, spawn: [-2, 0, 1.5] },
  marketplace: { label: "Marketplace Vault", accent: 0xf5d76e, floor: 0x0a0a0e, fog: 0x050507, spawn: [2, 0, -1] },
  "war-room": { label: "War Room", accent: 0xe5484d, floor: 0x0d0a0a, fog: 0x070404, spawn: [0, 0, 2.5] },
};

const PRESETS = [
  "Ultran online. All systems nominal.",
  "Nine connectors armed. Awaiting your objective.",
  "Deployment published. Rollback point secured.",
];

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`phone shell: missing required node ${selector}`);
  return node;
}

const canvas = required<HTMLCanvasElement>("#avatar");
const statusEl = required<HTMLElement>("#status");
const lineEl = required<HTMLElement>("#line");
const haloEl = required<HTMLElement>(".halo");
const form = required<HTMLFormElement>("#speak-form");
const promptEl = required<HTMLInputElement>("#prompt");
const chips = Array.from(document.querySelectorAll<HTMLButtonElement>(".chip"));

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0.15, 5.2);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(2.4, 3.2, 3.6);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xd4af37, 1.1);
rimLight.position.set(-3, 1.2, -2.4);
scene.add(rimLight);

scene.add(new THREE.AmbientLight(0x2a2a33, 1.4));

const accent = new THREE.Color(SCENES.palace.accent);

/* ------------------------------------------------------------------ *
 * The head: a faceted gold shell, two emissive eye plates, a segmented jaw
 * ------------------------------------------------------------------ */

const head = new THREE.Group();
scene.add(head);

const shell = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1, 1),
  new THREE.MeshStandardMaterial({
    color: 0x1b1b21,
    metalness: 0.92,
    roughness: 0.28,
    flatShading: true,
  }),
);
head.add(shell);

const wire = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.004, 1),
  new THREE.MeshBasicMaterial({
    color: accent,
    wireframe: true,
    transparent: true,
    opacity: 0.16,
  }),
);
head.add(wire);

const eyeMaterial = new THREE.MeshStandardMaterial({
  color: accent,
  emissive: accent,
  emissiveIntensity: 2.4,
  metalness: 0.2,
  roughness: 0.4,
});

const eyeGeometry = new THREE.SphereGeometry(0.115, 20, 20);
const eyeL = new THREE.Mesh(eyeGeometry, eyeMaterial);
eyeL.position.set(-0.3, 0.16, 0.9);
const eyeR = new THREE.Mesh(eyeGeometry, eyeMaterial);
eyeR.position.set(0.3, 0.16, 0.9);
head.add(eyeL, eyeR);

const jaw = new THREE.Group();
jaw.position.set(0, -0.34, 0.72);
head.add(jaw);

const jawPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.62, 0.1, 0.3),
  new THREE.MeshStandardMaterial({
    color: 0x131317,
    metalness: 0.9,
    roughness: 0.35,
    flatShading: true,
  }),
);
jaw.add(jawPlate);

const jawGlow = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.02, 0.02),
  new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85 }),
);
jawGlow.position.set(0, 0.06, 0.16);
jaw.add(jawGlow);

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let currentScene: SceneId = "palace";
let speaking = false;
let jawTarget = 0;
let jawValue = 0;
let pulse = 0;

function applyScene(id: SceneId): void {
  const spec = SCENES[id];
  currentScene = id;
  accent.setHex(spec.accent);

  (shell.material as THREE.MeshStandardMaterial).color.setHex(0x1b1b21);
  (wire.material as THREE.MeshBasicMaterial).color.setHex(spec.accent);
  eyeMaterial.color.setHex(spec.accent);
  eyeMaterial.emissive.setHex(spec.accent);
  (jawGlow.material as THREE.MeshBasicMaterial).color.setHex(spec.accent);

  scene.fog = new THREE.Fog(spec.fog, 6, 16);
  renderer.setClearColor(spec.fog, 0);

  head.position.set(spec.spawn[0] * 0.12, spec.spawn[1], spec.spawn[2] * 0.1);

  for (const chip of chips) {
    chip.setAttribute("aria-pressed", String(chip.dataset.scene === id));
  }
}

/* ------------------------------------------------------------------ *
 * Voice - on-device only
 * ------------------------------------------------------------------ */

const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

function setSpeaking(next: boolean): void {
  speaking = next;
  jawTarget = next ? 0.34 : 0;
  statusEl.dataset.state = next ? "speaking" : "idle";
  statusEl.textContent = next ? "speaking" : "local";
  haloEl.dataset.speaking = String(next);
}

function speak(text: string): void {
  lineEl.textContent = text;

  if (!synth) {
    // No speech engine: still animate the jaw so the line reads as delivered.
    setSpeaking(true);
    window.setTimeout(() => setSpeaking(false), Math.min(4200, 900 + text.length * 42));
    return;
  }

  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.98;
  utterance.pitch = 0.72;
  utterance.volume = 1;

  const preferred = synth
    .getVoices()
    .find((v) => /en-GB|en-US/i.test(v.lang) && /male|daniel|google uk english male/i.test(v.name));
  if (preferred) utterance.voice = preferred;

  utterance.onstart = () => setSpeaking(true);
  utterance.onend = () => setSpeaking(false);
  utterance.onerror = () => setSpeaking(false);

  setSpeaking(true);
  synth.speak(utterance);
}

/* ------------------------------------------------------------------ *
 * Interaction
 * ------------------------------------------------------------------ */

for (const chip of chips) {
  chip.addEventListener("click", () => {
    const id = chip.dataset.scene as SceneId | undefined;
    if (id && id in SCENES) applyScene(id);
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if (!text) return;
  promptEl.value = "";
  speak(text);
});

// A tap on the avatar cycles the preset lines - the fastest way to hear it work.
canvas.addEventListener("pointerdown", () => {
  const next = PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? PRESETS[0]!;
  speak(next);
});

/* ------------------------------------------------------------------ *
 * Resize + render loop
 * ------------------------------------------------------------------ */

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const observer = new ResizeObserver(resize);
observer.observe(canvas);
resize();

const clock = new THREE.Clock();

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // Idle float, plus a slow yaw so the facets catch the key light.
  head.position.y = Math.sin(t * 0.9) * 0.045;
  head.rotation.y = Math.sin(t * 0.42) * 0.22;
  head.rotation.x = Math.sin(t * 0.31) * 0.05;

  // Jaw follows the target with a spring, and chatters while speaking.
  jawValue += (jawTarget - jawValue) * Math.min(1, dt * 12);
  const chatter = speaking ? Math.abs(Math.sin(t * 11)) * 0.16 : 0;
  jaw.rotation.x = jawValue + chatter;

  // Eye pulse.
  pulse += dt * (speaking ? 6.5 : 1.6);
  const glow = 1.9 + Math.sin(pulse) * (speaking ? 0.9 : 0.35);
  eyeMaterial.emissiveIntensity = glow;
  (jawGlow.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(pulse) * 0.3;

  wire.rotation.y = -t * 0.12;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

applyScene("palace");
requestAnimationFrame(frame);

// Warm the voice list - some WebViews populate it asynchronously.
if (synth) {
  synth.getVoices();
  window.speechSynthesis.onvoiceschanged = () => synth.getVoices();
}

// Expose a tiny surface for the native shell and for smoke tests.
declare global {
  interface Window {
    __ULTRAN__?: {
      scene: () => SceneId;
      speak: (text: string) => void;
      ready: true;
    };
  }
}

window.__ULTRAN__ = {
  scene: () => currentScene,
  speak,
  ready: true,
};
