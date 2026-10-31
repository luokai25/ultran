# Vendored Termux terminal libraries

Source cloned from https://github.com/termux/termux-app at commit `8629e632fcb95da272221be327db653fb24befe` on 2026-10-31. The `terminal-emulator` and `terminal-view` modules are included from that exact source revision and wired as Android library modules in Ultran.

The upstream repository states that its terminal libraries use code from Android-Terminal-Emulator under Apache License 2.0; see `TERMUX-APP-LICENSE.md` and upstream notices. This is a source-vendoring step, not a claim that Termux's package bootstrap or all Termux packages are installed. The first integrated shell uses Android `/system/bin/sh`; adapting the Termux bootstrap and packages for Ultran's package identity and private paths remains required next work.

Upstream: https://github.com/termux/termux-app

## Package environment integration findings

The companion `termux/termux-packages` repository was inspected at commit `3bdd137564e7f55e1d24f46406cd3e32e76bfabd`. Its bootstrap build scripts parameterize `TERMUX_PREFIX`, but the default is Termux's `/data/data/com.termux/files/usr`; numerous package recipes and generated binaries/configurations assume that prefix. Ultran must build a dedicated bootstrap for its own private app path and audit/rebuild package recipes rather than unpacking the official Termux bootstrap unchanged. The package source repository is tracked separately upstream and is intentionally not copied wholesale into the Android APK repository.


## Ultran compatibility patch

`TerminalBitmap.java` uses numeric API level `35` rather than `Build.VERSION_CODES.VANILLA_ICE_CREAM`, preserving the upstream behavior while allowing the current Android build to compile against SDK 34. No runtime behavior changes for supported API levels.

The native terminal now pre-creates `ultran-runtime/usr`, `home`, and `tmp` under Ultran private app data and exports Termux-compatible `PREFIX`, `TERMUX_PREFIX`, `TERMUX__PREFIX`, `TERMUX__ROOTFS`, `HOME`, `TMPDIR`, `PATH`, and `LD_LIBRARY_PATH` values. This prepares the exact install layout for a future Ultran-specific bootstrap; it does not claim that packages have been installed yet.

## Building an Ultran-specific Termux bootstrap

`build-ultran-bootstrap.sh` clones the pinned official `termux/termux-packages` source, applies a guarded two-line configuration patch for Android package `app.ultran.mobile` and rootfs `files/ultran-runtime`, then invokes the upstream Docker bootstrap builder for `aarch64` and `x86_64`. It defaults to including `git` and `python`; set `ULTRAN_BOOTSTRAP_PACKAGES` to a comma-separated package list to change that, and `ULTRAN_BOOTSTRAP_OUTPUT_DIR` to change the output directory. Docker is required.

This is intentionally a separate, manual build step because rebuilding Termux packages for a new prefix is expensive and must not silently run on every APK release. Ultran now has a native ZIP installer that validates paths, limits compressed/uncompressed size and entry counts, recreates the upstream symlink manifest, stages extraction, and swaps the runtime into place. Select a generated archive from Settings → Install Termux runtime ZIP. The archive is not bundled in the APK yet because building it requires Docker and the current development box does not provide Docker.

The installer disables the upstream Termux APT sources because those repositories publish packages compiled for Termux's own private prefix. Until an Ultran-specific package repository is built, the bootstrap can run the tools included in the archive (currently `git` and `python` by default), but `apt install` of additional upstream packages is intentionally not enabled.
