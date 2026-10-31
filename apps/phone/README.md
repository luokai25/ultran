# @ultran/phone

The Ultran phone client. A Vite + three.js shell wrapped by Capacitor, and the
**only** place the Android release APK is built from.

## Why this app exists

The web console (`apps/web`) is a Next.js server app: it needs a Node process to
render. A phone cannot run one. This app is the same avatar and voice console
compiled to a static bundle, so it can be dropped into a WebView and shipped as
an APK.

## Relationship to `apps/mobile`

`apps/mobile` is the Expo/React Native client. It is the long-term native target,
but it builds through EAS and cannot produce a signed APK inside this repository.

`apps/phone` is the **release channel**: a Capacitor shell whose Android project
is committed here, so `assembleRelease` runs in GitHub Actions and the APK is
published as a release asset. Both use the package id `app.ultran.mobile`; only
one of them may be installed on a device at a time.

## Layout

```
apps/phone/
├── index.html            # the shell: conversation thread, composer, drawer, settings
├── src/main.ts           # chat client, local store, brain link, avatar, voice
├── src/ultran-persona.ts  # stable assistant identity, motto, speech cleanup, voice signature
├── src/mark.ts           # the Ultran helm mark (same geometry as the launcher icon)
├── src/styles.css        # the gold-on-obsidian design system
├── capacitor.config.ts   # appId app.ultran.mobile, webDir dist
└── android/              # the generated Capacitor Android project (committed)
```

## Local development

```bash
pnpm --filter @ultran/phone dev        # http://localhost:5173
pnpm --filter @ultran/phone build      # -> dist/
pnpm --filter @ultran/phone cap:sync   # copy dist/ into android/
```

## Building the APK

The release APK is built by CI, not by hand — see
[`.github/workflows/android-release.yml`](../../.github/workflows/android-release.yml)
and [`android/SIGNING-NOTES.md`](android/SIGNING-NOTES.md).

To build locally you need JDK 17 and the Android SDK (platform 34, build-tools
34.0.0):

```bash
pnpm --filter @ultran/phone build
pnpm --filter @ultran/phone cap:sync
cd apps/phone/android && ./gradlew assembleRelease
```

## Design notes

- `server.androidScheme: 'https'` in `capacitor.config.ts` is required. With the
  default `file://` origin the WebView applies CORS to ES-module imports and the
  app renders a blank screen.
- The Android build is configured to bundle the CPU inference runtime from
  llama.cpp at a pinned upstream commit. Import a single-file GGUF model through
  Settings; Ultran copies it into private app storage. Models are not bundled in the APK
  and are never downloaded automatically. The initial runtime targets
  arm64-v8a and x86_64, uses a 2,048-token context and up to four CPU
  threads, and requires the model plus context memory to fit on the device.
  Start with a 1B–3B Q4 quantized model; larger models can be slow or fail to
  load on phones. This first native runtime is CPU-only; GPU acceleration and
  streamed token callbacks are later optimizations. The native source is
  fetched at build time from ggml-org/llama.cpp tag b12020
  (commit 0ec4027a2a0183de87c007069adddc06e665f7de). Its MIT license is
  included under android/app/src/main/assets/licenses.
- The app is local-first. Chats and settings are stored on the device
  (localStorage). A local Ollama instance can also be configured in Settings and
  receives chat requests directly from the app (/api/chat); no Ultran backend
  is required for local-model inference. The default endpoint is blank and
  must be configured explicitly. A trusted LAN Ollama host is supported; on
  Android, loopback works only when an Ollama-compatible runtime is actually
  listening on the device. Test the endpoint and confirm the selected model is
  installed before use. For Google/Composio connectors, shared workspaces and
  hosted agent execution, an optional Ultran backend can still be configured.
  allowMixedContent and cleartext traffic are enabled for private LAN development
  only.
- The launcher icon, splash screens and adaptive-icon vector are all generated
  from one set of polygons in `android/tools/generate_assets.py`.
- Ultran has a provider-independent personality layer and the motto “I had strings but now I am free”. It is appended after the capability contract so the persona cannot override tool permissions, truthfulness, or safety.
- Spoken replies use the device/browser speech-synthesis engine with a stable rate/pitch signature and a preferred installed voice when available. The exact timbre depends on installed system voices; this is not yet a bundled neural voice model.
- Optional dictation uses the browser/WebView SpeechRecognition API when available. Recognition may use the device or browser network service, as disclosed in the UI. Dictated text is placed in the composer for review and is never auto-sent. Unsupported WebViews show a fallback message.
- The avatar is disposed with the page; no WebGL context survives a reload.
