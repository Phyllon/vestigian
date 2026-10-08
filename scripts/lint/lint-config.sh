#!/usr/bin/env bash
# Validates the configuration files that nothing else parses before they reach
# a server: GitHub workflows (actionlint), both Compose files (`docker compose
# config`), and the Prometheus rules/config and Alertmanager config
# (promtool / amtool). Local only, official images, no account.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

ACTIONLINT_IMAGE="rhysd/actionlint:1.7.12"
# Same tags as docker/compose.*.yml, so the validator is the version that will
# actually load the files. Bump together with the Compose files.
PROMETHEUS_IMAGE="prom/prometheus:v3.2.1"
ALERTMANAGER_IMAGE="prom/alertmanager:v0.28.1"

status=0

echo "lint-config: GitHub workflows"
docker run --rm -v "$(pwd):/repo" -w /repo "$ACTIONLINT_IMAGE" -color || status=1

# `--env-file .env.example`, not `.env`: .env is gitignored, so this has to
# pass on a fresh checkout. ORIGIN_KEY is the one `:?` (required) variable in
# the prod file; any non-empty value satisfies the interpolation check.
# The warnings about blank defaults are filtered — they are the template's
# unset secrets, not problems with the file's structure.
for environment in dev prod; do
  echo "lint-config: docker/compose.$environment.yml"
  ORIGIN_KEY=lint-placeholder docker compose --env-file .env.example \
    -f "docker/compose.$environment.yml" config -q 2> >(grep -v 'level=warning' >&2) || status=1
done

echo "lint-config: Prometheus config and rules"
docker run --rm -v "$(pwd)/docker/observability:/etc/prometheus:ro" \
  --entrypoint promtool "$PROMETHEUS_IMAGE" \
  check config /etc/prometheus/prometheus.yml || status=1

echo "lint-config: Alertmanager config"
docker run --rm -v "$(pwd)/docker/observability:/etc/alertmanager:ro" \
  --entrypoint amtool "$ALERTMANAGER_IMAGE" \
  check-config /etc/alertmanager/alertmanager.yml || status=1

exit "$status"
