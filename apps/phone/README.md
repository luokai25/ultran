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
- The Android build bundles the CPU inference runtime from llama.cpp at a
  pinned upstream commit. GGUF weights are kept outside the APK in private
  app storage. The native loader uses llama.cpp's file-backed `MMAP` load mode
  and lazy tensor mode. Models larger than current free RAM enable llama.cpp's
  aggressive on-demand tensor-row reads; smaller models use automatic lazy
  reads. This lets the OS page model weights from storage instead of requiring
  the entire checkpoint to be resident in anonymous RAM. The context cache remains resident and is reduced adaptively
  (512, 1,024, or 2,048 tokens) according to available memory; prompt batches
  are capped at 64 to reduce transient memory. This is a mobile adaptation of
  the low-residency ideas studied in AirLLM, not a bundled copy of its
  Python/PyTorch/CUDA implementation. See
  [the mobile low-memory inference design](../../docs/airllm-mobile-engine.md)
  for the reverse-engineering notes, trade-offs, and next implementation
  stages. The importer and downloader accept models up to 256 GB only when
  enough device storage is available; this is a safety ceiling, not a claim
  that a phone can use every model of that size. CPU-only inference can be
  extremely slow and may still fail when an individual tensor, KV cache, or
  memory pressure exceeds device limits. Start with 1B–3B Q4 models and
  benchmark larger models gradually. The native source is fetched at build
  time from ggml-org/llama.cpp tag b12020 (commit
  0ec4027a2a0183de87c007069adddc06e665f7de). Its MIT license is included
  under android/app/src/main/assets/licenses.
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


## Proactive companion actions

- The Android companion bridge can post task notifications, open the installed SMS app with a recipient and message prefilled, and speak a short update through a foreground Android text-to-speech service.
- SMS is deliberately a handoff: Ultran shows a review dialog, opens the messaging app, and the user presses Send. The app does not request the dangerous `SEND_SMS` permission or silently send messages.
- Enable **Updates** in the composer to watch the configured backend task list while the app's JavaScript runtime is active. Completion and failure transitions create Android notifications; if spoken replies are enabled, the foreground voice service reads the update aloud.
- Android 13+ notification permission is required. If the first permission request is still pending, tap Updates again after granting it.
- Android also schedules a persistent WorkManager task monitor when Updates is enabled. It checks the configured backend at an OS-managed interval of at least 15 minutes, survives app restarts, and posts notifications for task start/retry/completion/failure transitions. Terminal updates can be spoken aloud when the Voice setting is enabled.
- Android controls the exact WorkManager execution time and may delay checks during Doze, battery saver, or network loss. This is durable periodic monitoring, not real-time surveillance or an always-on microphone. The foreground WebView poll remains faster while the app is active.
- Proactive updates are opt-in and can be switched off. Keep spoken updates short and avoid enabling them in situations where audio could expose private task details.


### Approved WhatsApp actions

Ultran prepares WhatsApp messages through an explicit handoff. The agent's tool request is reviewed in Ultran, then Android opens WhatsApp with the chosen recipient and message prepared. The user must review the recipient and content and press Send inside WhatsApp. Ultran does not inspect another app's screen or automate taps.

SMS uses the Android messaging composer, where the user also presses Send. App opening is restricted to an allow-list. The Android release does not declare or use the Accessibility API, SMS or call-log permissions, broad external-storage access, or battery-optimization exemption. Model files are imported through the system document picker, and the FileProvider exposes only Ultran's cache. Notifications are optional and requested only for task updates.

These choices reduce sensitive access and improve Play policy compatibility, but they do not guarantee Play approval. The Play listing, privacy policy, Data safety answers, foreground-service declarations, and review materials must still accurately describe the app's behavior.
