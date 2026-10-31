#!/usr/bin/env bash
set -euo pipefail

# Build a Termux bootstrap for Ultran's Android package identity and private
# runtime prefix. This deliberately uses upstream Termux build scripts rather
# than repackaging binaries compiled for com.termux.

readonly TERMUX_PACKAGES_COMMIT="3bdd137564e7f55e1d24f46406cd3e32e76bfabd"
readonly ULTRAN_PACKAGE_NAME="app.ultran.mobile"
readonly ULTRAN_ROOTFS_SUBDIR="files/ultran-runtime"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
readonly OUTPUT_DIR="${ULTRAN_BOOTSTRAP_OUTPUT_DIR:-$REPO_ROOT/dist/termux-bootstrap}"
readonly EXTRA_PACKAGES="${ULTRAN_BOOTSTRAP_PACKAGES:-git,python}"

for command_name in git python3 docker; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        exit 2
    fi
done

work_dir="$(mktemp -d)"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT
source_dir="$work_dir/termux-packages"

git init -q "$source_dir"
git -C "$source_dir" remote add origin https://github.com/termux/termux-packages.git
git -C "$source_dir" fetch --depth 1 origin "$TERMUX_PACKAGES_COMMIT"
git -C "$source_dir" checkout --detach FETCH_HEAD

python3 - "$source_dir/scripts/properties.sh" "$ULTRAN_PACKAGE_NAME" "$ULTRAN_ROOTFS_SUBDIR" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
package_name = sys.argv[2]
rootfs_subdir = sys.argv[3]
source = path.read_text()
replacements = (
    ('TERMUX_APP__PACKAGE_NAME="com.termux"', f'TERMUX_APP__PACKAGE_NAME="{package_name}"'),
    ('TERMUX__ROOTFS_SUBDIR="files"', f'TERMUX__ROOTFS_SUBDIR="{rootfs_subdir}"'),
)
for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one occurrence of {old!r}, found {count}; refusing unsafe upstream patch')
    source = source.replace(old, new, 1)
path.write_text(source)
PY

build_args=(--android10 --architectures aarch64,x86_64)
if [[ -n "$EXTRA_PACKAGES" ]]; then
    build_args+=(--add "$EXTRA_PACKAGES")
fi

(
    cd "$source_dir"
    ./scripts/run-docker.sh ./scripts/build-bootstraps.sh "${build_args[@]}"
)

mkdir -p "$OUTPUT_DIR"
for archive in bootstrap-aarch64.zip bootstrap-x86_64.zip; do
    if [[ ! -s "$source_dir/$archive" ]]; then
        echo "Upstream bootstrap build did not produce $archive" >&2
        exit 1
    fi
    cp "$source_dir/$archive" "$OUTPUT_DIR/$archive"
done

cat <<INFO
Built upstream Termux bootstrap archives for:
  Android package: $ULTRAN_PACKAGE_NAME
  Runtime root:    $ULTRAN_ROOTFS_SUBDIR
  Source commit:   $TERMUX_PACKAGES_COMMIT
  Extra packages:  ${EXTRA_PACKAGES:-none}
Output directory: $OUTPUT_DIR

These archives are build outputs, not yet bundled into the APK. Ultran's native
installer and package-manager/repository configuration must be completed before
shipping or executing the bootstrap in the app.
INFO
