#!/usr/bin/env bash
# Static analysis, local only — no GitHub Actions minutes spent.
# Runs the project's own governance rules (.opengrep/rules/, committed) plus
# a vendored community subset (javascript/typescript/dockerfile, fetched by
# install-opengrep.sh into .tools/, gitignored).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [ ! -x ".tools/bin/opengrep" ]; then
  echo "scan-sast: opengrep not installed — running install-opengrep.sh first"
  bash scripts/security/install-opengrep.sh
fi

CONFIGS=(--config .opengrep/rules)
if [ -d ".tools/opengrep-rules" ]; then
  CONFIGS+=(--config .tools/opengrep-rules)
fi

.tools/bin/opengrep scan "${CONFIGS[@]}" \
  --error \
  --exclude ".tools" --exclude ".nuxt" --exclude ".output" --exclude "node_modules" \
  --exclude ".import" --exclude "coverage" --exclude "dist" \
  --exclude "server/database/migrations" \
  "$@"
