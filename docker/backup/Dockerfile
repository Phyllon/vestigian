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

# openssh-client: restic's sftp backend shells out to `ssh` — without it the
# repository opens locally and fails only when it tries to reach the host.
# hadolint ignore=DL3018
RUN apk add --no-cache restic openssh-client

# Runs as `postgres` (already present in the base image), not root. Nothing here
# needs root: pg_dump connects over the network, restic reads the dump and
# writes to a remote, and neither touches a privileged path.
#
# The two directories are created and chowned *before* the volume is attached
# because Docker seeds a fresh named volume from the image's own directory —
# ownership included. Without this, /backups would arrive root-owned and the
# first dump would fail on a permission error that looks like a broken script.
RUN mkdir -p /backups /var/lib/postgresql/.ssh \
    && chown -R postgres:postgres /backups /var/lib/postgresql/.ssh \
    && chmod 700 /var/lib/postgresql/.ssh

# ssh resolves the key and known_hosts through $HOME, and reads neither if it
# points somewhere this user cannot open.
ENV HOME=/var/lib/postgresql

USER postgres

# backup.sh stays bind-mounted from docker/backup.sh by compose rather than
# baked in, so editing the schedule or the retention does not need a rebuild.
ENTRYPOINT ["/bin/sh", "/backup.sh"]
