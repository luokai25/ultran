#!/usr/bin/env bash
set -euo pipefail

GSTACK_DIR="${GSTACK_DIR:-$HOME/.local/share/gstack}"
GSTACK_REF="${GSTACK_REF:-main}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to install gstack." >&2
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun v1.4.2 or newer is required. Install it from https://bun.sh/ and rerun this script." >&2
  exit 1
fi

BUN_VERSION="$(bun --version | sed 's/[^0-9.].*$//')"
IFS=. read -r BUN_MAJOR BUN_MINOR BUN_PATCH <<< "$BUN_VERSION"
BUN_MAJOR="${BUN_MAJOR:-0}"
BUN_MINOR="${BUN_MINOR:-0}"
BUN_PATCH="${BUN_PATCH:-0}"
if (( BUN_MAJOR < 1 || (BUN_MAJOR == 1 && BUN_MINOR < 4) || (BUN_MAJOR == 1 && BUN_MINOR == 4 && BUN_PATCH < 2) )); then
  echo "Bun $BUN_VERSION is too old; gstack requires Bun v1.4.2 or newer." >&2
  exit 1
fi

if [[ -d "$GSTACK_DIR/.git" ]]; then
  if [[ -n "$(git -C "$GSTACK_DIR" status --porcelain)" ]]; then
    echo "Refusing to update a modified gstack checkout at $GSTACK_DIR." >&2
    echo "Commit or stash its changes, or set GSTACK_DIR to a clean directory." >&2
    exit 1
  fi
  git -C "$GSTACK_DIR" fetch --depth=1 origin "$GSTACK_REF"
  if [[ "$GSTACK_REF" == "main" ]]; then
    git -C "$GSTACK_DIR" checkout main
    git -C "$GSTACK_DIR" merge --ff-only FETCH_HEAD
  else
    git -C "$GSTACK_DIR" checkout --detach FETCH_HEAD
  fi
elif [[ -e "$GSTACK_DIR" ]]; then
  echo "$GSTACK_DIR exists but is not a Git checkout. Set GSTACK_DIR to another path." >&2
  exit 1
else
  mkdir -p "$(dirname "$GSTACK_DIR")"
  git clone --depth=1 --single-branch --branch "$GSTACK_REF" https://github.com/garrytan/gstack.git "$GSTACK_DIR"
fi

"$GSTACK_DIR/setup" --host codex
"$GSTACK_DIR/setup" --status
"$GSTACK_DIR/bin/gstack-doctor"
