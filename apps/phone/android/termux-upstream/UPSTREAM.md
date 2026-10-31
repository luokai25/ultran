# Vendored Termux terminal libraries

Source cloned from https://github.com/termux/termux-app at commit `8629e632fcb95da272221be327db653fb24befe` on 2026-10-31. The `terminal-emulator` and `terminal-view` modules are included from that exact source revision and wired as Android library modules in Ultran.

The upstream repository states that its terminal libraries use code from Android-Terminal-Emulator under Apache License 2.0; see `TERMUX-APP-LICENSE.md` and upstream notices. This is a source-vendoring step, not a claim that Termux's package bootstrap or all Termux packages are installed. The first integrated shell uses Android `/system/bin/sh`; adapting the Termux bootstrap and packages for Ultran's package identity and private paths remains required next work.

Upstream: https://github.com/termux/termux-app

## Package environment integration findings

The companion `termux/termux-packages` repository was inspected at commit `3bdd137564e7f55e1d24f46406cd3e32e76bfabd`. Its bootstrap build scripts parameterize `TERMUX_PREFIX`, but the default is Termux's `/data/data/com.termux/files/usr`; numerous package recipes and generated binaries/configurations assume that prefix. Ultran must build a dedicated bootstrap for its own private app path and audit/rebuild package recipes rather than unpacking the official Termux bootstrap unchanged. The package source repository is tracked separately upstream and is intentionally not copied wholesale into the Android APK repository.
