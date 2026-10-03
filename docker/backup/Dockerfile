# The nightly dump needs two things the stock postgres image has only one of:
# `pg_dump` at a version matching the server, and a way to get the result off
# this machine. restic supplies the second — content-addressed, deduplicating
# and encrypted client-side, so the copy sitting on someone else's disk is not
# a second place the atlas is readable in the clear.
#
# A dedicated image rather than `apk add` at container start: the latter would
# make every restart depend on Alpine's package index being reachable, which is
# precisely the sort of ambient dependency a disaster-recovery path should not
# have. Built once, and covered by `pnpm lint:dockerfile` like the other two.
FROM postgres:17-alpine

# The off-box repository is a directory: netcup Storage Space is mounted over NFS
# on the host and bind-mounted into the container at /offsite (see
# documents/runbook_prod.deployment.md §20), so restic needs its local backend
# and nothing network-aware — no ssh client, no keys, no known_hosts.
#
# Runs as `postgres` (already present in the base image), not root. Nothing here
# needs root: pg_dump connects over the network, restic reads the dump and
# writes to a remote, and neither touches a privileged path.
#
# The directory is created and chowned *before* the volume is attached
# because Docker seeds a fresh named volume from the image's own directory —
# ownership included. Without this, /backups would arrive root-owned and the
# first dump would fail on a permission error that looks like a broken script.
# hadolint ignore=DL3018
RUN apk add --no-cache restic \
    && mkdir -p /backups \
    && chown -R postgres:postgres /backups

# restic keeps its cache under $HOME, which must be somewhere this user can write.
ENV HOME=/var/lib/postgresql

USER postgres

# backup.sh stays bind-mounted from docker/backup.sh by compose rather than
# baked in, so editing the schedule or the retention does not need a rebuild.
ENTRYPOINT ["/bin/sh", "/backup.sh"]
