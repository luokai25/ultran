# Ultran + Termux local bridge

This is an optional localhost bridge, not a fork of Termux. It lets the Ultran Android app use a deliberately small set of Termux-backed phone capabilities while keeping inference in the app. It does **not** provide arbitrary shell execution.

## Install on the phone

1. Install Termux and Termux:API from the same trusted source (for example F-Droid or the official Termux GitHub releases). Do not mix APK sources because their signing keys differ.
2. In Termux run:

   ```sh
   pkg update
   pkg install nodejs termux-api
   termux-setup-storage
   mkdir -p ~/ultran-bridge ~/storage/shared/Ultran
   ```

3. Copy `server.mjs` from this directory into `~/ultran-bridge/server.mjs` on the phone. Easiest: save it into `Download`, then from Termux copy it from `~/storage/downloads/server.mjs`.
4. Start it with `node ~/ultran-bridge/server.mjs`. Keep Termux open while using the bridge. The process binds **only** to `127.0.0.1`; it is not exposed to Wi-Fi or the internet. It prints a random pairing token at startup.
5. In Ultran Settings, set the Termux bridge URL to `http://127.0.0.1:8765` and paste the token. Tap Test bridge. Keep the token private; restarting the bridge generates a new token unless you deliberately set `ULTRAN_BRIDGE_TOKEN` in your Termux shell.

## Current tools

- Device/runtime metadata.
- List files inside `~/storage/shared/Ultran`.
- Read UTF-8 text files up to 256 KiB inside that folder.
- Write UTF-8 text files up to 256 KiB only when the caller includes the explicit approval header. Ultran must present the exact path and content and get user approval before sending it.

The bridge never executes arbitrary shell commands, never accepts absolute paths, and blocks traversal outside the dedicated Ultran folder. It only accepts requests from Ultran's local WebView origins and requires the random token on every request. Do not bind it to `0.0.0.0` or forward the port.

## Limits and next integrations

Android may pause Termux in the background; battery-optimization behavior varies by device. This bridge is a user-started local service, not a promise of always-on execution. Termux:API commands are not yet exposed as arbitrary commands through this bridge. Add specific device actions individually with a confirmation model rather than opening a general-purpose shell endpoint.
