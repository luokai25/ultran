#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"
ENV_FILE="${SCRIPT_DIR}/.env"

[[ -r "${ENV_FILE}" ]] || { echo "FAIL: deployment .env is missing"; exit 1; }
DOMAIN="$(awk -F= '$1 == "ULTRAN_DOMAIN" { sub(/^[^=]*=/, ""); print; exit }' "${ENV_FILE}")"
[[ -n "${DOMAIN}" ]] || { echo "FAIL: ULTRAN_DOMAIN is not configured"; exit 1; }

API_CONTAINER="$(docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps -q api)"
CADDY_CONTAINER="$(docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps -q caddy)"
[[ -n "${API_CONTAINER}" ]] || { echo "FAIL: API container is missing"; exit 1; }
[[ -n "${CADDY_CONTAINER}" ]] || { echo "FAIL: Caddy container is missing"; exit 1; }

API_HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${API_CONTAINER}")"
[[ "${API_HEALTH}" == "healthy" ]] || { echo "FAIL: API container health is ${API_HEALTH}"; exit 1; }

CADDY_STATE="$(docker inspect --format '{{.State.Status}}' "${CADDY_CONTAINER}")"
[[ "${CADDY_STATE}" == "running" ]] || { echo "FAIL: Caddy state is ${CADDY_STATE}"; exit 1; }

HTTP_CODE="$(curl --silent --show-error --output /dev/null --max-time 10 --write-out '%{http_code}' "https://${DOMAIN}/v1/health")"
[[ "${HTTP_CODE}" == "200" ]] || { echo "FAIL: HTTPS health endpoint returned ${HTTP_CODE}"; exit 1; }

DISK_USED="$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
if (( DISK_USED >= 85 )); then
  echo "WARN: root filesystem usage is ${DISK_USED}%"
  exit 1
fi

systemctl is-active --quiet ultran-backup.timer || {
  echo "FAIL: encrypted backup timer is not active"
  exit 1
}

echo "OK: API healthy, HTTPS 200, Caddy running, disk ${DISK_USED}%, backup timer active"
