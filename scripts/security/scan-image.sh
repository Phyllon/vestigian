#!/usr/bin/env bash
# Container image scan, local only, via the official Trivy image. Not part of
# `pnpm check` — it has to build the image first, which is minutes, not
# seconds. Run by hand before a release, or after touching docker/Dockerfile
# or a dependency bump.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

TRIVY_IMAGE="aquasec/trivy:0.74.0"
TAG="vestigian:security-scan"

echo "scan-image: building $TAG from docker/Dockerfile..."
docker build -f docker/Dockerfile -t "$TAG" .

echo "scan-image: scanning with Trivy..."
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.cache/trivy:/root/.cache/trivy" \
  "$TRIVY_IMAGE" image \
  --severity CRITICAL,HIGH \
  --ignore-unfixed \
  "$TAG" \
  "$@"
