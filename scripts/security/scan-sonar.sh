#!/usr/bin/env bash
# SonarQube analysis, local only — no SonarQube Cloud, no account, no source
# leaving this machine. The SonarQube CLI (`sonar`) is only a client: every
# `sonar analyze` subcommand needs a server behind it, and code-quality
# analysis (`analyze agentic`) is SonarQube Cloud only. So this script runs
# SonarQube Community Build in a container on loopback, scans with the
# official scanner image, and reads the result back with `sonar list issues`.
#
# First run creates the container, replaces the default admin/admin password
# and generates a user token; both live in .tools/sonarqube/ (gitignored) and
# only ever reach 127.0.0.1. Arguments are passed on to `sonar list issues`
# (e.g. --severities HIGH,BLOCKER, --format json).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

CONTAINER=vestigian-sonarqube
NETWORK=vestigian-sonar
PORT=9110
SERVER="http://127.0.0.1:${PORT}"
STATE_DIR=".tools/sonarqube"
SONAR_CLI="${HOME}/.local/share/sonarqube-cli/bin/sonar"
export DO_NOT_TRACK=1

mkdir -p "$STATE_DIR"

if [ ! -x "$SONAR_CLI" ]; then
  echo "scan-sonar: SonarQube CLI missing — install it first (PROFILE=/dev/null keeps your shell profile untouched):"
  echo "  curl -o- https://raw.githubusercontent.com/SonarSource/sonarqube-cli/refs/heads/master/user-scripts/install.sh | PROFILE=/dev/null bash"
  exit 1
fi

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

if ! docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker run -d --name "$CONTAINER" --network "$NETWORK" \
    -p "127.0.0.1:${PORT}:9000" \
    -e SONAR_TELEMETRY_ENABLE=false \
    -v vestigian-sonarqube-data:/opt/sonarqube/data \
    sonarqube:community >/dev/null
else
  docker start "$CONTAINER" >/dev/null
  docker network connect "$NETWORK" "$CONTAINER" 2>/dev/null || true
fi

echo "scan-sonar: waiting for SonarQube at ${SERVER}"
for _ in $(seq 1 120); do
  if curl -fs "${SERVER}/api/system/status" | grep -q '"status":"UP"'; then break; fi
  sleep 5
done
curl -fs "${SERVER}/api/system/status" | grep -q '"status":"UP"' || {
  echo "scan-sonar: SonarQube did not come up — docker logs ${CONTAINER}"
  exit 1
}

if [ ! -s "${STATE_DIR}/token" ]; then
  PASSWORD="$(openssl rand -base64 24)Aa1!"
  curl -fs -u admin:admin -X POST "${SERVER}/api/users/change_password" \
    --data-urlencode login=admin \
    --data-urlencode previousPassword=admin \
    --data-urlencode "password=${PASSWORD}"
  printf '%s' "$PASSWORD" >"${STATE_DIR}/admin-password"
  curl -fs -u "admin:${PASSWORD}" -X POST "${SERVER}/api/user_tokens/generate" \
    --data-urlencode "name=vestigian-scan" |
    sed -E 's/.*"token":"([^"]+)".*/\1/' >"${STATE_DIR}/token"
  chmod 600 "${STATE_DIR}/admin-password" "${STATE_DIR}/token"
fi

TOKEN="$(cat "${STATE_DIR}/token")"

docker run --rm --network "$NETWORK" \
  --user "$(id -u):$(id -g)" \
  -e SONAR_HOST_URL="http://${CONTAINER}:9000" \
  -e SONAR_TOKEN="$TOKEN" \
  -v "$(pwd):/usr/src" \
  sonarsource/sonar-scanner-cli:latest

# The scanner only uploads the report; the server processes it afterwards.
# Listing issues before that finishes printed "No issues found" on a first
# run that, once processed, had 99.
echo "scan-sonar: waiting for the server to process the report"
for _ in $(seq 1 120); do
  if curl -fs -u "${TOKEN}:" "${SERVER}/api/ce/activity_status?component=vestigian" |
    grep -q '"pending":0,"inProgress":0'; then break; fi
  sleep 5
done

SONARQUBE_CLI_TOKEN="$TOKEN" SONARQUBE_CLI_SERVER="$SERVER" \
  "$SONAR_CLI" list issues --project vestigian --statuses OPEN,CONFIRMED --page-size 500 --format table "$@"
