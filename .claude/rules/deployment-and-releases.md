---
paths:
  - 'docker/**'
  - '.github/workflows/**'
  - '.changeset/**'
  - 'scripts/verify-commit-msg.ts'
  - 'scripts/db-snapshot.ts'
  - 'scripts/reconcile-images.ts'
---

## Backups — two stores that fail apart

```bash
pnpm db:snapshot        # pg_dump -Fc → .import/snapshots/, keeps 14
pnpm images:reconcile   # do the database and the object store still agree?
```

The database is reproducible until the first real contribution lands; the
mirrored photographs never are. `images:reconcile` exists for one silent
failure: a database restored newer than the bucket leaves rows at `approved`
describing objects that are gone, and the gallery breaks while every query
reports health. `--repair` returns those rows to `pending`. Orphaned objects are
reported only — nothing in this project deletes bytes.

`pnpm db:snapshot` still never leaves the machine — it is a developer
convenience for "undo the last hour", not disaster recovery. The **nightly**
backup does leave, and that is new.

### The nightly path, end to end

`docker/backup.sh` (in the `backup` service, built from `docker/backup/Dockerfile`
so restic is present) writes the local dump exactly as before, then pushes it to
a restic repository — content-addressed, deduplicated, and **encrypted
client-side**, so the copy on somebody else's disk is not a second place the
atlas is readable in the clear. `RESTIC_REPOSITORY` points at a Hetzner Storage
Box over SFTP: same provider and jurisdiction as the VPS, roughly €3/month.

Everything `RESTIC_*` is optional. With nothing configured the service behaves
exactly as it always did and says so once per run, so an instance that has not
set this up is not broken, only unprotected — and says which.

Three details that are deliberate rather than incidental:

- **`RESTIC_PASSWORD` _is_ the backup.** restic encrypts client-side and has no
  recovery path; losing it makes every off-box snapshot permanently unreadable.
  It belongs somewhere that is neither this VPS nor this repository — the same
  category of secret as `NUXT_TOTP_ENCRYPTION_KEY`, and the same failure mode.
- **Host keys are pinned, not accepted on first use.** A backup that trusts
  whatever answers at the remote's address can be redirected by DNS alone.
  `ssh-keyscan -H <storagebox-host> > docker/restic_known_hosts`.
- **The SSH key should be restricted on the remote to the one repository path.**
  A backup job that can also delete the remote turns one compromised host into
  the loss of both copies at once.

### Proving it, which is the part that was missing

`docker/restore-drill.sh` restores a real snapshot into a throwaway PostGIS
container, asserts the tables that cannot be regenerated actually carry rows,
checks that geometry reads back (`ST_X` on a restored `sites.geom` — a restore
that lost PostGIS leaves the column present and every value unreadable), and
throws the container away. `--offsite` pulls from restic instead of a local file,
which is the version that proves the remote.

Verified once against a real 58 MB dump: 61,273 sites, 11,720 tracings, 39,213
images, all 61,273 geometries readable.

**One trap, found by running it.** The postgres image's entrypoint starts a
_temporary_ server during initialisation with `listen_addresses` empty. A plain
`pg_isready -U vestigian` passes against that one, so a restore begins and then
initdb shuts the server down underneath it — surfacing as
`PQputCopyData: server closed the connection unexpectedly` partway through a
COPY, which reads exactly like a corrupt dump and is not one. The drill probes
`pg_isready -h 127.0.0.1` instead: the init server is not listening on TCP, so
waiting on TCP skips it entirely.

### Knowing when it stops

The failure this whole path exists to prevent is not a backup that errors, it is
one that quietly stopped months ago. `backup.sh` prints one `backup.outcome=`
line per stage per run, Alloy already ships every container's stdout to Loki, and
`docker/observability/rules/fake/backup.yml` turns that into four alerts —
nothing dumped in 26h, any stage failing, dumps succeeding but **not leaving the
machine**, and no `restic check` passing in nine days.

This needed a Loki **ruler**, which the deployment did not have: `alerts.yml` is
Prometheus-only (PromQL), and the backup container has no scrape endpoint and no
reason to grow one. The ruler block in `loki.yml` points at the same Alertmanager
the Prometheus rules use. The `fake/` directory level inside `rules/` is Loki's
own tenant name when `auth_enabled: false` — renaming it to something tidier
stops the rules loading. Verified by booting Loki against the real config and
reading back all four rules from `/loki/api/v1/rules`.

**Upgrading an instance that ran the old image needs one manual step.** The
container now runs as `postgres` (uid 70) rather than root. Docker seeds
ownership into a _fresh_ named volume from the image and never revisits it, so a
`backup-data` volume created under the previous root-running image stays
root-owned and the first dump fails on a permission error:

```bash
docker run --rm -v vestigian_backup-data:/b alpine chown -R 70:70 /b
```

Data is CC BY-SA (text) / CC0 (metadata); **image licences vary per record**, which is why `licence` and `attribution` are non-null columns and attribution renders under every image rather than hiding behind an interaction.

## Security layer — detection, and where it is enforced

CrowdSec reads the app's own structured logs (route pattern plus an `audit`
vocabulary, which is far more precise than a status code and a path) and writes
decisions. AppSec covers the WAF slot in the same ~150 MB engine — virtual
patching plus generic SQLi/XSS rules — which is why no separate WAF container
exists. Config and the full reasoning: `docker/security/README.md`.

**Nothing is enforced yet.** A decision does nothing until a bouncer reads it,
and the right place is the Bunny edge rather than this box: CrowdSec, Traefik's
limiter and the Valkey limits all run _after_ a request has paid for a TCP
connection and a TLS handshake. Hetzner's included DDoS protection covers L3/L4
and explicitly not L7 HTTP floods, so those can only be absorbed at the edge.

Rejected, with reasons, so they are not revisited by default: **fingerprinting**
(EDPB 2024 puts it under GDPR _and_ ePrivacy, and it duplicates ALTCHA plus
email verification plus trust 0); **fail2ban** (behind any CDN it bans edge
addresses); **SafeLine** (2 vCPU / 4 GB, and it would replace Traefik);
**Coraza** (the WASM Traefik plugin ships no CRS; the fast one is Traefik Hub);
**KrakenD** (an API gateway, not a WAF); **Wazuh** (6–16 GB for the indexer);
**Zeek/Snort/Suricata** (network IDS, and the traffic is TLS).

## Deployment

`docker/compose.prod.yml` is the deployment unit. GitHub Actions builds a
multi-stage image to GHCR and calls a Dokploy webhook. Traefik terminates TLS.
Nightly `pg_dump` kept 14 days locally, plus restic off-box — see "Backups".

**CI deliberately runs no tests, lint or typecheck.** That is a settled decision,
not an oversight: `pnpm check` is the pre-push hook, and the hosted minutes go to
the one thing that cannot be done locally — building and publishing the image.
`deploy.yml` used to carry a `verify` job whose entire body was
`pnpm install --frozen-lockfile`, which proved only that the lockfile resolves —
something the image build re-proves a minute later on its own. It also ran on
`pull_request`, where `publish` is skipped, so a PR started the workflow to do an
install and then stop. It was removed rather than filled in.
`changeset-check.yml` is what actually runs on a pull request.

**`corepack enable` in the Dockerfile was a live outage, not a latent one.**
Node 26 unbundled corepack (deprecated in 25, gone in 26), so `RUN corepack
enable` failed with `corepack: not found` and _every_ image build died on line 7
— meaning no image reached GHCR and the Dokploy webhook never fired, silently,
for as long as the base image had been on 26. It is now
`npm i -g corepack@latest && corepack enable`, which restores the shim and keeps
`packageManager` in `package.json` as the single place the pnpm version lives.
Worth remembering as a shape: a broken _publish_ step fails loudly in Actions but
looks like nothing at all from the outside, because the running site keeps
serving the last image that did build.

**One VPS is one failure domain.** Test the restore, not just the dump —
`docker/restore-drill.sh` is how, and it is not a drill until somebody runs it.

To move from OpenFreeMap to self-hosted tiles: download a Europe + Mediterranean extract from maps.protomaps.com, upload to R2, set `NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles` and `NUXT_PUBLIC_BASEMAP_PMTILES_URL`.

## Versioning & releases

Semantic versioning, via [Changesets](https://github.com/changesets/changesets)
— not Conventional-Commits-driven tooling (`semantic-release`,
`standard-version`). Those infer the bump from a commit message prefix, and
this repo's `commit-msg` hook (`scripts/verify-commit-msg.ts`) deliberately
protects the opposite: a lowercase, imperative subject with **no** type
prefix, checked structurally (length only), not rewritten to fit a
convention. A changeset is a small file under `.changeset/`, independent of
the commit message, that records what changed and how it should move the
version — see `.changeset/README.md` for the contributor-facing how-to and
what warrants patch/minor/major on a `private: true` app that is never
published to a registry.

**Releases are cut by hand, not on every push.** `.github/workflows/release.yml`
used to run on every push to `main`, apply pending changesets, commit the
bump with `[skip release]`, tag, and cut a GitHub Release — automatically,
with no branch, PR or human decision in the loop. It raced: a bot committing
and pushing straight to `main` outside of any branch could land at the same
moment as a person's own push, diverging `main` and rejecting the person's
push with "Updates were rejected because the remote contains work that you
do not have locally" — confusing, since nothing had actually conflicted, two
unrelated commits had simply landed on the same ref back to back.

`release.yml` now triggers only on `workflow_dispatch` — a maintainer opens
the Actions tab, picks **release**, and chooses a `bump` (patch/minor/major)
from a dropdown before it runs. That one click is what used to happen
silently on every push, so the same race is now something a maintainer has
to choose to do, not something that ambient pushes trigger on their own.

The `bump` input is a **floor, not an override**: Changesets bumps a package
by the highest severity among its pending changeset files, and there is no
CLI flag to force a lower one. The workflow writes one throwaway changeset
at the chosen level before running `changeset:version`, which guarantees
the release is at least that severity — but a pending changeset already
recorded as `major` still produces a major release even if `patch` was
picked in the dropdown, since silently downgrading a documented breaking
change would be the more dangerous of the two surprises. Check
`changeset:status` before releasing if that distinction matters.

**The secondary path is a branch/PR.** `.github/workflows/changeset-check.yml`
runs on `pull_request` against `main` and reports (does not block — no
branch protection currently depends on it) when a branch changes app code
with no changeset alongside it. Docs-only, `.github/`-only, or
`.changeset/`-only diffs are exempt.

**`deploy.yml`'s image is tagged with the version, not just `latest` and the
commit SHA** — `ghcr.io/.../vestigian:v0.2.0` alongside the two it already
carried, read from `package.json` at build time via `jq`, so a specific
released version can be pulled or rolled back to by tag rather than only by
remembering a SHA.
