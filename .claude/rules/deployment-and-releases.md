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
atlas is readable in the clear. `RESTIC_REPOSITORY` is `/offsite/restic`, a
directory on **netcup Storage Space** — mounted over NFS on the host
(`RESTIC_OFFSITE_DIR`) and bind-mounted into the container. Same provider as the
VPS, but an external storage cluster, not the VPS's own disk.

Everything `RESTIC_*` is optional. With nothing configured the service behaves
exactly as it always did and says so once per run, so an instance that has not
set this up is not broken, only unprotected — and says which.

Three details that are deliberate rather than incidental:

- **`RESTIC_PASSWORD` _is_ the backup.** restic encrypts client-side and has no
  recovery path; losing it makes every off-box snapshot permanently unreadable.
  It belongs somewhere that is neither this VPS nor this repository — the same
  category of secret as `NUXT_TOTP_ENCRYPTION_KEY`, and the same failure mode.
- **A missing mount must not look like a backup.** If the NFS mount is absent, the
  bind source is an empty directory on the VPS's own disk and restic would write
  the "off-box" copy there. `backup.sh` therefore refuses unless
  `/offsite/.vestigian-offsite` exists — a marker created once on the Storage
  Space — and reports `reason=offsite-not-mounted`.
- **Known weakening against the earlier SFTP design:** an SFTP key could be
  restricted to one path; an NFS mount is writable by anything on the VPS that
  can reach it, so a compromised host can delete the repository as well as write
  it. restic's client-side encryption protects confidentiality, not deletion.
  Access is by registered IP address, not credentials. Treat the Storage Space as
  a second copy, not an immutable one, and keep the local dumps.

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
machine**, and no `restic check` passing in nine days — and three more about
retention, below.

**Does it fill the VPS up? No, by construction — and since 2026-10-13 it says so every night.**
The local dumps are pruned by `find -mtime +14 -delete` after each successful dump (about 15
files, ~60 MB each in the restore drill ≈ 0.9 GB on the `backup-data` volume); the restic
repository is on the Storage Space, not the VPS disk, and `restic forget --keep-daily 14
--keep-weekly 8 --prune` runs after every push (at most 22 snapshots, deduplicated). The restic
cache lives in the container's own layer and is bounded by repository metadata. What was missing
was any _check_ that the plateau holds, so `backup.sh` now prints one
`backup.outcome=ok stage=retention scope=local files=N bytes=B` and one
`... scope=offsite snapshots=N` per run, and three rules read them: `BackupLocalDumpsNotPruned`
(> 17 files), `BackupLocalVolumeLarge` (> 4 GiB) and `BackupRepositoryNotPruned` (> 26 snapshots).
They take the _latest_ report in 26 h and so clear themselves; with no report they stay quiet —
`BackupNotRunning` is the rule for absence, and wrapping these in `or vector(0)` would page on it
twice. Verified by loading the rules into a throwaway Loki 3.4.2 with the repo's `loki.yml` and
evaluating each in three states (healthy, over the limit, no logs). **Not verified: the numbers on
the real VPS** — nothing here can read that volume; `docker exec` into the backup container and
`ls -l /backups` is the one-minute check. The daily alert is `BackupNotRunning` (no successful
dump in 26 h, evaluated hourly).

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

## Response headers, and the Bunny setting no repo file controls

Every response now carries a verified, complete security-header set —
`Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Cross-Origin-Resource-Policy` on every route, plus CSP,
`Permissions-Policy`, COOP and COEP on rendered HTML — and a `cache-control`
that defaults to `private, no-store` everywhere and is opted out of per route
only where the response has been read and confirmed not to depend on a
session or a cookie. See `nuxt.config.ts`'s `routeRules` and
`server/middleware/security-defaults.ts` for what sends which header and why
two mechanisms exist (`nuxt-security`'s own delivery of a handful of these —
`strictTransportSecurity` specifically — silently fails outside HTML
responses; both the failure and the workaround were verified against a
running production build, not inferred from its docs).

**None of that protects anything if the Bunny pull zone in front of this app
is configured to ignore it.** Bunny pull zones have an "Override Cache
Control" / "Query String Sorting" style setting that, if enabled, caches every
200 response for the zone's own configured TTL regardless of what the origin
sends — which would cache `private, no-store` responses (a moderator's queue,
`/api/me`, a GDPR export) at the edge and serve them to the next visitor who
hits the same URL, the exact cross-user leak `/api/sites/**`'s `private`
cache-control was already written to prevent. This setting lives in the
Bunny dashboard, not in this repository, so it cannot be checked here —
confirm it is **off** for the zone in front of `SITE_HOST` (the images zone is
a separate concern: those responses are keyed by imgproxy URL, not session,
and are meant to be cached hard) before trusting any of the reasoning above in
production. The same check belongs on `docker/traefik/dynamic.yml`'s
`security-headers` middleware, whose own values now overlap and in two cases
disagree with the app's — see the comment there.

## Security layer — detection, and where it is enforced

CrowdSec reads the app's own structured logs (route pattern plus an `audit`
vocabulary, which is far more precise than a status code and a path) and writes
decisions. AppSec covers the WAF slot in the same ~150 MB engine — virtual
patching plus generic SQLi/XSS rules — which is why no separate WAF container
exists. Config and the full reasoning: `docker/security/README.md`.

**Enforcement is the Bunny bouncer** (`docker/security/bunny-bouncer/`), which
mirrors CrowdSec's decisions onto the site pull zone's blocked-IP list. The
right place is the Bunny edge rather than this box: CrowdSec, Traefik's limiter
and the Valkey limits all run _after_ a request has paid for a TCP connection
and a TLS handshake. A VPS provider's DDoS protection works at L3/L4 and does
not absorb L7 HTTP floods, so those can only be absorbed at the edge.

What was learned getting it to work (2026-10-03 to 10-08), all against the real
account unless marked otherwise:

- **The Edge Rule design failed and was replaced.** One rule with a `RemoteIP`
  trigger rewritten on every change answered `"Maximum 5 triggers are allowed
per condition"` from the poller while the same payload succeeded by hand. The
  cause was never found; the bouncer now uses `addBlockedIp` /
  `removeBlockedIp` (`{ "BlockedIp": "<ip>" }`, 204), one call per IP.
- **Bunny holds at most 100 blocked entries per pull zone.** The API
  reference does not say so; the 101st call returns 400 `The Pull Zone already
has 100 blocked IPs`. The community blocklist (`CAPI`/`lists` origins) is
  thousands of addresses and filled it at once, so only decisions with origin
  `crowdsec` or `cscli` are mirrored (`BUNNY_ENFORCED_ORIGINS`). "crowdsec"
  includes the hub collections' detections, not only the four local scenarios.
- **Single IPv4 and IPv6 addresses block** (403 from a real client). IPv4
  wildcards (`a.b.c.*`) are accepted by Bunny and the bouncer maps `/16` and
  `/24` range decisions onto them — **not yet tested live**. Both IPv6 range forms were
  **rejected** by the dashboard (`2a02:…:6471:*` and `2a02:…:6471::/64`), so the blocked-IP
  list cannot hold an IPv6 range at all and those decisions are skipped; an IPv6
  abuser rotating inside a /64 is blocked address by address only.
- **`curl` prefers IPv6.** A ban on an IPv4 address looked like it did nothing
  because the test request went over IPv6. Test with `curl -4` / `curl -6`.
- **The list belongs to the bouncer** (`BUNNY_PRUNE_UNKNOWN`, default `true` in
  compose): at startup and every 10 minutes anything CrowdSec does not
  currently ban is removed. The decision stream reports changes, never state,
  so a removal missed once (restart, outage) would otherwise stand forever;
  stale entries found this way were the "3 IPs nobody could explain".
  Consequence: a block added by hand in the Bunny dashboard disappears within
  10 minutes. Set it `false` if the list is ever maintained manually.
- **Bans lift by themselves**: an expired decision arrives in the stream's
  `deleted` list and is removed within one poll (15 s).
- **Ban lengths are set in `docker/security/profiles.yaml`**, mounted into the
  `crowdsec` service. Without it CrowdSec applies its packaged default, 4 h for
  everything (checked against v1.6.11's `config/profiles.yaml`). First ban /
  escalation ladder in hours: `rate-limit-abuse` 1/6/24/72 (the only
  confidence-2 scenario, so the gentlest), `route-scanning` 1/24/72/168,
  `login-bruteforce` 2/24/72/168 (shared NAT can trip it), `registration-enumeration`
  4/24/72, hub-collection scenarios 4/24/72/168, ranges a flat 4. Short first
  bans exist because of Bunny's 100-slot cap. **Verified** in a throwaway
  v1.6.11 container with the real parser and scenarios: first bans came out at
  4h/2h/1h/1h, and a repeat offence got the second tier both while the earlier
  ban was active and after it had expired (`GetDecisionsCount` still counted
  it). **Unverified:** how long an expired decision keeps counting before
  CrowdSec garbage-collects it, i.e. whether an offender returning after days
  still escalates. Profiles are order-sensitive (`on_success: break`), so a new
  scenario's profile goes above the catch-all.
- **`cscli decisions list` hides community decisions**; use `-a`. An empty
  list means no active local decisions, so nothing has a remaining time to show.
- **Not yet proven live:** `/16` and `/24` wildcards, a burst of ~50 decisions
  (does Bunny answer 429?), propagation delay after an add, and that
  `DISABLE_ONLINE_API: 'false'` is acceptable (it still downloads the community
  list, which nothing enforces, and shares signals — the open GDPR decision in
  `documents/runbook_prod.deployment.md` §19).

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

**Toolchain pinning — Volta for people, `package.json` for CI.** `volta.node`
and `volta.pnpm` in `package.json` pin the exact versions a developer's shell
switches to on `cd`. Both workflows read the same field through
`actions/setup-node`'s `node-version-file: package.json`, which looks for
`volta.node` before `engines.node` (checked against setup-node's
`docs/advanced-usage.md`), so a bump is one edit, not three. `volta.pnpm` must
stay equal to `packageManager`: corepack in the image and `pnpm/action-setup`
in CI read the latter, Volta reads the former, and they disagreeing is two
lockfile writers. Volta manages pnpm only with `VOLTA_FEATURE_PNPM=1`; without
it the shell falls through to whatever global pnpm exists. **The Dockerfile is
not covered** — `node:26-alpine` floats within the major; pinning the tag too
would make every Node patch a Dockerfile edit, which was not taken on here.

**One VPS is one failure domain.** Test the restore, not just the dump —
`docker/restore-drill.sh` is how, and it is not a drill until somebody runs it.

To move from OpenFreeMap to self-hosted tiles: download a Europe + Mediterranean extract from maps.protomaps.com, upload to R2, set `NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles` and `NUXT_PUBLIC_BASEMAP_PMTILES_URL`.

**`compose.prod.yml`'s `environment:` block is an allowlist, not a passthrough.**
Dokploy's "Environment" tab only fills `${VAR}` substitutions that this file
actually references; it does not inject arbitrary operator-set vars into the
container. Setting `NUXT_PUBLIC_SOMETHING=true` in Dokploy does nothing unless
a line like `NUXT_PUBLIC_SOMETHING: ${SOMETHING}` already exists here — this is
why `NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED` (the licence gate documented
beside `tabulaPeutingerianaEnabled` in `nuxt.config.ts`) had to be added to this
file before the flag could be turned on in production at all; the key existing
in `.env.example` only covers `pnpm dev`, which reads `.env` directly.

**Migrations run as a one-shot `migrate` service in `compose.prod.yml`**, same image as the
app, `app` waiting on `service_completed_successfully`. The runtime image holds only `.output`
plus the SQL folder, so the migrator is bundled into `.output/migrate.mjs` by `pnpm build:migrate`
(esbuild; Nitro's trace of the app omits drizzle's migrator). It was missing at first — nothing
ran migrations in production, and the reference-layers release logged
`relation "antiquity_hillforts" does not exist`. Consequences: migrations must stay additive
(the old app serves against the new schema between the two steps), and a failing one leaves the
old `app` container running. Manual fallback with tracking rows: runbook §14a.

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

## `compose.dev.yml`'s imgproxy was hardcoded to MinIO, with no way to point it anywhere else

Reported as "opening sites gives a 404 on pictures" in a dev environment whose
`.env` had `NUXT_STORAGE_ENDPOINT`/`BUCKET`/credentials overridden to point at
a real Bunny bucket instead of the local MinIO container (`.env.example`'s own
documented default) — presumably done deliberately, to see real mirrored
photographs while testing rather than empty galleries. Verified the object
genuinely existed and the credentials genuinely worked first, with a standalone
`@aws-sdk/client-s3` `HeadObjectCommand` against the real endpoint (679 KB,
`image/jpeg`) — confirming the gap was in this compose file, not the data or
the credentials.

`imgproxy`'s own `IMGPROXY_S3_ENDPOINT`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
were hardcoded to the MinIO container's own service name and dev credentials,
with no override path at all — so changing `NUXT_STORAGE_*` for the app (which
reads it fine, since Nitro reads `.env` directly) did nothing for imgproxy,
which never saw the new endpoint. Every `s3://vestigian-images/...` source URL
`buildImageUrl` built kept resolving against an empty local bucket.

Fixed with one new override var, `IMGPROXY_STORAGE_ENDPOINT` (defaults to
`http://minio:9000`, i.e. unchanged for the common case), and by pointing
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` at the app's own
`NUXT_STORAGE_ACCESS_KEY_ID`/`SECRET_ACCESS_KEY` instead of duplicating them —
those identify the same bucket either way, only the endpoint's reachability
differs between imgproxy (inside the compose network, needs `minio:9000`) and
the app (on the host via `pnpm dev`, needs `127.0.0.1:9000` or a real public
host like Bunny's). Documented in `.env.example` next to `NUXT_STORAGE_*`.

**The substitution needed a second fix to actually take effect.** `${VAR}`
compose-file substitution reads a `.env` file relative to Compose's _project
directory_, which with `-f docker/compose.dev.yml` and no `--project-directory`
defaults to `docker/` — not the repository root, where the real `.env` lives
(confirmed with `docker compose ... config`, which kept printing the hardcoded
fallback defaults even after the var was set in the root `.env`). None of this
compose file's other values ever used `${...}` before, which is exactly why
this had never surfaced: every `stack:*` script in `package.json` now passes
`--env-file .env` explicitly so substitution reads the root file regardless of
where the compose YAML itself lives.

Applying a changed env var to a running container needs `--force-recreate`
(or `down`/`up`) — a bare `up -d` reports the container as already `Running`
and leaves its old environment in place, confirmed by `printenv` inside the
container before and after.
