#!/bin/sh
# Nightly dump, kept for fourteen days. One VPS is one failure domain, so this
# is the whole disaster recovery story — test the restore, not just the dump.
set -eu

while true; do
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  pg_dump -h postgres -U vestigia -Fc vestigia > "/backups/vestigia-${STAMP}.dump"
  find /backups -name 'vestigia-*.dump' -mtime +14 -delete
  echo "backup written: vestigia-${STAMP}.dump"
  sleep 86400
done
