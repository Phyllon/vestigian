#!/usr/bin/env bash
# Dockerfile linting, local only, via the official hadolint image.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

HADOLINT_IMAGE="hadolint/hadolint:v2.15.1-alpine"

# Enumerated rather than globbed: a Dockerfile that appears in this repo should
# be added here deliberately, so a new one cannot arrive unlinted and unnoticed.
status=0
for dockerfile in \
  docker/Dockerfile \
  docker/backup/Dockerfile \
  docker/security/bunny-bouncer/Dockerfile; do
  echo "lint-dockerfile: $dockerfile"
  docker run --rm -i \
    -v "$(pwd)/.hadolint.yaml:/.hadolint.yaml:ro" \
    "$HADOLINT_IMAGE" hadolint --config /.hadolint.yaml - < "$dockerfile" || status=1
done

exit "$status"
