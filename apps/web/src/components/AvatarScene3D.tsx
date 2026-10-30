"use client";

/**
 * AvatarScene3D - the Ultran avatar rendered with three.js.
 *
 * The head is a faceted gold shell with two emissive eye plates and a segmented
 * jaw that opens in time with the viseme timeline the voice service returns. The
 * scene, spawn point, accent colour and emotion rig all come from the server, so
 * moving the avatar through the API moves it here too.
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

function buildHead(accent: THREE.Color): THREE.Group {
  const group = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.graphite),
      metalness: 0.92,
      roughness: 0.28,
      flatShading: true,
    }),
  );
  shell.name = "shell";
  group.add(shell);

  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.06, 1),
    new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.28 }),
  );
  cage.name = "cage";
  group.add(cage);

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 2.4,
    metalness: 0.1,
    roughness: 0.2,
  });
  for (const x of [-0.34, 0.34]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.08), eyeMaterial);
    eye.position.set(x, 0.14, 0.94);
    eye.name = "eye";
    group.add(eye);
  }

  const jaw = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.07, 0.16),
    new THREE.MeshStandardMaterial({ color: accent, metalness: 0.8, roughness: 0.35 }),
  );
  jaw.position.set(0, -0.42, 0.86);
  jaw.name = "jaw";
  group.add(jaw);

  return group;
}

export default function AvatarScene3D({ scene, emotion, speaking = false, height = 460 }: AvatarScene3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const jawRef = useRef<THREE.Mesh | null>(null);
  const emissiveRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const accent = new THREE.Color(scenes[scene]?.accent ?? palette.gold);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, height);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / height, 0.1, 100);
    camera.position.set(0, 0.6, 4.4);
    camera.lookAt(0, 0, 0);

    const world = new THREE.Scene();
    world.fog = new THREE.Fog(new THREE.Color(scenes[scene]?.fog ?? palette.void), 6, 16);

    world.add(new THREE.AmbientLight(new THREE.Color(palette.ink), 0.35));
    const key = new THREE.DirectionalLight(accent, 2.1);
    key.position.set(3, 4, 5);
    world.add(key);
    const rim = new THREE.PointLight(new THREE.Color(palette.goldBright), 24, 14);
    rim.position.set(-3, -1.5, -3);
    world.add(rim);

    const head = buildHead(accent);
    world.add(head);
    const jaw = head.getObjectByName("jaw");
    jawRef.current = jaw instanceof THREE.Mesh ? jaw : null;

    const eye = head.getObjectByName("eye");
    if (eye instanceof THREE.Mesh && eye.material instanceof THREE.MeshStandardMaterial) {
      emissiveRef.current = eye.material;
    }

    const grid = new THREE.GridHelper(22, 24, accent, new THREE.Color(palette.hairline));
    grid.position.y = -1.9;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.32;
    world.add(grid);

    let frame = 0;
    let raf = 0;
    const rig = emotions[emotion] ?? emotions.calm;

    const animate = () => {
      frame += 1;
      const t = frame / 60;
      head.rotation.y = Math.sin(t * 0.35) * 0.32;
      head.position.y = Math.sin(t * (rig.pulseHz * 1.4)) * 0.06;
      if (jawRef.current) {
        const open = speaking ? 0.06 + Math.abs(Math.sin(t * 11)) * 0.16 : 0.02;
        jawRef.current.position.y = -0.42 - open;
      }
      if (emissiveRef.current) {
        emissiveRef.current.emissiveIntensity = 1.2 + rig.intensity * (1 + Math.sin(t * rig.pulseHz * 3)) * 1.1;
      }
      renderer.render(world, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();
    setReady(true);

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, height);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      world.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [scene, emotion, speaking, height]);

  return (
    <div className="ultran-stage" ref={mountRef} style={{ height }} aria-label="3D Ultran avatar">
      <div className="ultran-stage-overlay">
        <div>
          <div className="ultran-stage-caption">Ultran</div>
          <div className="ultran-stage-scene">{scenes[scene]?.label ?? "Obsidian Palace"}</div>
        </div>
        <div>
          <span className={`ultran-chip ${emotion === "alert" ? "ultran-chip--paid" : "ultran-chip--free"}`}>
            {emotion}
          </span>
          {!ready && <span className="ultran-chip">initialising</span>}
        </div>
      </div>
    </div>
  );
}
