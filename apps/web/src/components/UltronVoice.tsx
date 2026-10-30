"use client";

/**
 * UltronVoice - the avatar's voice console.
 *
 * Text is sent to the backend voice service, which returns SSML plus a viseme
 * timeline. Playback prefers the on-device Web Speech API (nothing leaves the
 * machine); if that is unavailable the SSML and timeline are shown so the line
 * is still inspectable. The component reports speaking state upward so the 3D
 * jaw can animate in sync.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

type Props = {
  onSpeakingChange?: (speaking: boolean) => void;
};

const PRESETS = [
  "Ultran online. All systems nominal.",
  "Nine connectors armed. Awaiting your objective.",
  "Deployment published. Rollback point secured.",
];

export default function UltronVoice({ onSpeakingChange }: Props) {
  const [text, setText] = useState(PRESETS[0] ?? "");
  const [voice, setVoice] = useState<"ultron" | "narrator" | "operator">("ultron");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<{ ssml: string; duration_s: number; syllables: number } | null>(null);
  const speakingRef = useRef(false);

  const supported = useMemo(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    [],
  );

  const setSpeaking = useCallback(
    (value: boolean) => {
      speakingRef.current = value;
      onSpeakingChange?.(value);
    },
    [onSpeakingChange],
  );

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      setSpeaking(false);
    };
  }, [setSpeaking]);

  const speak = useCallback(async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.speak(text, voice);
      setRendered({ ssml: out.ssml, duration_s: out.duration_s, syllables: out.syllables });

      if (!supported) {
        setError("On-device speech is unavailable in this browser; the SSML was rendered instead.");
        return;
      }
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = voice === "operator" ? 1.08 : 0.95;
      utter.pitch = voice === "ultron" ? 0.4 : 1;
      utter.onstart = () => setSpeaking(true);
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      synth.speak(utter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "voice render failed");
    } finally {
      setBusy(false);
    }
  }, [busy, setSpeaking, supported, text, voice]);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [setSpeaking]);

  return (
    <div className="ultran-panel">
      <div className="ultran-eyebrow">Voice</div>
      <h3 style={{ margin: "0 0 14px", fontSize: 16, color: "var(--ink)" }}>Ultron voice</h3>

      {error && <div className="ultran-error">{error}</div>}

      <div className="ultran-field">
        <label htmlFor="voice-line">Line</label>
        <textarea
          id="voice-line"
          className="ultran-textarea"
          style={{ minHeight: 92 }}
          value={text}
          maxLength={1200}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="ultran-field">
        <label htmlFor="voice-profile">Profile</label>
        <select
          id="voice-profile"
          className="ultran-select"
          value={voice}
          onChange={(e) => setVoice(e.target.value as typeof voice)}
        >
          <option value="ultron">ultron - synthetic baritone</option>
          <option value="narrator">narrator - warm neutral</option>
          <option value="operator">operator - clipped alto</option>
        </select>
      </div>

      <div className="ultran-row">
        <button className="ultran-btn" onClick={speak} disabled={busy || !text.trim()}>
          {busy ? "Rendering" : "Speak"}
        </button>
        <button className="ultran-btn ultran-btn--ghost" onClick={stop}>
          Stop
        </button>
        {PRESETS.map((preset) => (
          <button
            key={preset}
            className="ultran-btn ultran-btn--ghost"
            onClick={() => setText(preset)}
            title={preset}
          >
            Preset
          </button>
        ))}
      </div>

      {rendered && (
        <div style={{ marginTop: 18 }}>
          <div className="ultran-mono" style={{ marginBottom: 8 }}>
            {rendered.syllables} syllables / {rendered.duration_s}s
          </div>
          <pre className="ultran-pre">{rendered.ssml}</pre>
        </div>
      )}
    </div>
  );
}
