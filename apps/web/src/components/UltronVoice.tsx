"use client";

/** Voice console. Browser speech remains usable when the optional API renderer is offline. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE } from "@/lib/api";

type Props = { onSpeakingChange?: (speaking: boolean) => void };
type VoiceProfile = "ultron" | "narrator" | "operator";

const PRESETS = [
  { label: "Greeting", text: "ULTRON is ready for your next objective." },
  { label: "Capabilities", text: "I can help plan, build, review, and execute approved tasks." },
  { label: "Focus", text: "Let's break the next objective into clear, testable steps." },
];

export default function UltronVoice({ onSpeakingChange }: Props) {
  const [text, setText] = useState(PRESETS[0]?.text ?? "");
  const [voice, setVoice] = useState<VoiceProfile>("ultron");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<{ ssml: string; duration_s: number; syllables: number } | null>(null);
  const speakingRef = useRef(false);

  const supported = useMemo(
    () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    [],
  );

  const setSpeaking = useCallback((value: boolean) => {
    speakingRef.current = value;
    onSpeakingChange?.(value);
  }, [onSpeakingChange]);

  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [setSpeaking]);

  const speak = useCallback(async () => {
    if (!text.trim() || busy || speakingRef.current) return;
    setBusy(true);
    setError(null);

    // Request backend SSML/viseme metadata in parallel. It is useful when the
    // service is available, but it must not block local browser speech.
    const renderTask = API_BASE ? api.speak(text, voice).then((out) => {
      setRendered({ ssml: out.ssml, duration_s: out.duration_s, syllables: out.syllables });
      return true;
    }).catch((err: unknown) => {
      setError(`Voice render service is unavailable. ${err instanceof Error ? err.message : "Using browser speech only."}`);
      return false;
    }) : Promise.resolve(false);

    if (!supported) {
      const renderedOk = await renderTask;
      if (!renderedOk) setError("Browser speech is unavailable in this browser. Configure the voice render API to enable server-side output.");
      else setError("Browser speech is unavailable; the rendered SSML is shown below.");
      setBusy(false);
      return;
    }

    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = voice === "operator" ? 1.08 : 0.95;
    utterance.pitch = voice === "ultron" ? 0.55 : voice === "narrator" ? 0.95 : 1.08;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      setError("The browser speech engine could not play this line.");
    };
    setSpeaking(true);
    synth.speak(utterance);
    setBusy(false);
    void renderTask;
  }, [busy, setSpeaking, supported, text, voice]);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setBusy(false);
  }, [setSpeaking]);

  return (
    <section className="ultron-panel ultron-voice-console" aria-label="ULTRON voice console">
      <div className="ultron-voice-heading">
        <div><span className="ultron-eyebrow">VOICE OUTPUT</span><h3>Speak with ULTRON</h3></div>
        <span className={`ultron-core-status ${speakingRef.current ? "is-speaking" : ""}`}><span aria-hidden="true" />{busy ? "Preparing" : speakingRef.current ? "Speaking" : "Standby"}</span>
      </div>
      {error && <div className="ultron-error" role="status">{error}</div>}
      <div className="ultron-field">
        <label htmlFor="voice-line">Text to speak</label>
        <textarea id="voice-line" className="ultron-textarea" value={text} maxLength={1200} onChange={(event) => setText(event.target.value)} />
        <span className="ultron-field-hint">{text.length}/1200 characters. Audio playback uses the browser&apos;s speech engine.</span>
      </div>
      <div className="ultron-voice-options">
        <div className="ultron-field">
          <label htmlFor="voice-profile">Voice profile</label>
          <select id="voice-profile" className="ultron-select" value={voice} onChange={(event) => setVoice(event.target.value as VoiceProfile)}>
            <option value="ultron">ULTRON · low pitch</option>
            <option value="narrator">Narrator · neutral</option>
            <option value="operator">Operator · brisk</option>
          </select>
        </div>
        <div className="ultron-preset-group" role="group" aria-label="Voice presets">
          <span className="ultron-control-label">Quick lines</span>
          {PRESETS.map((preset) => <button key={preset.label} type="button" className="ultron-btn ultron-btn--ghost" onClick={() => setText(preset.text)}>{preset.label}</button>)}
        </div>
      </div>
      <div className="ultron-row ultron-voice-actions">
        <button className="ultron-btn" type="button" onClick={() => void speak()} disabled={busy || !text.trim() || speakingRef.current}>{busy ? "Preparing…" : "Speak line"}</button>
        <button className="ultron-btn ultron-btn--ghost" type="button" onClick={stop}>Stop</button>
      </div>
      {rendered && <div className="ultron-voice-rendered">
        <div className="ultron-mono">Rendered metadata · {rendered.syllables} syllables · {rendered.duration_s}s</div>
        <pre className="ultron-pre">{rendered.ssml}</pre>
      </div>}
    </section>
  );
}
