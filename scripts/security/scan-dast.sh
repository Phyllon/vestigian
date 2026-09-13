#!/usr/bin/env bash
# DAST, local only: builds the production app (same command
# playwright.config.ts's webServer uses for e2e — see e2e/README.md), boots
# it on a throwaway port, and points OWASP ZAP's *baseline* scan at it.
#
# Baseline is passive only: it crawls with a spider and checks response
# headers/config (CSP, cookie flags, missing security headers, mixed
# content), and never sends the SQLi/XSS attack payloads ZAP's "full" active
# scan does. That is what makes it safe to run against this build at all —
# an active scan belongs against a disposable staging deployment, never
# against this app's real contribution/moderation endpoints, since it could
# genuinely write garbage revisions through them. See
# .claude/rules/security-scanning.md.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PORT=3112
HOST=127.0.0.1
ZAP_IMAGE="zaproxy/zap-stable:latest"
REPORT_DIR=".security-reports"
REPORT_FILE="zap-baseline-$(date +%Y%m%d-%H%M%S).html"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

mkdir -p "$REPORT_DIR"

echo "scan-dast: building production app..."
pnpm build

echo "scan-dast: starting server on $HOST:$PORT..."
NODE_ENV=production \
  NITRO_PORT="$PORT" \
  NITRO_HOST="$HOST" \
  NUXT_TELEMETRY_OTLP_ENDPOINT='' \
  NUXT_BEHIND_TRUSTED_PROXY=true \
  node .output/server/index.mjs &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

echo "scan-dast: waiting for /api/health..."
for _ in $(seq 1 60); do
  if curl -fsS "http://$HOST:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://$HOST:$PORT/api/health" >/dev/null 2>&1; then
  echo "scan-dast: server never became healthy" >&2
  exit 1
fi

echo "scan-dast: running ZAP baseline scan..."
# --network host: this repo's dev environment is Linux, where the ZAP
# container needs this to reach the host's 127.0.0.1 directly. On Docker
# Desktop (macOS/Windows), replace both the network flag and $HOST above
# with host.docker.internal instead — --network host is a no-op there.
status=0
docker run --rm --network host \
  -v "$(pwd)/$REPORT_DIR:/zap/wrk/:rw" \
  "$ZAP_IMAGE" zap-baseline.py \
  -t "http://$HOST:$PORT" \
  -r "$REPORT_FILE" \
  "$@" || status=$?

echo "scan-dast: report at $REPORT_DIR/$REPORT_FILE"
exit "$status"
