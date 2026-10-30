"use client";

/**
 * AvatarHero - the interactive Ultran stage for the landing page.
 *
 * The 3D scene is loaded on the client only (three.js + WebGL), and the page
 * keeps a same-height placeholder so layout never jumps while it loads.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmotionId, SceneId } from "@/theme/palette";
import { scenes } from "@/theme/palette";

const AvatarScene3D = dynamic(() => import("./AvatarScene3D"), {
  ssr: false,
  loading: () => <div className="ultran-stage" style={{ height: 460 }} aria-hidden="true" />,
});

const EMOTIONS: readonly EmotionId[] = ["calm", "focused", "alert", "triumphant"];
const SCENE_IDS = Object.keys(scenes) as SceneId[];

export default function AvatarHero() {
  const [scene, setScene] = useState<SceneId>("palace");
  const [emotion, setEmotion] = useState<EmotionId>("calm");
  const [speaking, setSpeaking] = useState(false);
  const timer = useRef<number | null>(null);

  const speak = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setSpeaking(true);
    timer.current = window.setTimeout(() => setSpeaking(false), 5000);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section aria-label="Ultran avatar" style={{ marginTop: 40 }}>
      <AvatarScene3D scene={scene} emotion={emotion} speaking={speaking} />
      <div className="ultran-row" style={{ marginTop: 14, flexWrap: "wrap" }}>
        <button className="ultran-btn" onClick={speak} disabled={speaking}>
          {speaking ? "Speaking" : "Speak"}
        </button>
        {EMOTIONS.map((id) => (
          <button
            key={id}
            className={`ultran-btn ${emotion === id ? "" : "ultran-btn--ghost"}`}
            aria-pressed={emotion === id}
            onClick={() => setEmotion(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="ultran-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
        {SCENE_IDS.map((id) => (
          <button
            key={id}
            className={`ultran-btn ${scene === id ? "" : "ultran-btn--ghost"}`}
            aria-pressed={scene === id}
            onClick={() => setScene(id)}
          >
            {scenes[id].label}
          </button>
        ))}
      </div>
    </section>
  );
}
