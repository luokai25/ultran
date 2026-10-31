# Termux upstream integration for Ultran's headless runtime

Ultran's product target is the Termux execution environment, not a terminal emulator UI. The upstream `terminal-emulator` and `terminal-view` source snapshots are retained in this repository for provenance and licensing review, but they are no longer compiled, registered, or exposed as an app screen. The native runtime manager invokes the private Termux-compatible prefix directly, with no separate Termux app required after the runtime is installed.

The vendored terminal libraries originate from https://github.com/termux/termux-app at commit `8629e632fcb95da272221be327db653fb24befe`. Their upstream notices and license are retained for compliance. They are not dependencies of the Ultran APK.

Upstream: https://github.com/termux/termux-app

## Package environment integration findings

The companion `termux/termux-packages` repository was inspected at commit `3bdd137564e7f55e1d24f46406cd3e32e76bfabd`. Its bootstrap build scripts parameterize `TERMUX_PREFIX`, but the default is Termux's `/data/data/com.termux/files/usr`; numerous package recipes and generated binaries/configurations assume that prefix. Ultran must build a dedicated bootstrap for its own private app path and audit/rebuild package recipes rather than unpacking the official Termux bootstrap unchanged. The package source repository is tracked separately upstream and is intentionally not copied wholesale into the Android APK repository.


## Ultran compatibility patch

`TerminalBitmap.java` uses numeric API level `35` rather than `Build.VERSION_CODES.VANILLA_ICE_CREAM`, preserving the upstream behavior while allowing the current Android build to compile against SDK 34. No runtime behavior changes for supported API levels.

The native runtime manager pre-creates `ultran-runtime/usr`, `home`, and `tmp` under Ultran private app data and exports Termux-compatible `PREFIX`, `TERMUX_PREFIX`, `TERMUX__PREFIX`, `TERMUX__ROOTFS`, `HOME`, `TMPDIR`, `PATH`, and `LD_LIBRARY_PATH` values. This prepares the exact install layout for a future Ultran-specific bootstrap; it does not claim that packages have been installed yet.

## Building an Ultran-specific Termux bootstrap

`build-ultran-bootstrap.sh` clones the pinned official `termux/termux-packages` source, applies a guarded two-line configuration patch for Android package `app.ultran.mobile` and rootfs `files/ultran-runtime`, then invokes the upstream Docker bootstrap builder for `aarch64` and `x86_64`. It defaults to including `git` and `python`; set `ULTRAN_BOOTSTRAP_PACKAGES` to a comma-separated package list to change that, and `ULTRAN_BOOTSTRAP_OUTPUT_DIR` to change the output directory. Docker is required.

This is intentionally a separate build step because rebuilding Termux packages for a new prefix is expensive and should not silently run on every APK release. Ultran has a native ZIP installer that validates paths, limits compressed/uncompressed size and entry counts, recreates the upstream symlink manifest, stages extraction, and swaps the runtime into place. Android Settings now includes **Download & install runtime**, which fetches the matching public release asset, checks it against `SHA256SUMS`, and then invokes the same installer. **Choose runtime ZIP** remains as a manual fallback. The archive is not bundled in the APK, keeping normal Android release builds smaller.

The installer disables the upstream Termux APT sources because those repositories publish packages compiled for Termux's own private prefix. Until an Ultran-specific package repository is built, the bootstrap can run the tools included in the archive (currently `git` and `python` by default), but `apt install` of additional upstream packages is intentionally not enabled.

The `Build Ultran Termux Bootstrap` GitHub Actions workflow runs this builder on a GitHub-hosted runner with Docker and publishes the two architecture archives plus SHA-256 checksums as a 30-day artifact and updates the public prerelease assets used by the in-app downloader.


## Local agent command tool

The on-device llama.cpp chat path and configured local Ollama-compatible model path can request the local `runtime.exec` tool per user turn using the internal `ULTRAN_TOOL_CALL:` JSON protocol. Ultran opens a native Android approval dialog showing the exact command before execution. Cancel means no job is queued. Approved commands are enqueued as WorkManager jobs and run without root through the installed Termux Bash login shell in Ultran's private `files/ultran-runtime/home`; commands are refused until the verified Termux bootstrap is installed (there is no Android system-shell fallback). Each run is capped at four minutes and 6 KiB of captured output. Job IDs, recent-job listing, status, and cancellation are exposed to the local agent. A durable per-job claim prevents WorkManager process-death retries from automatically replaying a command with side effects. Completion notifications are posted when Android permits them. WorkManager is OS-scheduled and may defer or stop work under battery, quota, or force-stop conditions; this is not an always-on daemon. The model is told to treat process output as untrusted data. This capability is local to the Android client; it is not exposed to remote backend agents because the backend cannot directly access the phone's private runtime.

## Remaining integration gaps

The headless runtime and bounded background job supervisor are implemented, but this is not yet the entire Termux distribution. The bootstrap includes Termux's base environment plus the packages selected at build time (currently `git` and `python`). APT repository sources are deliberately disabled because upstream packages are compiled for Termux's own prefix and must not be installed into Ultran's different private prefix. Building and signing an Ultran-compatible package repository, expanding the selected package set, and adding integration tests on real ARM64 devices remain outstanding. WorkManager jobs run without a terminal UI and survive normal navigation, but Android controls scheduling and can defer or stop work under battery restrictions, force-stop, or OS resource pressure. Each approved command is bounded to four minutes and 6 KiB of captured output; this is not an always-on daemon or a promise that arbitrary long-running processes will stay alive.

