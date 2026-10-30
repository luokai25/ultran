# Android release signing

The release APK is signed with a keystore that **never enters this repository**.
A key that travels with the source can sign updates Android will install over
yours, so it is treated as a production secret.

## Where the key lives

| Environment | Location |
| --- | --- |
| GitHub Actions | Repository secrets (see below) |
| Local machine | `apps/phone/android/app-release.keystore` + `keystore.properties` (both git-ignored) |

## Repository secrets

| Secret | Contents |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 app-release.keystore` |
| `KEYSTORE_PASSWORD` | the store password |
| `KEY_ALIAS` | `ultran` |
| `KEY_PASSWORD` | the key password |

Set them with the GitHub CLI:

```bash
base64 -w0 app-release.keystore | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set KEYSTORE_PASSWORD
gh secret set KEY_ALIAS --body ultran
gh secret set KEY_PASSWORD
```

## How Gradle resolves the key

`app/build.gradle` reads, in order:

1. `-PkeystorePath` / `-PkeystorePassword` / `-PkeyAlias` / `-PkeyPassword`
2. `APP_KEYSTORE_PATH` / `APP_KEYSTORE_PASSWORD` / `APP_KEY_ALIAS` / `APP_KEY_PASSWORD`
3. `android/keystore.properties`

The path is resolved against the **Android project directory** (`rootProject`),
not `app/`. Resolving it against `app/` silently looks for
`android/app/app-release.keystore`, finds nothing, and skips signing without an
error — which is how an unsigned "release" APK ships.

If no keystore is found the build still succeeds and produces an **unsigned**
APK, so forks and pull requests can build and inspect the artifact.

## Local release build

```bash
cp keystore.properties.example keystore.properties   # fill in the real values
cd apps/phone
pnpm build && pnpm cap:sync
cd android && ./gradlew assembleRelease
```

## Verifying a build

```bash
BT=$ANDROID_HOME/build-tools/34.0.0
$BT/apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
$BT/aapt2 dump badging app/build/outputs/apk/release/app-release.apk | head -20
```

`apksigner` is a shell wrapper that resolves `java` itself — export `JAVA_HOME`
in the same command block or it exits non-zero and reads like "not signed".

## Rotating the key

A new key means a new signing identity: existing installs cannot be updated in
place. Bump `versionCode`, publish under a new release tag, and tell users to
uninstall before installing.
