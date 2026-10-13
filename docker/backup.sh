#!/bin/sh
# Nightly dump, kept locally for fourteen days and pushed off this machine.
#
# One VPS is one failure domain: until this script pushed anywhere, losing the
# box lost the dumps along with the database they were dumps of, and the whole
# disaster-recovery story was a file sitting next to the thing it was meant to
# survive. The local copy is still written first and is still what a routine
# "undo last night" restore reads — the off-box push is what covers losing the
# machine, not what replaces the fast path.
#
# Failures are loud but never fatal: a push that cannot reach the remote must
# not take the local dump down with it, and `set -e` inside the loop would exit
# the container and lose the schedule. Each stage reports its own outcome on a
# line shaped for the Loki alert in docker/observability/loki-rules.yml — grep
# `backup.outcome=`.
#
# Still true, and still worth the reminder: test the restore, not just the dump.
# docker/restore-drill.sh does that against a real snapshot.
set -u

BACKUP_DIR=/backups
KEEP_DAYS=14

# restic is optional on purpose. An instance that has not configured a remote
# yet keeps working exactly as it did before, and says so once per run rather
# than failing in a way somebody would learn to ignore.
remote_configured() {
  [ -n "${RESTIC_REPOSITORY:-}" ] && [ -n "${RESTIC_PASSWORD:-}" ]
}

# What this machine is actually holding, one line per run. The dumps are pruned
# by `find -mtime` and the remote by `restic forget`, and both are meant to
# plateau — a plateau is a claim, and these two lines are how the Loki rules in
# docker/observability/rules/fake/backup.yml check it instead of assuming it.
# `du` rather than summing `wc -c` per file: one 60 MB read per file, per night,
# for a number that only has to be right to the megabyte.
report_local_retention() {
  files=$(find "$BACKUP_DIR" -name 'vestigian-*.dump' | wc -l)
  kilobytes=$(du -ck "$BACKUP_DIR"/vestigian-*.dump 2>/dev/null | tail -n 1 | cut -f1)
  echo "backup.outcome=ok stage=retention scope=local files=${files} bytes=$((${kilobytes:-0} * 1024))"
}

# `restic snapshots --compact` ends with "N snapshots". Anything else (an older
# restic, a locked repository) is left unreported rather than reported wrong —
# the push itself has its own outcome line above.
report_offsite_retention() {
  snapshots=$(restic snapshots --tag nightly --host vestigian --compact 2>/dev/null | tail -n 1 | awk '{print $1}')
  case "$snapshots" in
    '' | *[!0-9]*) return 0 ;;
  esac
  echo "backup.outcome=ok stage=retention scope=offsite snapshots=${snapshots}"
}

run_backup() {
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  DUMP="${BACKUP_DIR}/vestigian-${STAMP}.dump"

  # The antiquity_* tables hold third-party reference cartography rebuilt by
  # `pnpm import:atlas`; their rows are excluded so nightly dumps do not carry
  # 75 MB of borrowed coastline that a single command reproduces exactly.
  if ! pg_dump -h postgres -U vestigian -Fc --exclude-table-data='antiquity_*' vestigian >"$DUMP"; then
    echo "backup.outcome=failed stage=dump file=${DUMP}"
    # A truncated dump is worse than none: it restores, and restores wrong.
    rm -f "$DUMP"
    return 1
  fi

  echo "backup.outcome=ok stage=dump file=${DUMP} bytes=$(wc -c <"$DUMP")"
  find "$BACKUP_DIR" -name 'vestigian-*.dump' -mtime "+${KEEP_DAYS}" -delete
  report_local_retention

  if ! remote_configured; then
    echo "backup.outcome=skipped stage=offsite reason=no-restic-repository-configured"
    return 0
  fi

  # The off-box target is a directory the operator mounted over NFS on the host.
  # If that mount is missing the bind source is just an empty local directory,
  # and restic would happily write the "off-box" copy to this very disk — a
  # backup that survives nothing and reports success. The marker file lives on
  # the Storage Space itself (created once, runbook §20), so it is absent
  # exactly when the mount is.
  case "$RESTIC_REPOSITORY" in
    /offsite/*)
      if [ ! -f /offsite/.vestigian-offsite ]; then
        echo "backup.outcome=failed stage=offsite reason=offsite-not-mounted file=${DUMP}"
        return 1
      fi
      ;;
  esac

  # `init` is idempotent in effect but noisy on an existing repository, so its
  # failure is expected on every run after the first and is not an error.
  restic cat config >/dev/null 2>&1 || restic init >/dev/null 2>&1 || true

  if ! restic backup --tag nightly --host vestigian "$DUMP"; then
    echo "backup.outcome=failed stage=offsite file=${DUMP}"
    return 1
  fi

  echo "backup.outcome=ok stage=offsite file=${DUMP}"

  # Retention on the remote is restic's own, not `find`'s: snapshots are
  # deduplicated, so keeping eight weeklies beyond the fourteen dailies costs
  # far less than eight full dumps would.
  if ! restic forget --tag nightly --host vestigian \
    --keep-daily "$KEEP_DAYS" --keep-weekly 8 --prune; then
    echo "backup.outcome=failed stage=prune"
    return 1
  fi
  report_offsite_retention

  # A repository that cannot be read is not a backup. Reading a sample rather
  # than everything keeps this affordable enough to run unattended; the full
  # proof is docker/restore-drill.sh, which restores rather than verifies.
  if [ "$(date -u +%u)" = "7" ]; then
    if ! restic check --read-data-subset=5%; then
      echo "backup.outcome=failed stage=check"
      return 1
    fi
    echo "backup.outcome=ok stage=check"
  fi

  return 0
}

while true; do
  run_backup || echo "backup.outcome=failed stage=run"
  sleep 86400
done
