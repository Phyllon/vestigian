#!/bin/sh
# Nightly dump, kept for fourteen days. One VPS is one failure domain, so this
# is the whole disaster recovery story — test the restore, not just the dump.
set -eu

while true; do
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  # The antiquity_* tables hold third-party reference cartography rebuilt by
  # `pnpm import:atlas`; their rows are excluded so nightly dumps do not carry
  # 75 MB of borrowed coastline that a single command reproduces exactly.
  pg_dump -h postgres -U vestigian -Fc --exclude-table-data='antiquity_*' vestigian > "/backups/vestigian-${STAMP}.dump"
  find /backups -name 'vestigian-*.dump' -mtime +14 -delete
  echo "backup written: vestigian-${STAMP}.dump"
  sleep 86400
done
