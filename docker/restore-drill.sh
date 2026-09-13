#!/usr/bin/env bash
# Proves a backup restores. Not that it exists — that it restores.
#
# `docker/backup.sh` writes a dump and pushes it off the box, and every part of
# that can succeed while producing something unrestorable: a dump truncated by a
# full disk, a restic repository whose password no longer matches, a pg_dump
# from a server version the restore target cannot read. None of it is visible
# until the day it matters, which is the one day there is no time to find out.
#
# So this restores a real snapshot into a throwaway Postgres container, asserts
# the tables that cannot be regenerated actually have rows in them, and throws
# the container away. It reads nothing from the live database and writes nothing
# to it — the only shared resource it touches is the backup repository, and only
# to read.
#
#   docker/restore-drill.sh                  # newest local dump in ./backups
#   docker/restore-drill.sh --offsite        # newest snapshot from restic
#   docker/restore-drill.sh path/to.dump     # a specific file
#
# Run it after any change to the backup path, and on a schedule a human actually
# keeps. A drill nobody runs is the same as no drill.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

CONTAINER="vestigian-restore-drill-$$"
PGPASSWORD_DRILL="drill"
WORK_DIR="$(mktemp -d)"
SOURCE="${1:-}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ---- find a dump to restore -------------------------------------------------

if [ "$SOURCE" = "--offsite" ]; then
  if [ -z "${RESTIC_REPOSITORY:-}" ] || [ -z "${RESTIC_PASSWORD:-}" ]; then
    echo "restore-drill: --offsite needs RESTIC_REPOSITORY and RESTIC_PASSWORD" >&2
    exit 1
  fi
  echo "restore-drill: pulling the newest snapshot from $RESTIC_REPOSITORY"
  restic restore latest --tag nightly --target "$WORK_DIR"
  DUMP="$(find "$WORK_DIR" -name 'vestigian-*.dump' -type f | sort | tail -1)"
elif [ -n "$SOURCE" ]; then
  DUMP="$SOURCE"
else
  # The compose volume is not reachable by path from here, so this reads the
  # bind-mounted directory a developer would have; --offsite is the real check.
  DUMP="$(find ./backups -name 'vestigian-*.dump' -type f 2>/dev/null | sort | tail -1 || true)"
fi

if [ -z "${DUMP:-}" ] || [ ! -f "$DUMP" ]; then
  echo "restore-drill: no dump found — pass a path, or --offsite" >&2
  exit 1
fi

echo "restore-drill: restoring $DUMP ($(wc -c <"$DUMP") bytes)"

# ---- restore into something disposable --------------------------------------

# postgis, not plain postgres: the dump carries geometry columns, and a restore
# into a server without the extension fails partway through having already
# created half the schema — which looks like a corrupt dump rather than a
# missing extension.
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASSWORD_DRILL" \
  -e POSTGRES_USER=vestigian \
  -e POSTGRES_DB=vestigian \
  postgis/postgis:17-3.5-alpine >/dev/null

# `-h 127.0.0.1`, and that is the whole trick. The postgres image's entrypoint
# runs a *temporary* server during initialisation with `listen_addresses` empty,
# so it answers on the Unix socket while the real server does not exist yet —
# a plain `pg_isready -U vestigian` passes against that one, the restore starts,
# and initdb then shuts the server down underneath it. The symptom is
# `PQputCopyData: server closed the connection unexpectedly` partway through a
# COPY, which reads exactly like a corrupt dump and is not one. Probing over TCP
# skips the init server entirely, because it is not listening on TCP.
echo "restore-drill: waiting for the throwaway server..."
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U vestigian -q 2>/dev/null; then break; fi
  sleep 1
done

if ! docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U vestigian -q 2>/dev/null; then
  echo "restore-drill: the throwaway server never came up" >&2
  exit 1
fi

docker cp "$DUMP" "$CONTAINER:/tmp/restore.dump"

# --no-owner: the dump names roles this throwaway server does not have, and
# their absence is not a restore failure. Errors are reported rather than fatal
# because pg_restore warns about extension ownership it cannot change; the
# assertions below are what actually decide whether this passed.
docker exec "$CONTAINER" pg_restore \
  --no-owner --no-privileges --dbname vestigian --username vestigian \
  /tmp/restore.dump 2>&1 | tail -5 || true

# ---- assert the irreplaceable tables survived -------------------------------

# Only tables that cannot be regenerated from an import script. `antiquity_*`
# rows are deliberately excluded from the dump (see backup.sh), so an empty one
# is correct and checking it would fail every healthy drill.
FAILED=0
for table in sites tracings revisions users site_images; do
  count="$(docker exec "$CONTAINER" psql -U vestigian -d vestigian -tAc \
    "SELECT count(*) FROM ${table}" 2>/dev/null || echo "ERROR")"

  if [ "$count" = "ERROR" ]; then
    echo "  ✗ ${table}: missing from the restored database"
    FAILED=1
  else
    echo "  ✓ ${table}: ${count} rows"
    # `users` and `sites` are empty only on an instance nobody has used; every
    # other case means the dump restored structurally but carried no data.
    if [ "$count" = "0" ] && { [ "$table" = "sites" ] || [ "$table" = "users" ]; }; then
      echo "    ↳ empty — expected on a fresh instance, a failure on a live one"
    fi
  fi
done

# Geometry is the part a plain row count cannot vouch for: a restore that lost
# PostGIS leaves the column present and every value unreadable.
geom="$(docker exec "$CONTAINER" psql -U vestigian -d vestigian -tAc \
  "SELECT count(*) FROM sites WHERE geom IS NOT NULL AND ST_X(geom) IS NOT NULL" 2>/dev/null || echo "ERROR")"

if [ "$geom" = "ERROR" ]; then
  echo "  ✗ geometry: unreadable after restore — PostGIS did not come back"
  FAILED=1
else
  echo "  ✓ geometry: ${geom} sites with a readable coordinate"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "restore-drill: FAILED — this backup would not have brought the atlas back" >&2
  exit 1
fi

echo "restore-drill: passed"
