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
├── index.html            # the shell: top bar, avatar stage, voice console
├── src/main.ts           # three.js avatar + on-device speech
├── src/styles.css        # the golden-black design system
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
- Speech uses the on-device Web Speech API. Nothing is sent anywhere; if the
  engine is missing the jaw still animates so the line reads as delivered.
- The avatar is disposed with the page; no WebGL context survives a reload.
