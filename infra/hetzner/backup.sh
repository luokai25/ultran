#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"
ENV_FILE="${SCRIPT_DIR}/.env"
DATA_DIR="/srv/ultran/.ultran-data"
BACKUP_IN_VOLUME="/tmp/ultran-sqlite-backups"

: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY in /etc/ultran-backup.env}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE in /etc/ultran-backup.env}"
[[ -r "${RESTIC_PASSWORD_FILE}" ]] || { echo "Restic password file is not readable" >&2; exit 1; }
[[ -r "${ENV_FILE}" ]] || { echo "Deployment .env file is missing" >&2; exit 1; }

API_CONTAINER="$(docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps -q api)"
[[ -n "${API_CONTAINER}" ]] || { echo "Ultran API container is not running" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
cleanup() {
  docker exec "${API_CONTAINER}" rm -rf "${BACKUP_IN_VOLUME}" >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

# Snapshot every SQLite database through SQLite's backup API. This is
# transactionally consistent even while the live databases use WAL mode.
docker exec "${API_CONTAINER}" python -c \
  'import glob, os, sqlite3; srcdir="/srv/ultran/.ultran-data"; out="/tmp/ultran-sqlite-backups"; os.makedirs(out, exist_ok=True); files=glob.glob(os.path.join(srcdir, "*.sqlite3")); assert files, "no Ultran SQLite databases found"; [(lambda src,dst: (src.backup(dst), dst.close(), src.close()))(sqlite3.connect("file:"+p+"?mode=ro", uri=True), sqlite3.connect(os.path.join(out, os.path.basename(p)))) for p in files]'

docker cp "${API_CONTAINER}:${BACKUP_IN_VOLUME}" "${TMP_DIR}/ultran-sqlite-databases"
git -C "${SCRIPT_DIR}/../.." rev-parse HEAD > "${TMP_DIR}/deployed-commit.txt"

# Restic encrypts and authenticates every file before it reaches remote storage.
restic backup "${TMP_DIR}/ultran-sqlite-databases" "${ENV_FILE}" \
  "${TMP_DIR}/deployed-commit.txt" --tag ultran --tag production

# Keep a useful recovery window without retaining every daily snapshot forever.
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
