"use client";

/**
 * AvatarScene3D - the Ultran avatar rendered with three.js.
 *
 * The head is a 499,280-triangle geodesic mesh sculpted on the GPU (see
 * avatar/faceGeometry.ts and avatar/faceShader.ts): brow, sockets, nose, a jaw
 * that opens, armour plating and energy veins. Around it orbits the Legion - 32
 * smaller faces drawn in one instanced call that speak and glow in chorus. A
 * coarse wire cage, halo ring and particle field complete the scene.
 *
 * Animation model
 * - One renderer for the lifetime of the component. Props (scene, emotion,
 *   speaking) are mirrored into refs and eased toward each frame, so changing
 *   them never rebuilds WebGL state or causes a visible pop.
 * - All motion is driven by real elapsed time, not frame counts.
 * - The face materialises from a low-poly mesh and refines to full detail.
 * - A frame-time governor steps the head down a quality tier on slow GPUs.
 * - The loop pauses while the tab is hidden or the stage is off screen.
 * - `prefers-reduced-motion` keeps a still, softly lit pose with no drift.
 * - If the face shader fails to compile, a plain metal head takes over.
 *
 * Everything is disposed on unmount; no WebGL context is leaked between routes.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { emotions, palette, scenes, type EmotionId, type SceneId } from "@/theme/palette";
import {
  FACE_TIERS,
  LEGION_SEGMENTS,
  TIER_ORDER,
  createFaceGeometry,
  faceCount,
  type FaceTierId,
} from "./avatar/faceGeometry";
import { createFaceMaterial, type FaceMaterial } from "./avatar/faceShader";

export type AvatarQuality = "auto" | FaceTierId;

export type AvatarScene3DProps = {
  scene: SceneId;
  emotion: EmotionId;
  speaking?: boolean;
  height?: number;
  /** Head detail. "auto" picks by device; "ultra" is the full 499,280-face mesh. */
  quality?: AvatarQuality;
};

const PARTICLE_COUNT = 220;
const LEGION_COUNT = 32;
const LEGION_RADIUS = 2.7;
const REVEAL_SECONDS = 2.4;
const BROW_BY_EMOTION: Record<EmotionId, number> = { calm: 0, focused: 0.8, alert: -0.5, triumphant: 0.25 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Frame-rate independent exponential smoothing. `rate` is roughly 1/seconds. */
const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

function pickTier(): FaceTierId {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.maxTouchPoints > 1 && window.innerWidth < 900);
  const memory = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 4;
  if (mobile || memory <= 4 || cores <= 2) return "high";
  return "ultra";
}

type Rig = {
  head: THREE.Group;
  face: THREE.Mesh;
  faceMat: FaceMaterial;
  legionGroup: THREE.Group;
  legion: THREE.InstancedMesh;
  cage: THREE.Mesh;
  cageMat: THREE.MeshBasicMaterial;
  eyes: THREE.Mesh[];
  eyeMat: THREE.MeshStandardMaterial;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  particles: THREE.Points;
  particleMat: THREE.PointsMaterial;
  particleSeed: Float32Array;
  grid: THREE.GridHelper;
  key: THREE.DirectionalLight;
  rim: THREE.PointLight;
  fog: THREE.Fog;
  body: THREE.Group;
  reactor: THREE.Mesh;
  reactorMat: THREE.MeshStandardMaterial;
  energyArcs: THREE.Mesh[];
};

function buildRig(world: THREE.Scene, accent: THREE.Color, fogColor: THREE.Color): Rig {
  const head = new THREE.Group();

  // Start at the lowest tier so the first frame is instant; the real mesh is swapped in after.
  const faceMat = createFaceMaterial(accent);
  const face = new THREE.Mesh(createFaceGeometry(FACE_TIERS.low), faceMat);
  face.frustumCulled = false;
  head.add(face);

  // Coarse lattice around the dense core: low-poly cage versus 500k-face skin.
  const cageMat = new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.2 });
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), cageMat);
  head.add(cage);

  // Ultron's signature optics are crimson, not scene-coloured. Keep them
  // independently driven so the environment can remain gold/black.
  const opticRed = new THREE.Color("#ff1728");
  const eyeMat = new THREE.MeshStandardMaterial({
    color: "#5b0710",
    emissive: opticRed,
    emissiveIntensity: 4.2,
    metalness: 0.25,
    roughness: 0.16,
  });
  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    // Angular tapered optic aperture rather than a rectangular LED block.
    const slit = new THREE.Shape();
    slit.moveTo(-0.17, -0.025);
    slit.lineTo(-0.11, 0.055);
    slit.lineTo(0.15, 0.035);
    slit.lineTo(0.19, -0.018);
    slit.lineTo(0.02, -0.045);
    slit.closePath();
    const eye = new THREE.Mesh(new THREE.ShapeGeometry(slit), eyeMat);
    eye.position.set(side * 0.34, 0.14, 0.965);
    eye.rotation.y = side * -0.08;
    eye.scale.x = side;
    head.add(eye);
    eyes.push(eye);
  }

  const haloMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55 });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.012, 8, 128), haloMat);
  halo.position.z = -0.4;
  head.add(halo);

  world.add(head);

  // A full upper-body silhouette turns the floating mask into a mechanical
  // humanoid. Every plate is separate so the torso can subtly articulate.
  const body = new THREE.Group();
  body.position.set(0, -1.48, -0.02);
  const silver = new THREE.MeshStandardMaterial({
    color: "#aeb5bd", metalness: 0.94, roughness: 0.24,
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: "#303943", metalness: 0.9, roughness: 0.3,
  });
  const redCore = new THREE.MeshStandardMaterial({
    color: "#650713", metalness: 0.55, roughness: 0.18,
    emissive: "#ff1028", emissiveIntensity: 3.5,
  });
  const addPlate = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, scale: [number, number, number], rotation = 0) => {
    const plate = new THREE.Mesh(geometry, material);
    plate.position.set(x, y, z);
    plate.scale.set(...scale);
    plate.rotation.z = rotation;
    body.add(plate);
    return plate;
  };
  // Neck pistons and collar.
  addPlate(new THREE.CylinderGeometry(0.25, 0.34, 0.55, 10), darkSteel, 0, 0.75, 0, [1, 1, 0.8]);
  addPlate(new THREE.CylinderGeometry(0.39, 0.31, 0.16, 10), silver, 0, 0.48, 0, [1, 1, 0.9]);
  // Tapered chest and abdomen, with overlapping breastplate segments.
  addPlate(new THREE.SphereGeometry(0.82, 24, 18), darkSteel, 0, -0.12, -0.04, [1.0, 0.92, 0.52]);
  addPlate(new THREE.SphereGeometry(0.7, 24, 18), silver, 0, -0.03, 0.13, [1.0, 0.76, 0.34]);
  addPlate(new THREE.BoxGeometry(0.34, 0.48, 0.12), darkSteel, 0, -0.62, 0.34, [1, 1, 1]);
  for (const side of [-1, 1]) {
    addPlate(new THREE.SphereGeometry(0.47, 18, 14), silver, side * 0.83, 0.28, 0, [1.2, 0.82, 0.78], side * -0.16);
    addPlate(new THREE.BoxGeometry(0.42, 0.52, 0.2), darkSteel, side * 0.72, -0.35, 0.22, [1, 1, 1], side * -0.18);
    addPlate(new THREE.BoxGeometry(0.2, 0.58, 0.16), silver, side * 0.42, -0.34, 0.34, [1, 1, 1], side * 0.12);
    // Layered shoulder caps and exposed actuator joints.
    addPlate(new THREE.SphereGeometry(0.43, 18, 14), darkSteel, side * 1.02, 0.32, 0, [1.0, 0.8, 0.9]);
    addPlate(new THREE.SphereGeometry(0.34, 18, 14), silver, side * 1.08, 0.36, 0.12, [1.0, 0.78, 0.86]);
    addPlate(new THREE.CylinderGeometry(0.13, 0.16, 0.34, 10), darkSteel, side * 1.12, -0.16, 0, [1, 1, 1], Math.PI / 2);
  }
  // Red reactor lens, concentric mechanical bezel and animated energy arcs.
  const reactor = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 18), redCore);
  reactor.position.set(0, 0.02, 0.43);
  body.add(reactor);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 10, 48), silver);
  bezel.position.copy(reactor.position);
  body.add(bezel);
  const energyArcs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const arcMat = new THREE.MeshBasicMaterial({ color: "#ff2038", transparent: true, opacity: 0.72 });
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.34 + i * 0.09, 0.009, 6, 64, Math.PI * 1.35), arcMat);
    arc.position.copy(reactor.position);
    arc.rotation.set(0.15 + i * 0.45, i * 0.7, i * 1.1);
    body.add(arc);
    energyArcs.push(arc);
  }
  world.add(body);

  // The Legion: many faces, one draw call. They share the head's material, so
  // expression, glow and reveal uniforms drive the whole choir at once.
  const legionGroup = new THREE.Group();
  legionGroup.rotation.z = 0.32;
  const legion = new THREE.InstancedMesh(createFaceGeometry(LEGION_SEGMENTS), faceMat, LEGION_COUNT);
  legion.frustumCulled = false;
  legionGroup.add(legion);
  world.add(legionGroup);

  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const particleSeed = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    particleSeed[i * 3] = 1.7 + Math.random() * 1.6; // radius
    particleSeed[i * 3 + 1] = Math.random() * Math.PI * 2; // phase
    particleSeed[i * 3 + 2] = (0.08 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1); // angular speed
    positions[i * 3 + 1] = (Math.random() - 0.5) * 3.2;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: accent,
    size: 0.03,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  world.add(particles);

  const grid = new THREE.GridHelper(22, 24, accent, new THREE.Color(palette.hairline));
  grid.position.y = -1.9;
  const gridMat = grid.material as THREE.Material;
  gridMat.transparent = true;
  gridMat.opacity = 0.32;
  world.add(grid);

  world.add(new THREE.AmbientLight(new THREE.Color(palette.ink), 0.35));
  const key = new THREE.DirectionalLight(accent, 2.1);
  key.position.set(3, 4, 5);
  world.add(key);
  const rim = new THREE.PointLight(new THREE.Color("#ff1b2d"), 32, 18);
  rim.position.set(-3, 1.4, -2.5);
  world.add(rim);
  const coldRim = new THREE.PointLight(new THREE.Color("#8bb9ef"), 26, 16);
  coldRim.position.set(3.2, 0.8, -1.8);
  world.add(coldRim);
  const faceFill = new THREE.DirectionalLight(new THREE.Color("#e5efff"), 1.15);
  faceFill.position.set(-1.5, 1.2, 5);
  world.add(faceFill);
  const topLight = new THREE.SpotLight(new THREE.Color("#ffffff"), 42, 18, Math.PI / 5, 0.55, 1.2);
  topLight.position.set(0, 5, 3);
  topLight.target.position.set(0, 0, 0);
  world.add(topLight, topLight.target);

  const fog = new THREE.Fog(fogColor, 6, 16);
  world.fog = fog;

  return { head, face, faceMat, legionGroup, legion, cage, cageMat, eyes, eyeMat, halo, haloMat, particles, particleMat, particleSeed, grid, key, rim, fog, body, reactor, reactorMat: redCore, energyArcs };
}

/** Counts up to `value` without re-rendering React on every tick. */
function FaceCount({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      shown.current = value;
      node.textContent = value.toLocaleString();
      return;
    }
    const from = shown.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = clamp01((now - start) / 1400);
      shown.current = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)));
      node.textContent = shown.current.toLocaleString();
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className="ultran-chip ultran-chip--free" title={`Head mesh. Legion adds ${(LEGION_COUNT * faceCount(LEGION_SEGMENTS)).toLocaleString()} more.`}>
      <span ref={ref}>0</span> faces
    </span>
  );
}

export default function AvatarScene3D({ scene, emotion, speaking = false, height = 460, quality = "auto" }: AvatarScene3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [faces, setFaces] = useState(faceCount(FACE_TIERS.low));

  // Live props, read by the animation loop without re-running the effect.
  const live = useRef({ scene, emotion, speaking });
  live.current = { scene, emotion, speaking };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const initialAccent = new THREE.Color(scenes[live.current.scene]?.accent ?? palette.gold);
    const initialFog = new THREE.Color(scenes[live.current.scene]?.fog ?? palette.void);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.setSize(mount.clientWidth, height);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / height, 0.1, 100);
    camera.position.set(0, 0.05, 5.75);
    camera.lookAt(0, 0, 0);

    const world = new THREE.Scene();
    const rig = buildRig(world, initialAccent, initialFog);

    // ---- Quality tier: refine after first paint, step down if the GPU struggles.
    const target: FaceTierId = quality === "auto" ? pickTier() : quality;
    let tierIndex = 0; // currently on "low"
    const swapTier = (id: FaceTierId) => {
      const next = createFaceGeometry(FACE_TIERS[id]);
      const prev = rig.face.geometry;
      rig.face.geometry = next;
      prev.dispose();
      tierIndex = TIER_ORDER.indexOf(id);
      setFaces(faceCount(FACE_TIERS[id]));
    };
    const upgradeTimer = target === "low" ? 0 : window.setTimeout(() => swapTier(target), 120);
    let governorLocked = false;
    let slowFrames = 0;
    let sampledFrames = 0;

    // ---- Shader safety net: if the face program fails, fall back to plain metal.
    let shaderFailed = false;
    let fallbackApplied = false;
    renderer.debug.onShaderError = () => {
      shaderFailed = true;
    };
    const applyFallback = () => {
      fallbackApplied = true;
      const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.graphite), metalness: 0.92, roughness: 0.28, flatShading: true });
      rig.face.material = metal;
      rig.legion.material = metal;
      rig.face.geometry.dispose();
      rig.face.geometry = new THREE.IcosahedronGeometry(1, 3);
      rig.legion.geometry.dispose();
      rig.legion.geometry = new THREE.IcosahedronGeometry(1, 1);
      setFaces(80 * 4);
    };

    // Smoothed state.
    const accent = initialAccent.clone();
    const fogTarget = new THREE.Color();
    const accentTarget = new THREE.Color();
    const state = {
      pulseHz: 0.4,
      intensity: 0.55,
      mouth: 0.02,
      speakEnergy: 0,
      brow: 0,
      blink: 0,
      nextBlink: 1.8,
      gazeX: 0,
      gazeY: 0,
      targetGazeX: 0,
      targetGazeY: 0,
      spawn: new THREE.Vector3(),
    };
    const spawnTarget = new THREE.Vector3();
    const dummy = new THREE.Object3D();

    const onPointerMove = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      state.targetGazeX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      state.targetGazeY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    const onPointerLeave = () => {
      state.targetGazeX = 0;
      state.targetGazeY = 0;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);

    let raf = 0;
    let running = false;
    let visible = true;
    let last = performance.now();
    let elapsed = 0;

    const frame = (now: number) => {
      const rawDt = (now - last) / 1000;
      const dt = Math.min(0.1, rawDt);
      last = now;
      elapsed += dt;
      const t = elapsed;
      const still = reduced.matches;
      const { scene: sceneId, emotion: emotionId, speaking: isSpeaking } = live.current;

      if (shaderFailed && !fallbackApplied) applyFallback();

      // --- Frame-time governor: drop a tier if the head is too heavy here -----
      if (!governorLocked && elapsed > REVEAL_SECONDS + 0.5 && rawDt < 0.25) {
        sampledFrames += 1;
        if (rawDt > 1 / 28) slowFrames += 1;
        if (sampledFrames >= 90) {
          if (slowFrames > 45 && tierIndex > 1) swapTier(TIER_ORDER[tierIndex - 1] ?? "medium");
          else if (slowFrames <= 45) governorLocked = true;
          sampledFrames = 0;
          slowFrames = 0;
        }
      }

      // --- Ease toward the current scene / emotion targets -----------------
      const emo = emotions[emotionId] ?? emotions.calm;
      const sc = scenes[sceneId];
      accentTarget.set(sc?.accent ?? palette.gold);
      fogTarget.set(sc?.fog ?? palette.void);
      const [sx, sy, sz] = sc?.spawn ?? [0, 0, 0];
      spawnTarget.set(sx * 0.35, sy, sz * 0.25);

      accent.lerp(accentTarget, 1 - Math.exp(-3 * dt));
      rig.fog.color.lerp(fogTarget, 1 - Math.exp(-3 * dt));
      rig.cageMat.color.copy(accent);
      // Red optics and reactor are a fixed character signature; only the
      // surrounding armour reflections follow the selected scene accent.
      rig.eyeMat.color.set("#5b0710");
      rig.eyeMat.emissive.set("#ff1728");
      rig.haloMat.color.copy(accent);
      rig.particleMat.color.copy(accent);
      rig.key.color.copy(accent);
      (rig.grid.material as THREE.LineBasicMaterial).color.copy(accent);

      state.pulseHz = damp(state.pulseHz, emo.pulseHz, 2.5, dt);
      state.intensity = damp(state.intensity, emo.intensity, 2.5, dt);
      state.brow = damp(state.brow, BROW_BY_EMOTION[emotionId] ?? 0, 4, dt);
      state.spawn.lerp(spawnTarget, 1 - Math.exp(-2 * dt));

      // --- Head: idle drift, breathing, gaze --------------------------------
      state.gazeX = damp(state.gazeX, state.targetGazeX, 5, dt);
      state.gazeY = damp(state.gazeY, state.targetGazeY, 5, dt);
      const drift = still ? 0 : 1;
      const breathe = Math.sin(t * (state.pulseHz * 1.4 + 0.6)) * 0.06 * drift;
      state.speakEnergy = damp(state.speakEnergy, isSpeaking ? 1 : 0, 8, dt);

      rig.head.position.set(state.spawn.x, state.spawn.y + breathe, state.spawn.z);
      rig.head.rotation.y = Math.sin(t * 0.35) * 0.22 * drift + state.gazeX * 0.35;
      rig.head.rotation.x = state.gazeY * 0.18 + Math.sin(t * 0.5) * 0.03 * drift;
      rig.head.rotation.z = Math.sin(t * 0.27) * 0.02 * drift;
      rig.body.rotation.y = Math.sin(t * 0.35 + 0.7) * 0.035 * drift + state.gazeX * 0.08;
      rig.body.rotation.x = Math.sin(t * 0.55) * 0.012 * drift;
      rig.head.rotation.x += Math.sin(t * 5.5) * 0.025 * state.speakEnergy * drift;

      rig.cage.rotation.y = t * 0.12 * drift;
      rig.cage.rotation.x = Math.sin(t * 0.2) * 0.1 * drift;
      rig.cage.scale.setScalar(1 + 0.015 * Math.sin(t * state.pulseHz * 3) * drift + 0.02 * state.speakEnergy);

      // --- Eyes: blink + saccade + emotion pulse ----------------------------
      state.nextBlink -= dt;
      if (state.nextBlink <= 0 && !still) {
        state.blink = 1;
        state.nextBlink = 2.2 + Math.random() * 3.6 - (emotionId === "alert" ? 1.2 : 0);
      }
      state.blink = Math.max(0, state.blink - dt * 7);
      const lid = 1 - Math.sin(state.blink * Math.PI);
      const squint = emotionId === "focused" ? 0.78 : emotionId === "alert" ? 1.15 : 1;
      for (const eye of rig.eyes) {
        eye.scale.y = Math.max(0.08, lid * squint);
        eye.position.x = Math.sign(eye.position.x) * 0.34 + state.gazeX * 0.03;
        eye.position.y = 0.14 - state.gazeY * 0.02;
      }
      rig.eyeMat.emissiveIntensity =
        2.8 + state.intensity * (1 + Math.sin(t * state.pulseHz * 3)) * 1.8 + state.speakEnergy * 0.8;
      rig.reactorMat.emissiveIntensity = 2.4 + state.intensity * 2.8 + state.speakEnergy * 1.4 + Math.sin(t * state.pulseHz * 4) * 0.8;
      for (let i = 0; i < rig.energyArcs.length; i += 1) {
        const arc = rig.energyArcs[i]!;
        arc.rotation.z += dt * (i % 2 === 0 ? 0.7 : -0.9) * (0.5 + state.intensity);
        (arc.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * (2.4 + i) + i));
      }

      // --- Mouth: layered syllable envelope while speaking ------------------
      const syllable = Math.abs(Math.sin(t * 9.5)) * 0.65 + Math.abs(Math.sin(t * 5.3 + 1.1)) * 0.35;
      const envelope = 0.55 + 0.45 * Math.sin(t * 1.7);
      const mouthTarget = 0.02 + state.speakEnergy * (0.04 + syllable * envelope * 0.18);
      state.mouth = damp(state.mouth, mouthTarget, 30, dt);

      // --- Face uniforms (shared by the head and every Legion face) ---------
      const u = rig.faceMat.uniforms;
      u.uTime.value = t;
      u.uMouth.value = clamp01((state.mouth - 0.02) / 0.2);
      u.uBrow.value = state.brow;
      u.uSpeak.value = state.speakEnergy;
      u.uEnergy.value = state.intensity;
      u.uReveal.value = still ? 1 : clamp01(t / REVEAL_SECONDS);
      u.uAccent.value.copy(accent);

      // --- The Legion: a tilted ring of faces that turn to watch the head ----
      rig.legionGroup.rotation.y = t * 0.12 * drift;
      for (let i = 0; i < LEGION_COUNT; i += 1) {
        const a = (i / LEGION_COUNT) * Math.PI * 2;
        const bob = Math.sin(t * 0.8 + i * 1.7) * 0.12 * drift;
        dummy.position.set(Math.cos(a) * LEGION_RADIUS, bob, Math.sin(a) * LEGION_RADIUS);
        dummy.lookAt(0, 0, 0);
        dummy.scale.setScalar(0.11 * (1 + 0.1 * Math.sin(t * 2 + i) * drift + 0.15 * state.speakEnergy));
        dummy.updateMatrix();
        rig.legion.setMatrixAt(i, dummy.matrix);
      }
      rig.legion.instanceMatrix.needsUpdate = true;

      // --- Halo, particles, rim light ---------------------------------------
      rig.halo.rotation.z = t * 0.25 * drift;
      rig.halo.rotation.x = 1.15 + Math.sin(t * 0.3) * 0.12 * drift;
      rig.haloMat.opacity = 0.35 + state.intensity * 0.3 + state.speakEnergy * 0.2;
      rig.halo.scale.setScalar(1 + state.speakEnergy * 0.06 * Math.sin(t * 8));

      const pos = rig.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const radius = rig.particleSeed[i * 3] ?? 2;
        const phase = rig.particleSeed[i * 3 + 1] ?? 0;
        const speed = rig.particleSeed[i * 3 + 2] ?? 0.1;
        const a = phase + (still ? 0 : t * speed * (0.6 + state.intensity));
        pos.setXYZ(i, Math.cos(a) * radius, pos.getY(i), Math.sin(a) * radius - 0.6);
      }
      pos.needsUpdate = true;
      rig.particleMat.opacity = 0.45 + state.intensity * 0.35;

      rig.rim.intensity = 20 + Math.sin(t * state.pulseHz * 2) * 4 * drift + state.speakEnergy * 6;

      camera.position.x = Math.sin(t * 0.12) * 0.25 * drift + state.gazeX * 0.15;
      camera.position.y = 0.05 + Math.cos(t * 0.1) * 0.08 * drift - state.gazeY * 0.08;
      camera.lookAt(0, 0, 0);

      renderer.render(world, camera);
    };

    const loop = (now: number) => {
      frame(now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    const intersection = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) start();
        else stop();
      },
      { threshold: 0.01 },
    );
    intersection.observe(mount);

    const resize = new ResizeObserver(() => {
      const w = mount.clientWidth;
      if (w === 0) return;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
      if (!running) renderer.render(world, camera);
    });
    resize.observe(mount);

    // First frame immediately so reduced-motion users still get a rendered pose.
    frame(performance.now());
    start();
    setReady(true);

    return () => {
      stop();
      window.clearTimeout(upgradeTimer);
      intersection.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointermove", onPointerMove);
      renderer.debug.onShaderError = null;
      world.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      rig.legion.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [height, quality]);

  return (
    <div className="ultran-stage" ref={mountRef} style={{ height }} aria-label="3D Ultran avatar">
      <div className="ultran-stage-overlay">
        <div>
          <div className="ultran-stage-caption">Ultran</div>
          <div className="ultran-stage-scene">{scenes[scene]?.label ?? "Obsidian Palace"}</div>
        </div>
        <div>
          <FaceCount value={faces} />
          <span className="ultran-chip ultran-chip--free">legion x{LEGION_COUNT}</span>
          <span
            key={emotion}
            className={`ultran-chip ultran-chip--pop ${emotion === "alert" ? "ultran-chip--paid" : "ultran-chip--free"}`}
          >
            {emotion}
          </span>
          {!ready && <span className="ultran-chip">initialising</span>}
        </div>
      </div>
    </div>
  );
}
