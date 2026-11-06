"use client";

/** Interactive core stage. Voice state is owned by the real voice console. */

import dynamic from "next/dynamic";
import { useState } from "react";
import type { EmotionId, SceneId } from "@/theme/palette";
import { scenes } from "@/theme/palette";

const AvatarScene3D = dynamic(() => import("./AvatarScene3D"), {
  ssr: false,
  loading: () => <div className="ultron-stage" data-core-fallback="true" style={{ height: 320 }} role="img" aria-label="ULTRON core loading" />,
});

const EMOTIONS: readonly EmotionId[] = ["calm", "focused", "alert", "triumphant"];
const SCENE_IDS = Object.keys(scenes) as SceneId[];

type Props = { speaking: boolean };

export default function AvatarHero({ speaking }: Props) {
  const [scene, setScene] = useState<SceneId>("palace");
  const [emotion, setEmotion] = useState<EmotionId>("calm");

  return (
    <section className="ultron-avatar-panel" aria-label="ULTRON core controls">
      <div className="ultron-avatar-heading">
        <div>
          <span className="ultron-eyebrow">ULTRON CORE</span>
          <h2>System presence</h2>
        </div>
        <span className={`ultron-core-status ${speaking ? "is-speaking" : ""}`}>
          <span aria-hidden="true" />
          {speaking ? "Speaking" : "Standby"}
        </span>
      </div>
      <AvatarScene3D scene={scene} emotion={emotion} speaking={speaking} height={320} quality="auto" />
      <div className="ultron-avatar-controls">
        <div className="ultron-control-group" role="group" aria-label="Core expression">
          <span className="ultron-control-label">Expression</span>
          {EMOTIONS.map((id) => (
            <button key={id} type="button" className={emotion === id ? "is-selected" : ""} aria-pressed={emotion === id} onClick={() => setEmotion(id)}>
              {id}
            </button>
          ))}
        </div>
        <div className="ultron-control-group" role="group" aria-label="Core environment">
          <span className="ultron-control-label">Environment</span>
          {SCENE_IDS.map((id) => (
            <button key={id} type="button" className={scene === id ? "is-selected" : ""} aria-pressed={scene === id} onClick={() => setScene(id)}>
              {scenes[id].label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
