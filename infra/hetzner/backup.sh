#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"
ENV_FILE="${SCRIPT_DIR}/.env"
DATA_DIR="/srv/ultron/.ultron-data"
BACKUP_IN_VOLUME="/tmp/ultron-sqlite-backups"
ARTIFACTS_IN_VOLUME="/tmp/ultron-artifact-backups"

: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY in /etc/ultron-backup.env}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE in /etc/ultron-backup.env}"
[[ -r "${RESTIC_PASSWORD_FILE}" ]] || { echo "Restic password file is not readable" >&2; exit 1; }
[[ -r "${ENV_FILE}" ]] || { echo "Deployment .env file is missing" >&2; exit 1; }

API_CONTAINER="$(docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps -q api)"
[[ -n "${API_CONTAINER}" ]] || { echo "Ultron API container is not running" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
cleanup() {
  docker exec "${API_CONTAINER}" rm -rf "${BACKUP_IN_VOLUME}" "${ARTIFACTS_IN_VOLUME}" >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

# Snapshot every SQLite database through SQLite's backup API. This is
# transactionally consistent even while the live databases use WAL mode.
docker exec "${API_CONTAINER}" python -c \
  'import glob, os, sqlite3; srcdir="/srv/ultron/.ultron-data"; out="/tmp/ultron-sqlite-backups"; os.makedirs(out, exist_ok=True); files=glob.glob(os.path.join(srcdir, "*.sqlite3")); assert files, "no Ultron SQLite databases found"; [(lambda src,dst: (src.backup(dst), dst.close(), src.close()))(sqlite3.connect("file:"+p+"?mode=ro", uri=True), sqlite3.connect(os.path.join(out, os.path.basename(p)))) for p in files]'

docker cp "${API_CONTAINER}:${BACKUP_IN_VOLUME}" "${TMP_DIR}/ultron-sqlite-databases"
# Generated files are durable user data too; include them alongside databases.
docker exec "${API_CONTAINER}" sh -c 'if [ -d /srv/ultron/.ultron-data/artifacts ]; then cp -a /srv/ultron/.ultron-data/artifacts /tmp/ultron-artifact-backups; fi'
if docker exec "${API_CONTAINER}" test -d "${ARTIFACTS_IN_VOLUME}"; then
  docker cp "${API_CONTAINER}:${ARTIFACTS_IN_VOLUME}" "${TMP_DIR}/ultron-artifacts"
else
  mkdir -p "${TMP_DIR}/ultron-artifacts"
fi
git -C "${SCRIPT_DIR}/../.." rev-parse HEAD > "${TMP_DIR}/deployed-commit.txt"

# Restic encrypts and authenticates every file before it reaches remote storage.
restic backup "${TMP_DIR}/ultron-sqlite-databases" "${TMP_DIR}/ultron-artifacts" "${ENV_FILE}" \
  "${TMP_DIR}/deployed-commit.txt" --tag ultron --tag production

# Keep a useful recovery window without retaining every daily snapshot forever.
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
