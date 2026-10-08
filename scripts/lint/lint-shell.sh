#!/usr/bin/env bash
# Shell script linting, local only, via the official shellcheck image.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

SHELLCHECK_IMAGE="koalaman/shellcheck:v0.11.0"

# Enumerated rather than globbed, for the same reason as lint-dockerfile.sh: a
# new shell script should be added here deliberately, not arrive unlinted. A
# glob would also pick up .tools/ and node_modules/.
status=0
docker run --rm -v "$(pwd):/mnt" -w /mnt "$SHELLCHECK_IMAGE" \
  docker/backup.sh \
  docker/restore-drill.sh \
  scripts/setup.sh \
  scripts/ops/mirror-terrain.sh \
  scripts/lint/lint-shell.sh \
  scripts/lint/lint-config.sh \
  scripts/security/install-opengrep.sh \
  scripts/security/lint-dockerfile.sh \
  scripts/security/scan-dast.sh \
  scripts/security/scan-deps.sh \
  scripts/security/scan-image.sh \
  scripts/security/scan-sast.sh \
  scripts/security/scan-secrets.sh \
  scripts/security/scan-sonar.sh || status=1

# Husky 9 runs its hooks with `sh` and the files carry no shebang, so
# the linter needs the dialect stated rather than inferred.
docker run --rm -v "$(pwd):/mnt" -w /mnt "$SHELLCHECK_IMAGE" --shell=sh \
  .husky/pre-commit \
  .husky/pre-push \
  .husky/commit-msg || status=1

exit "$status"
