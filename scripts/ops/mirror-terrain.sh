#!/usr/bin/env bash
#
# Mirrors the Mapterhorn elevation tiles for Europe onto our own CDN, so the
# hillshade under the Barrington sheet no longer asks a Cloudflare-fronted host
# (tiles.mapterhorn.com) for anything on a visitor's behalf.
#
# What it does, in order — each step stops the script if it fails:
#   1. checks the tools (curl, tar, df, and rclone when uploading)
#   2. fetches the pinned `pmtiles` CLI into $WORKDIR/bin, verified against a
#      SHA-256 pinned in this script (Linux x86_64 and arm64)
#   3. dry-runs the extract and prints the real size (nothing is downloaded)
#   4. extracts $BBOX up to zoom $MAXZOOM from Mapterhorn's planet archive, by
#      HTTP range requests — only the needed bytes cross the network
#   5. verifies the archive (`pmtiles verify`) and checks it is WebP and holds
#      the zoom range asked for
#   6. uploads it, plus Mapterhorn's attribution.json (the licence record of the
#      sources inside it), with rclone, and compares sizes afterwards
#   7. prints the exact value to put in Dokploy
#
# Run it on the VPS, inside tmux (a long job that must survive a dropped SSH):
#
#   BUNNY_ZONE=<storage-zone-name> ./mirror-terrain.sh --dry-run   # sizes only
#   BUNNY_ZONE=<storage-zone-name> ./mirror-terrain.sh             # the real run
#
# Configuration (environment):
#   BUNNY_ZONE     required unless --no-upload: the storage zone to upload into
#   RCLONE_REMOTE  rclone remote name from runbook §10 step 6      (default: bunny)
#   BBOX           min_lon,min_lat,max_lon,max_lat                 (default: -12,30,45,62)
#   MAXZOOM        highest zoom to keep                            (default: 10)
#   OBJECT         object name in the zone                         (default: terrain.pmtiles)
#   WORKDIR        scratch directory                               (default: ./terrain-mirror)
#
# Measured sizes for the default bbox (pmtiles extract --dry-run, 2026-10-02):
#   z<=9  634 MB   z<=10  1.9 GB   z<=11  5.5 GB   z<=12  22 GB
# Mapterhorn's planet archive stops at z12; the style overzooms beyond the
# archive's own maximum, which costs sharpness in a hillshade and nothing else.
#
# Flags:
#   --dry-run     print the extract size and stop
#   --no-upload   extract and verify, leave the file in $WORKDIR
#   --keep        keep the local archive after a successful upload
#
set -euo pipefail

PMTILES_VERSION="1.31.2"
SOURCE_URL="https://download.mapterhorn.com/planet.pmtiles"
ATTRIBUTION_URL="https://download.mapterhorn.com/attribution.json"

BBOX="${BBOX:--12,30,45,62}"
MAXZOOM="${MAXZOOM:-10}"
OBJECT="${OBJECT:-terrain.pmtiles}"
WORKDIR="${WORKDIR:-./terrain-mirror}"
RCLONE_REMOTE="${RCLONE_REMOTE:-bunny}"

DRY_RUN=false
UPLOAD=true
KEEP=false
for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=true ;;
    --no-upload) UPLOAD=false ;;
    --keep) KEEP=true ;;
    *) echo "mirror-terrain: unknown flag '$argument'" >&2; exit 2 ;;
  esac
done

say() { printf 'mirror-terrain: %s\n' "$*"; }
fail() { printf 'mirror-terrain: ERROR: %s\n' "$*" >&2; exit 1; }

# --- 1. tools ---------------------------------------------------------------
for tool in curl tar df sha256sum awk; do
  command -v "$tool" >/dev/null 2>&1 || fail "'$tool' is required"
done
if [ "$UPLOAD" = true ] && [ "$DRY_RUN" = false ]; then
  command -v rclone >/dev/null 2>&1 || fail "'rclone' is required to upload (runbook §10 step 6), or pass --no-upload"
  [ -n "${BUNNY_ZONE:-}" ] || fail "BUNNY_ZONE is required to upload (the storage zone's name)"
  rclone listremotes | grep -qx "${RCLONE_REMOTE}:" \
    || fail "rclone remote '${RCLONE_REMOTE}' is not configured (runbook §10 step 6)"
fi

mkdir -p "${WORKDIR:?}/bin"
ARCHIVE="${WORKDIR:?}/${OBJECT:?}"

# --- 2. the pmtiles CLI, pinned and checksum-verified -------------------------
PMTILES="${WORKDIR:?}/bin/pmtiles"
if [ ! -x "$PMTILES" ] || ! "$PMTILES" version 2>/dev/null | grep -q "pmtiles $PMTILES_VERSION"; then
  # The release publishes no checksum file, so the digests of the two Linux
  # tarballs are pinned here (computed from the release on 2026-10-02). Bumping
  # PMTILES_VERSION means recomputing both.
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)  PLATFORM="Linux_x86_64"; EXPECTED="3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f" ;;
    Linux-aarch64) PLATFORM="Linux_arm64";  EXPECTED="f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1" ;;
    *) fail "no pinned pmtiles build for $(uname -s)-$(uname -m); put go-pmtiles $PMTILES_VERSION at $PMTILES yourself" ;;
  esac
  TARBALL="go-pmtiles_${PMTILES_VERSION}_${PLATFORM}.tar.gz"
  say "downloading pmtiles $PMTILES_VERSION ($PLATFORM)"
  curl -fsSL -o "${WORKDIR:?}/${TARBALL:?}" \
    "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${TARBALL}"
  ACTUAL="$(sha256sum "${WORKDIR:?}/${TARBALL:?}" | awk '{ print $1 }')"
  [ "$EXPECTED" = "$ACTUAL" ] || fail "checksum mismatch for $TARBALL (expected $EXPECTED, got $ACTUAL)"
  tar -xzf "${WORKDIR:?}/${TARBALL:?}" -C "${WORKDIR:?}/bin" pmtiles
  rm -f "${WORKDIR:?}/${TARBALL:?}"
fi
"$PMTILES" version | head -1

# --- 3. the real size, before any download -------------------------------------
say "sizing: bbox=$BBOX maxzoom=$MAXZOOM (nothing is downloaded yet)"
DRY_OUTPUT="$("$PMTILES" extract --dry-run --bbox="$BBOX" --maxzoom="$MAXZOOM" "$SOURCE_URL" /dev/null 2>&1)"
echo "$DRY_OUTPUT" | tail -3
if [ "$DRY_RUN" = true ]; then
  say "dry run only — stopping here"
  exit 0
fi

# Archive size, from the dry run's "for an archive size of 1.9 GB".
SIZE_TEXT="$(echo "$DRY_OUTPUT" | sed -n 's/.*archive size of \([0-9.]* [KMGT]B\).*/\1/p' | tail -1)"
[ -n "$SIZE_TEXT" ] || fail "could not read the archive size from the dry run"
SIZE_MB="$(echo "$SIZE_TEXT" | awk '{ v = $1; if ($2 == "KB") v /= 1024; else if ($2 == "GB") v *= 1024; else if ($2 == "TB") v *= 1048576; printf "%d", v + 1 }')"
FREE_MB="$(df -Pm "${WORKDIR:?}" | awk 'NR == 2 { print $4 }')"
NEEDED_MB=$(( SIZE_MB * 12 / 10 ))
say "archive ≈ ${SIZE_TEXT}; free here ≈ ${FREE_MB} MB; need ≈ ${NEEDED_MB} MB"
[ "$FREE_MB" -ge "$NEEDED_MB" ] || fail "not enough free disk in $WORKDIR"

# --- 4. extract -------------------------------------------------------------
if [ -e "$ARCHIVE" ]; then
  say "removing a previous $ARCHIVE so the extract starts clean"
  rm -f "${ARCHIVE:?}"
fi
say "extracting (range requests against Mapterhorn; this is the long step)"
"$PMTILES" extract --bbox="$BBOX" --maxzoom="$MAXZOOM" "$SOURCE_URL" "$ARCHIVE"

# --- 5. verify --------------------------------------------------------------
say "verifying the archive"
"$PMTILES" verify "$ARCHIVE"
SHOW="$("$PMTILES" show "$ARCHIVE")"
echo "$SHOW" | grep -E "tile type|min zoom|max zoom|bounds|tile compression" || true
echo "$SHOW" | grep -qi "tile type: webp" || fail "expected WebP terrain tiles; the archive says otherwise"
ACTUAL_MAX="$(echo "$SHOW" | awk -F': *' '/max zoom/ { print $2; exit }')"
[ "$ACTUAL_MAX" = "$MAXZOOM" ] || fail "archive max zoom is '$ACTUAL_MAX', expected $MAXZOOM"

# --- 6. upload --------------------------------------------------------------
LOCAL_BYTES="$(wc -c < "$ARCHIVE" | tr -d ' ')"
if [ "$UPLOAD" = true ]; then
  say "uploading to ${RCLONE_REMOTE}:${BUNNY_ZONE}/${OBJECT}"
  rclone copyto "$ARCHIVE" "${RCLONE_REMOTE}:${BUNNY_ZONE}/${OBJECT}" --progress

  curl -fsSL -o "${WORKDIR:?}/attribution.json" "$ATTRIBUTION_URL"
  rclone copyto "${WORKDIR:?}/attribution.json" "${RCLONE_REMOTE}:${BUNNY_ZONE}/terrain-attribution.json"

  REMOTE_BYTES="$(rclone size --json "${RCLONE_REMOTE}:${BUNNY_ZONE}/${OBJECT}" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
  [ "$REMOTE_BYTES" = "$LOCAL_BYTES" ] || fail "uploaded size ($REMOTE_BYTES) differs from local ($LOCAL_BYTES); do not use it"
  say "upload verified: ${LOCAL_BYTES} bytes on both sides"
  if [ "$KEEP" = false ]; then
    rm -f "${ARCHIVE:?}"
    say "removed the local archive (use --keep to keep it)"
  fi
else
  say "--no-upload: archive left at $ARCHIVE (${LOCAL_BYTES} bytes)"
fi

# --- 7. what to do next -------------------------------------------------------
cat <<EOF

mirror-terrain: done.

Next, in Dokploy → this project → Environment (runbook §15a, step 5):

  TERRAIN_URL=https://<maps-zone>.b-cdn.net/${OBJECT}   (the pull zone whose origin is the storage zone, runbook §15)

then Deploy: an environment change needs a redeploy. The licence record for the
sources inside the archive is stored beside it as terrain-attribution.json.
EOF
