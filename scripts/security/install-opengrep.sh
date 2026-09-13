#!/usr/bin/env bash
# Downloads the opengrep CLI and a pinned snapshot of the community rule
# registry into .tools/ (gitignored) — nothing here touches CI or a hosted
# service. Re-run any time to pick up the pinned versions below; bump them by
# hand, deliberately, not on every run.
#
# opengrep is a full fork of the Semgrep OSS engine, taken before Semgrep Inc.
# moved parts of its rule registry behind a login — same rule syntax, same
# CLI shape, no account needed. See .claude/rules/security-scanning.md.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

OPENGREP_VERSION="1.30.0"
# opengrep/opengrep-rules, pinned at the commit the project's fork description
# names as the fork point (December 13, 2024) — a frozen snapshot of the old
# Semgrep OSS registry's javascript/typescript/dockerfile rules, not a moving
# "main".
RULES_COMMIT="f1d2b562b414783763fd02a6ed2736eaed622efa"

TOOLS_DIR=".tools"
BIN_DIR="$TOOLS_DIR/bin"
RULES_DIR="$TOOLS_DIR/opengrep-rules"

mkdir -p "$BIN_DIR"

os="$(uname -s)"
arch="$(uname -m)"

case "$os-$arch" in
  # manylinux (glibc), not musllinux: it needs /lib/ld-musl-*.so.1, which a
  # glibc distro (Ubuntu/Debian/Zorin/Fedora/…) does not have — confirmed by
  # running the musllinux build here and hitting exactly that missing loader.
  Linux-x86_64) asset="opengrep_manylinux_x86" ;;
  Linux-aarch64 | Linux-arm64) asset="opengrep_manylinux_aarch64" ;;
  Darwin-arm64) asset="opengrep_osx_arm64" ;;
  Darwin-x86_64) asset="opengrep_osx_x86" ;;
  *)
    echo "install-opengrep: no known opengrep build for $os-$arch" >&2
    exit 1
    ;;
esac

if [ -x "$BIN_DIR/opengrep" ] && "$BIN_DIR/opengrep" --version 2>/dev/null | grep -q "$OPENGREP_VERSION"; then
  echo "install-opengrep: opengrep $OPENGREP_VERSION already installed"
else
  echo "install-opengrep: downloading opengrep $OPENGREP_VERSION ($asset)..."
  curl -fsSL -o "$BIN_DIR/opengrep" \
    "https://github.com/opengrep/opengrep/releases/download/v${OPENGREP_VERSION}/${asset}"
  chmod +x "$BIN_DIR/opengrep"
  "$BIN_DIR/opengrep" --version
fi

if [ -d "$RULES_DIR" ]; then
  echo "install-opengrep: community ruleset already vendored at $RULES_DIR"
else
  echo "install-opengrep: fetching opengrep-rules @ $RULES_COMMIT..."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  curl -fsSL -o "$tmp/rules.tar.gz" \
    "https://github.com/opengrep/opengrep-rules/archive/${RULES_COMMIT}.tar.gz"
  tar -xzf "$tmp/rules.tar.gz" -C "$tmp"

  extracted="$tmp/opengrep-rules-${RULES_COMMIT}"
  mkdir -p "$RULES_DIR"

  # An allowlist, not a denylist: a first pass vendored the full
  # javascript/typescript/dockerfile trees and ran it against this codebase,
  # producing 1196 findings on real source. Nearly all of it was rule packs
  # for frameworks this project does not use at all — express (Nitro/h3, not
  # Express), aws-cdk, jose/jsonwebtoken (sessions are sealed cookies via
  # nuxt-auth-utils, not raw JWT), react (this is a Vue app; its i18next pack
  # alone matched 25 ordinary vue-i18n `t()` calls), phantom, sequelize
  # (Drizzle, not Sequelize) and more. An allowlist means a future registry
  # update can only ever add rules for stacks already kept below, not quietly
  # reintroduce that noise. See .claude/rules/security-scanning.md for the
  # full before/after counts.
  #
  # javascript/lang: language-level security (path traversal, prototype
  #   pollution, unsafe regex, format-string injection) — minus the two
  #   subdirectories below, which are style/compat, not security.
  # javascript/node-crypto, javascript/argon2: the two crypto primitives this
  #   app actually calls (node:crypto for TOTP secrets, @node-rs/argon2 for
  #   passwords).
  # javascript/vue, javascript/playwright: the actual frontend framework and
  #   e2e tool in use.
  # typescript/lang: same language-level security rules, for .ts.
  # dockerfile: both Dockerfiles in this repo are plain Docker, no
  #   framework-specific noise possible.
  mkdir -p "$RULES_DIR/javascript" "$RULES_DIR/typescript"
  for dir in lang node-crypto argon2 vue playwright; do
    [ -d "$extracted/javascript/$dir" ] && cp -r "$extracted/javascript/$dir" "$RULES_DIR/javascript/$dir"
  done
  cp -r "$extracted/typescript/lang" "$RULES_DIR/typescript/lang"
  cp -r "$extracted/dockerfile" "$RULES_DIR/dockerfile"

  # `correctness`/`best-practice` under `lang` are style/compat (e.g. flagging
  # `.replaceAll()` for pre-2021 browser support), not security.
  rm -rf "$RULES_DIR/javascript/lang/correctness" "$RULES_DIR/javascript/lang/best-practice"
  rm -rf "$RULES_DIR/typescript/lang/correctness" "$RULES_DIR/typescript/lang/best-practice"
  # Flags every already-escaped template literal in mail-template.ts and
  # sitemap.ts alike, with no taint tracking to tell "interpolates an escaped
  # value" from "interpolates a raw one" — pure noise against code that
  # already exists specifically to close this gap.
  rm -f "$RULES_DIR/javascript/lang/security/html-in-template-string."*
  # Same accepted trade-off as .hadolint.yaml's DL3018 entry: pinning
  # `FROM node:26-alpine` by digest is a real reproducibility improvement,
  # deliberately not taken yet (see that comment for why), and scan-sast.sh
  # runs with --error so every remaining finding fails `pnpm check` — this one
  # would otherwise block on a decision that's already been made, not on a
  # regression.
  rm -f "$RULES_DIR/dockerfile/audit/dockerfile-source-not-pinned."*

  echo "install-opengrep: vendored a curated rule subset (lang/node-crypto/argon2/vue/playwright + dockerfile)"
fi

echo "install-opengrep: done"
