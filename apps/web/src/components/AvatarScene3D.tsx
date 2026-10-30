"use client";

/**
 * AvatarScene3D - the Ultran avatar rendered with three.js.
 *
 * The head is a faceted graphite shell with a wireframe cage, two emissive eye
 * plates, a segmented jaw, a halo ring and an orbiting particle field. Scene,
 * accent colour and emotion rig come from the server, so moving the avatar
 * through the API moves it here too.
 *
 * Animation model
 * - One renderer for the lifetime of the component. Props (scene, emotion,
 *   speaking) are mirrored into refs and eased toward each frame, so changing
 *   them never rebuilds WebGL state or causes a visible pop.
 * - All motion is driven by real elapsed time, not frame counts, so it looks
 *   the same at 30, 60 or 144 Hz.
 * - The loop pauses while the tab is hidden or the stage is off screen.
 * - `prefers-reduced-motion` keeps a still, softly lit pose with no drift.
 *
 * Everything is disposed on unmount; no WebGL context is leaked between routes.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { emotions, palette, scenes, type EmotionId, type SceneId } from "@/theme/palette";

export type AvatarScene3DProps = {
  scene: SceneId;
  emotion: EmotionId;
  speaking?: boolean;
  height?: number;
};

const PARTICLE_COUNT = 220;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Frame-rate independent exponential smoothing. `rate` is roughly 1/seconds. */
const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

type Rig = {
  head: THREE.Group;
  shell: THREE.Mesh;
  cage: THREE.Mesh;
  cageMat: THREE.MeshBasicMaterial;
  eyes: THREE.Mesh[];
  eyeMat: THREE.MeshStandardMaterial;
  jaw: THREE.Mesh;
  jawMat: THREE.MeshStandardMaterial;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  particles: THREE.Points;
  particleMat: THREE.PointsMaterial;
  particleSeed: Float32Array;
  grid: THREE.GridHelper;
  gridMat: THREE.Material;
  key: THREE.DirectionalLight;
  rim: THREE.PointLight;
  fog: THREE.Fog;
};

function buildRig(world: THREE.Scene, accent: THREE.Color, fogColor: THREE.Color): Rig {
  const head = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.graphite),
      metalness: 0.92,
      roughness: 0.28,
      flatShading: true,
    }),
  );
  head.add(shell);

  const cageMat = new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.28 });
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.06, 1), cageMat);
  head.add(cage);

  const eyeMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 2.4,
    metalness: 0.1,
    roughness: 0.2,
  });
  const eyeGeo = new THREE.BoxGeometry(0.3, 0.09, 0.08);
  const eyes: THREE.Mesh[] = [];
  for (const x of [-0.34, 0.34]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 0.14, 0.94);
    head.add(eye);
    eyes.push(eye);
  }

  const jawMat = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.8, roughness: 0.35 });
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.16), jawMat);
  jaw.position.set(0, -0.42, 0.86);
  head.add(jaw);

  // Halo ring behind the head, slowly precessing.
  const haloMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55 });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.012, 8, 128), haloMat);
  halo.position.z = -0.4;
  head.add(halo);

  world.add(head);

  // Orbiting particle field: each point has its own radius, phase and speed.
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
  const rim = new THREE.PointLight(new THREE.Color(palette.goldBright), 24, 14);
  rim.position.set(-3, -1.5, -3);
  world.add(rim);

  const fog = new THREE.Fog(fogColor, 6, 16);
  world.fog = fog;

  return { head, shell, cage, cageMat, eyes, eyeMat, jaw, jawMat, halo, haloMat, particles, particleMat, particleSeed, grid, gridMat, key, rim, fog };
}

export default function AvatarScene3D({ scene, emotion, speaking = false, height = 460 }: AvatarScene3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  // Live props, read by the animation loop without re-running the effect.
  const live = useRef({ scene, emotion, speaking });
  live.current = { scene, emotion, speaking };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const initialAccent = new THREE.Color(scenes[live.current.scene]?.accent ?? palette.gold);
    const initialFog = new THREE.Color(scenes[live.current.scene]?.fog ?? palette.void);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, height);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / height, 0.1, 100);
    camera.position.set(0, 0.6, 4.4);
    camera.lookAt(0, 0, 0);

    const world = new THREE.Scene();
    const rig = buildRig(world, initialAccent, initialFog);

    // Smoothed state.
    const accent = initialAccent.clone();
    const fogTarget = new THREE.Color();
    const accentTarget = new THREE.Color();
    const state = {
      pulseHz: 0.4,
      intensity: 0.55,
      mouth: 0.02,
      speakEnergy: 0,
      blink: 0,
      nextBlink: 1.8,
      gazeX: 0,
      gazeY: 0,
      targetGazeX: 0,
      targetGazeY: 0,
      spawn: new THREE.Vector3(),
      cameraLift: 0,
    };
    const spawnTarget = new THREE.Vector3();

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
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      elapsed += dt;
      const t = elapsed;
      const still = reduced.matches;
      const { scene: sceneId, emotion: emotionId, speaking: isSpeaking } = live.current;

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
      rig.eyeMat.color.copy(accent);
      rig.eyeMat.emissive.copy(accent);
      rig.jawMat.color.copy(accent);
      rig.haloMat.color.copy(accent);
      rig.particleMat.color.copy(accent);
      rig.key.color.copy(accent);
      (rig.grid.material as THREE.LineBasicMaterial).color.copy(accent);

      state.pulseHz = damp(state.pulseHz, emo.pulseHz, 2.5, dt);
      state.intensity = damp(state.intensity, emo.intensity, 2.5, dt);
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
      // A speaking head nods subtly with the syllable rhythm.
      rig.head.rotation.x += Math.sin(t * 5.5) * 0.025 * state.speakEnergy * drift;

      rig.cage.rotation.y = t * 0.12 * drift;
      rig.cage.rotation.x = Math.sin(t * 0.2) * 0.1 * drift;
      const cageScale = 1 + 0.015 * Math.sin(t * state.pulseHz * 3) * drift + 0.02 * state.speakEnergy;
      rig.cage.scale.setScalar(cageScale);

      // --- Eyes: blink + saccade + emotion pulse ----------------------------
      state.nextBlink -= dt;
      if (state.nextBlink <= 0 && !still) {
        state.blink = 1;
        state.nextBlink = 2.2 + Math.random() * 3.6 - (emotionId === "alert" ? 1.2 : 0);
      }
      state.blink = Math.max(0, state.blink - dt * 7);
      const lid = 1 - Math.sin(state.blink * Math.PI); // 1 = open, dips to 0 mid-blink
      const squint = emotionId === "focused" ? 0.78 : emotionId === "alert" ? 1.15 : 1;
      for (const eye of rig.eyes) {
        eye.scale.y = Math.max(0.08, lid * squint);
        eye.position.x = Math.sign(eye.position.x) * 0.34 + state.gazeX * 0.03;
        eye.position.y = 0.14 - state.gazeY * 0.02;
      }
      rig.eyeMat.emissiveIntensity =
        1.2 + state.intensity * (1 + Math.sin(t * state.pulseHz * 3)) * 1.1 + state.speakEnergy * 0.5;

      // --- Jaw: layered syllable envelope while speaking --------------------
      // Two incommensurate sines plus a slow envelope read as speech cadence.
      const syllable = Math.abs(Math.sin(t * 9.5)) * 0.65 + Math.abs(Math.sin(t * 5.3 + 1.1)) * 0.35;
      const envelope = 0.55 + 0.45 * Math.sin(t * 1.7);
      const mouthTarget = 0.02 + state.speakEnergy * (0.04 + syllable * envelope * 0.18);
      state.mouth = damp(state.mouth, mouthTarget, 30, dt);
      rig.jaw.position.y = -0.42 - state.mouth;
      rig.jaw.scale.x = 1 - state.mouth * 0.6;

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

      // Slow camera dolly so the scene never feels pinned.
      camera.position.x = Math.sin(t * 0.12) * 0.25 * drift + state.gazeX * 0.15;
      camera.position.y = 0.6 + Math.cos(t * 0.1) * 0.08 * drift - state.gazeY * 0.08;
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
      intersection.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointermove", onPointerMove);
      world.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [height]);

  return (
    <div className="ultran-stage" ref={mountRef} style={{ height }} aria-label="3D Ultran avatar">
      <div className="ultran-stage-overlay">
        <div>
          <div className="ultran-stage-caption">Ultran</div>
          <div className="ultran-stage-scene">{scenes[scene]?.label ?? "Obsidian Palace"}</div>
        </div>
        <div>
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
