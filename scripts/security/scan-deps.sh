#!/usr/bin/env bash
# Dependency vulnerability scan (SCA), local only, via a pinned osv-scanner
# binary in .tools/ (gitignored). Not wired into `pnpm check`: it queries
# osv.dev over the network, and a flaky connection shouldn't block every
# push the way a purely local check does. Run by hand periodically, or
# before a release.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

OSV_SCANNER_VERSION="2.5.1"
BIN_DIR=".tools/bin"

os="$(uname -s)"
arch="$(uname -m)"

case "$os-$arch" in
  Linux-x86_64) asset="osv-scanner_linux_amd64" ;;
  Linux-aarch64 | Linux-arm64) asset="osv-scanner_linux_arm64" ;;
  Darwin-arm64) asset="osv-scanner_darwin_arm64" ;;
  Darwin-x86_64) asset="osv-scanner_darwin_amd64" ;;
  *)
    echo "scan-deps: no known osv-scanner build for $os-$arch" >&2
    exit 1
    ;;
esac

mkdir -p "$BIN_DIR"
if [ ! -x "$BIN_DIR/osv-scanner" ]; then
  echo "scan-deps: downloading osv-scanner $OSV_SCANNER_VERSION..."
  curl -fsSL -o "$BIN_DIR/osv-scanner" \
    "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/${asset}"
  chmod +x "$BIN_DIR/osv-scanner"
fi

"$BIN_DIR/osv-scanner" scan source --lockfile=pnpm-lock.yaml "$@"
