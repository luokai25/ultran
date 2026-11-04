/** ULTRON's independent voice runtime contract. Models are downloaded separately from the APK. */
export const ULTRON_VOICE_RUNTIME_VERSION = "1.0.0" as const;

export type VoiceEngineKind = "sherpa_onnx_local" | "android_offline_tts" | "web_speech" | "none";
export type VoiceModelFamily = "kokoro" | "piper_vits" | "vits" | "matcha" | "zipvoice" | "pocket";
export type VoiceRuntimeState = "not_installed" | "downloading" | "ready" | "loading" | "error";
export type VoiceModelManifest = {
  id: string;
  family: VoiceModelFamily;
  language: string;
  voiceLabel: string;
  modelFiles: readonly string[];
  approximateBytes: number;
  license: string;
  source: string;
  sha256: Readonly<Record<string, string>>;
  recommendedThreads: number;
  minRamBytes: number;
  notes: string;
};

/**
 * Candidate models are metadata only until their exact upstream artifact and digest are pinned.
 * Do not silently download or bundle multi-hundred-MB model files.
 */
export const VOICE_MODEL_CANDIDATES: readonly VoiceModelManifest[] = [
  {
    id: "ultron-kokoro-en-v1",
    family: "kokoro",
    language: "en",
    voiceLabel: "Original low-register English voice (speaker selection pending audition)",
    modelFiles: ["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data"],
    approximateBytes: 100_000_000,
    license: "Must be verified for the exact selected model and voice before distribution",
    source: "https://github.com/k2-fsa/sherpa-onnx",
    sha256: {},
    recommendedThreads: 2,
    minRamBytes: 1_500_000_000,
    notes: "Candidate only. Audition multiple licensed voices; do not infer a voice identity from the model family name.",
  },
  {
    id: "ultron-piper-en-v1",
    family: "piper_vits",
    language: "en",
    voiceLabel: "Original low-register English voice (speaker selection pending audition)",
    modelFiles: ["model.onnx", "model.onnx.json"],
    approximateBytes: 30_000_000,
    license: "Must be verified for the exact selected model and voice before distribution",
    source: "https://github.com/k2-fsa/sherpa-onnx",
    sha256: {},
    recommendedThreads: 2,
    minRamBytes: 900_000_000,
    notes: "Smaller CPU-oriented candidate. Final choice depends on intelligibility, latency, language and voice licence.",
  },
] as const;

export const ULTRON_AUDIO_PROCESSING = {
  sampleFormat: "float32-mono",
  targetSampleRate: 24000,
  highPassHz: 80,
  presenceEq: { frequencyHz: 3200, gainDb: 2.2, q: 0.85 },
  pitchShiftSemitones: -1.25,
  combDelayMs: 15,
  combFeedback: 0.15,
  compressor: { thresholdDb: -20, ratio: 4, attackMs: 8, releaseMs: 110, makeupGainDb: 1.5 },
  limiterCeilingDb: -1.5,
  normalizePeakDb: -3,
} as const;

export type VoiceRuntimeSnapshot = {
  engine: VoiceEngineKind;
  state: VoiceRuntimeState;
  modelId?: string;
  offline: boolean;
  lastError?: string;
};

export function describeVoiceRuntime(snapshot: VoiceRuntimeSnapshot): string {
  if (snapshot.state === "ready" && snapshot.engine === "sherpa_onnx_local" && snapshot.modelId) {
    return `Local neural voice ready: ${snapshot.modelId}. Offline synthesis enabled.`;
  }
  if (snapshot.engine === "android_offline_tts" && snapshot.state === "ready") {
    return "Device offline TTS is available. ULTRON neural voice model is not installed.";
  }
  if (snapshot.engine === "web_speech" && snapshot.state === "ready") {
    return "Browser speech synthesis is available. Network use depends on the installed speech service.";
  }
  if (snapshot.state === "downloading") return "Downloading the selected local voice model.";
  if (snapshot.state === "loading") return "Loading the local voice model into memory.";
  if (snapshot.state === "error") return `Voice engine error: ${(snapshot.lastError ?? "unknown error").slice(0, 180)}`;
  return "No ULTRON neural voice model is installed. Device speech may be used as a clearly labelled fallback.";
}

/** VAD is strictly opt-in and only active during an explicit user-started microphone session. */
export function mayRunVoiceActivityDetection(input: { microphoneSessionStartedByUser: boolean; microphonePermissionGranted: boolean; quietMode: boolean }): boolean {
  return input.microphoneSessionStartedByUser && input.microphonePermissionGranted && !input.quietMode;
}

/** Voice updates must be short telemetry, not a spoken copy of the chat transcript. */
export function prepareTelemetrySpeech(text: string, maxCharacters = 420): string {
  return text
    .replace(/```[\s\S]*?```/g, " code omitted. ")
    .replace(/https?:\/\/\S+/g, "link omitted")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(80, Math.min(700, maxCharacters)));
}
