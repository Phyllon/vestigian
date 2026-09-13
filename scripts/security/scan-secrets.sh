#!/usr/bin/env bash
# Secret scanning, local only, via the official gitleaks image — no binary to
# install, no GitHub Actions minutes spent. Runs against the whole working
# tree by default; `.husky/pre-commit` calls gitleaks directly in
# `--staged` mode for a faster per-commit check (see there).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

GITLEAKS_IMAGE="zricethezav/gitleaks:v8.30.1"

docker run --rm \
  -v "$(pwd):/repo" \
  -w /repo \
  "$GITLEAKS_IMAGE" \
  detect --source /repo --config /repo/.gitleaks.toml --no-banner --redact \
  "$@"
