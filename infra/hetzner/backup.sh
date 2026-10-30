#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"
ENV_FILE="${SCRIPT_DIR}/.env"
DATA_DIR="/srv/ultran/.ultran-data"
BACKUP_IN_VOLUME="${DATA_DIR}/credentials-backup.sqlite3"

: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY in /etc/ultran-backup.env}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE in /etc/ultran-backup.env}"
[[ -r "${RESTIC_PASSWORD_FILE}" ]] || { echo "Restic password file is not readable" >&2; exit 1; }
[[ -r "${ENV_FILE}" ]] || { echo "Deployment .env file is missing" >&2; exit 1; }

API_CONTAINER="$(docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps -q api)"
[[ -n "${API_CONTAINER}" ]] || { echo "Ultran API container is not running" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
cleanup() {
  docker exec "${API_CONTAINER}" rm -f "${BACKUP_IN_VOLUME}" >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

# SQLite's backup API creates a transactionally consistent snapshot even when
# the live database is in WAL mode.
docker exec "${API_CONTAINER}" python -c \
  'import sqlite3; src=sqlite3.connect("/srv/ultran/.ultran-data/credentials.sqlite3"); dst=sqlite3.connect("/srv/ultran/.ultran-data/credentials-backup.sqlite3"); src.backup(dst); dst.close(); src.close()'

docker cp "${API_CONTAINER}:${BACKUP_IN_VOLUME}" "${TMP_DIR}/credentials.sqlite3"
git -C "${SCRIPT_DIR}/../.." rev-parse HEAD > "${TMP_DIR}/deployed-commit.txt"

# Restic encrypts and authenticates every file before it reaches remote storage.
restic backup "${TMP_DIR}/credentials.sqlite3" "${ENV_FILE}" \
  "${TMP_DIR}/deployed-commit.txt" --tag ultran --tag production

# Keep a useful recovery window without retaining every daily snapshot forever.
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
