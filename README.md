# Vestigian

An atlas of the traces antiquity left behind — settlements, roads, fortifications and findspots, recorded by the people who go and look at them.

Built on data contributed to [Vici.org](https://vici.org) by René Voorburg and its contributors, reused under CC BY-SA. Vestigian is an independent reimplementation, not a fork of the vici.org codebase.

## Getting started

### Prerequisites

| Tool                                                       | Version    | Why                                                                      |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| [Node.js](https://nodejs.org)                              | ≥22        | Runs the app and every `tsx` script                                      |
| [pnpm](https://pnpm.io/installation)                       | 9.x        | This repo's package manager — `packageManager` in `package.json` pins it |
| [Docker](https://docs.docker.com/get-docker/) + Compose v2 | any recent | Postgres/PostGIS, Valkey, MinIO, imgproxy, Mailpit — the whole dev stack |
| `openssl`                                                  | any        | Generates the session and ALTCHA signup secrets                          |

No database, cache, or object store to install by hand — the entire dev stack is one `docker compose` file, and `NUXT_PUBLIC_BASEMAP_PROVIDER=openfreemap` (the default) means no map API key either.

### One command

```bash
pnpm install
pnpm setup
```

`pnpm setup` (`scripts/setup.sh`) checks the prerequisites above, creates `.env`
from `.env.example` with a real, freshly generated `NUXT_SESSION_PASSWORD` and
`NUXT_ALTCHA_SECRET` (everything else in `.env.example` is already a working
local default), brings up the dev stack, and applies the database schema. It
is safe to re-run: an existing `.env` is left untouched, and both the stack
and the migrations are idempotent.

It deliberately stops there. The next step — importing real data — is a
multi-hour crawl of someone else's server and has no business running
unattended from a setup script; see "Importing the vici.org data" below.

```bash
pnpm dev   # → http://localhost:3000
```

The map runs against OpenFreeMap out of the box, so nothing needs an API key to see it working. Site data will be empty until you run the import.

### By hand, if you'd rather

`pnpm setup` is exactly the following, in case you want to run it yourself or adapt a step:

```bash
cp .env.example .env          # then set NUXT_SESSION_PASSWORD and NUXT_ALTCHA_SECRET
pnpm install
pnpm stack:up                 # postgres+postgis, valkey, minio (+bucket), imgproxy, mailpit
pnpm db:generate && pnpm db:migrate
pnpm dev
```

## Importing the vici.org data

Four resumable steps rather than one command, because the middle of it is a
multi-hour crawl of someone else's server. Run them in order; each one is safe
to re-run and picks up where it stopped.

```bash
# The scratch MariaDB is NOT part of pnpm stack:up — the dumps are read once
# and thrown away, so it lives outside the application's stack.
docker run -d --name vici-mysql -p 3307:3306 \
  -e MARIADB_ROOT_PASSWORD=root mariadb:11

pnpm import:fetch           # 1. dumps → scratch MariaDB
pnpm import:convert         # 2. → sites, tracings, external_ids
pnpm import:image-records   # 3. → site_images rows, no bytes fetched
pnpm import:images          # 4. → photographs into object storage
pnpm tiles:warm http://localhost:3000
```

| Step                   | Reaches                                                                                                                                                | Cost                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `import:fetch`         | `vici` and `geo` loaded into MariaDB on port 3307                                                                                                      | ~105 MB download, minutes |
| `import:convert`       | **61,272 sites, 11,720 tracings, 8,692 concordances** in PostGIS — the map is fully usable at this point                                               | ~10 minutes               |
| `import:image-records` | 39,212 `site_images` rows over **36,216 distinct objects**, with resolved licences, attribution and source URLs. Touches nothing outside your database | ~2 minutes                |
| `import:images`        | the photographs themselves in object storage                                                                                                           | **~12 hours, ~10 GB**     |

Step 1 skips the download entirely if the dumps are already present — drop
`vici.sql.gz` and `geo.sql.gz` into `db_dumb/` (or set `VICI_DUMP_DIR`) and it
uses those. Files are validated by their gzip magic number, because GitHub
answers a _page_ URL with a perfectly ordinary 200 and an HTML body.

### Where the photographs actually live

Photographs are served from
`images.vici.org` through a transform service, and originals are not exposed there at all.

The mirror therefore requests `https://images.vici.org/size/w{width}/uploads/{file}`
— **width only**. `size/w2400xh2400` and `crop/w2400xh2400` both return exactly
that box and distort or crop anything that is not square. The width is capped at
each image's recorded width so a small original is never upscaled.

One consequence worth knowing: **2400px is a permanent ceiling** for imported
photographs, because true originals cannot be fetched. That is forced by the
source, not chosen.

Images whose licence string cannot be resolved to a known licence are imported
but left unpublished. That is deliberate — an ambiguous licence should never
quietly appear on the public map under a guessed one.

## How the map stays fast

The viewport requirement is answered by vector tiles generated in Postgres, not by bbox queries:

- `/api/tiles/{z}/{x}/{y}.mvt` runs `ST_AsMVT` against a GiST index and returns a binary tile.
- Below zoom 9 the tile contains counted clusters; above it, individual sites plus simplified tracings.
- Tiles are cached in Valkey under a data-version prefix. Approving a revision bumps one counter and invalidates everything at once.
- MapLibre requests only newly exposed tiles when panning, so movement costs almost nothing after the first paint.
- Tiles carry an id and a label only. Descriptions and images arrive from `/api/sites/:id` when a feature is opened, which keeps tiles small and cacheable far longer than editable content would allow.

## Contribution and moderation

Every change is written to `revisions` before it touches a live table. New accounts are queued; after **two accepted contributions** an account's edits publish immediately. A moderator can revoke that at any time, and no moderator can approve their own submission.

Signup is protected by a self-hosted ALTCHA proof-of-work challenge, a honeypot field, per-IP rate limiting and email verification. Registration reports a duplicate email or display name as a 409 so the form is not a dead end — a deliberate trade of the enumeration guarantee, throttled by the challenge and the rate limit.

## Architecture

```
app/
  components/     map · site · contribute · auth · moderation · ui
  composables/    map · data · auth · ui   (unit tests in __test__/)
  layouts/ pages/ middleware/
server/
  api/            tiles · sites · auth · contributions · moderation · health
  database/       drizzle schema and migrations
  utils/          mvt · trust · permissions · ratelimit · images · argon (tests in __test__/)
shared/types/     the vocabulary both sides share
scripts/import/   the four-stage vici.org import
scripts/          snapshot-database · reconcile-images · warm-tiles
docker/           Dockerfile, dev and production compose, Traefik
```

Components put `<script setup>` before `<template>`, use inline Tailwind, and keep lifecycle hooks at the bottom of the script block.

## Deployment

One VPS, Docker Compose, orchestrated by [Dokploy](https://dokploy.com). Roughly €27/month including object storage:

|                   |                                             |
| ----------------- | ------------------------------------------- |
| Hetzner CPX41     | app, Postgres, Valkey, imgproxy, Traefik    |
| Cloudflare R2     | images and the PMTiles basemap, zero egress |
| Cloudflare (free) | CDN                                         |

`docker/compose.prod.yml` is the deployment unit. GitHub Actions builds a multi-stage image to GHCR, and calls the Dokploy webhook.

The app is strictly 12-factor — env-only config, no local disk writes, `/api/health` and `/api/ready` probes — so moving to Kubernetes later is a translation rather than a rewrite.

**One VPS is one failure domain.** The `backup` service dumps Postgres nightly and keeps fourteen days. Test the restore, not just the dump.

### Switching to self-hosted basemap tiles

```bash
# A Europe + Mediterranean extract, roughly 15–25 GB
# Download from https://maps.protomaps.com and upload to R2, then:
NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles
NUXT_PUBLIC_BASEMAP_PMTILES_URL=https://your-bucket.r2.dev/europe.pmtiles
```

PMTiles is read directly by the browser over HTTP range requests. There is no tile server to run.

## Testing

```bash
pnpm test
```

Coverage is intentionally narrow: tile planning, trust and permission rules, rate limiting, licence normalisation, slug transliteration and the geolocation geometry. These are the places where a silent bug is expensive.

## Licensing

Site text and descriptions: CC BY-SA. Metadata: CC0. Images carry their own licence per record, which is why `licence` and `attribution` are non-null columns and why attribution is rendered under every image rather than hidden behind an interaction.

## Accounts and email

Registration issues a hashed, single-use token and emails a confirmation link. Mail goes through **Lettermint**, hosted in the EU — the same reasoning that moved the CDN and the object store there. `NUXT_MAIL_API_KEY` is a Lettermint project token.

Both messages — confirmation and password reset — are rendered as a sheet from the notebook: the wordmark, one oxide button, and the facts that matter set in the mono face (which account, when it was requested, when the link expires, that it works once). Every message carries a plain-text half saying the same things.

In development no key is needed. Mail is posted to **Mailpit**, which `pnpm stack:up` already starts; read it at <http://localhost:8025>, styling and all. With Mailpit down the message is written to the server log instead, so the flow still works with nothing running but the app.

Six messages exist, and every one of them reports something about the reader's own account:

| When                                       | What it says                                                         |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Registration                               | Confirm this address; the link lasts a day                           |
| Forgotten password                         | Set a new one; the link lasts an hour and works once                 |
| Password reset completed                   | It was changed, and how to take the account back if that was not you |
| Signing in before confirming               | A fresh confirmation link, at most one per quarter of an hour        |
| A contribution reviewed                    | Published or not, with the moderator's note and a link to the record |
| Automatic publishing suspended or restored | What changed, and that accepted contributions are untouched          |

- Verification links last a day; password reset links last an hour and void every other outstanding link for that account.
- Only the SHA-256 hash of a token is stored, and comparison is constant-time.
- `forgot-password` answers identically whether or not the address exists, and a mail provider outage cannot break that: delivery failures are logged and counted, never thrown.
- Resetting a password does not sign you in — that is deliberate.

## Uploads

`POST /api/contributions/images` accepts one photograph per request. The declared content type is treated as a hint only: the format is read from the file's leading bytes, and every image is re-encoded through sharp, which strips EXIF and guarantees the stored object is a plain JPEG. Storage keys are derived from database identifiers, never from the uploaded filename.

Licences are chosen from a closed list at upload time, since an image with an unresolved licence cannot be published.

## Public data

`GET /api/data/sites.geojson?bbox=west,south,east,north` returns approved sites as GeoJSON with licence and attribution on every feature, CORS-open and bounded to 1000 records per request. RDF and a Pelagios-compatible gazetteer dump are the natural next step if you want other projects to link to Vestigian's places.

## Operations

### Observability

Six containers — Grafana, Loki, Tempo, Prometheus, Alertmanager and Alloy —
all writing to local disk. About 1.6 GB of RAM and under 20 GB of the 240 GB
disk, on the same CPX41. No additional hosting cost.

Grafana is **not** exposed publicly. It holds request logs, which contain
visitor IP addresses, so it binds to loopback and is reached over SSH:

```bash
ssh -L 3001:localhost:3001 <vps>   # then http://localhost:3001
```

Locally it is opt-in, because the fast loop is Pino pretty-printing to the
terminal rather than a browser tab:

```bash
pnpm stack:observability        # grafana :3001, loki, tempo, prometheus, alloy
pnpm stack:observability:down
```

Retention is 15 days of metrics, 30 days of logs and 7 days of traces. Tile
requests are traced at 5% — a single map pan is dozens of them — and everything
else at 100%.

The alert worth knowing about is `RateLimiterFailingOpen`. Rate limiting lives
in Valkey and fails open, so a cache outage silently removes every limit in
`RATE_LIMITS`; that counter is the only evidence it happened.

## Backups — two stores, restored together

The database and the object store are separate, and they fail apart. The records
are reproducible (`import:convert` rebuilds them in minutes); **the mirrored
photographs are not** — losing them means refetching.
That inverts the moment the first real contribution lands, since accounts,
revisions and uploads exist nowhere else.

```bash
pnpm db:snapshot        # → .import/snapshots/vestigian-<stamp>.dump  (~15 MB)
pnpm images:reconcile   # do the database and the bucket still agree?
```

`db:snapshot` uses `pg_dump` if it is installed and otherwise goes through the
compose Postgres service, so the client version always matches the server. A
dump that fails deletes its own file — a half-written dump that looks restorable
is worse than none.

`images:reconcile` exists for one silent failure: restore a database newer than
the bucket, and rows sit at `approved` describing objects that are gone. The
gallery renders broken images while every query reports health. It reports three
states — `missing`, `unstored`, `orphan` — and `--repair` returns missing rows to
`pending` so the mirror refetches them. Orphans are only reported: withdrawal is
reversible by design here, and nothing in this project deletes bytes.

To keep a portable copy of the photographs — the Docker volume only restores
back into MinIO — mirror the bucket out as ordinary files:

```bash
docker run --rm --network container:vestigian-dev-minio-1 \
  -v "$PWD/image-archive:/out" minio/mc:latest sh -c \
  "mc alias set src http://127.0.0.1:9000 vestigian vestigian-dev-secret && mc mirror src/vestigian /out"
```

Reverse the arguments to restore into a fresh bucket. Add `image-archive/` to
`.gitignore` first: at ~10 GB it must not go near git.

Re-running `import:images` after a database rebuild does **not** re-download
anything. An object already in storage is adopted — read back locally,
re-measured, marked approved — with no request to vici.org and no pause between
items.

**After every deploy or bulk import, warm the tile cache:**

```bash
pnpm tiles:warm https://vestigian.org
```

The only predictable slow moment is the minutes after a data-version bump, when the low-zoom clustered tiles are all generated at once by real traffic. There are a few hundred of them over the data's extent, so warming takes seconds and removes the spike.

`/robots.txt` and `/sitemap.xml` are generated from the database. Tiles and search are disallowed — crawling the tile pyramid would produce millions of requests for content worthless in an index.

## Editing and history

The atlas is no longer append-only.

- **Edit** at `/site/[slug]/edit`, reachable from both the map panel and the full entry. Edits carry an optional note explaining the change, which is what makes the history readable later.
- **File history** on every site page: who changed what, when, and whether it was auto-published or reviewed. Each entry expands into a field-level diff.
- **Revert** is a moderator action that writes a _new_ revision restoring the earlier state, rather than deleting the offending one. History stays append-only, so the record of what was reverted and by whom survives.
- **Slugs never change on edit.** A renamed site keeps its URL, because inbound links and citations point at it.

Two safeguards sit on top of the trust rule:

- An edit that **removes more than it adds** is queued for review even from a trusted account. A wrong auto-approval on a blanking edit costs far more than a moderator glance.
- The queue flags **substantial rewrites** so a moderator can triage a corrected date differently from a replaced description.

## Tracings

Tapping a traced route opens its own panel, with the course length computed by PostGIS on the geography type rather than in Mercator, so a road across Britain and one across Sicily are measured the same way.

`/tracing/[id]/edit` loads the existing shape into the draw tool in select mode, so editing starts by dragging the points that are already there rather than redrawing from scratch.

## Moderator tooling

- **Review queue** with field-level diffs, flagged for substantial rewrites and blanking edits.
- **Revert** from any site's history.
- **Contributors** at `/moderation/contributors`: suspend or restore automatic publishing, and — for administrators — change roles.

Suspension leaves the accepted-contribution count untouched, so restoring trust returns someone to exactly where they were. Three rules guard role changes: only admins may make them, nobody may change their own, and the last admin cannot be demoted, because an instance with no administrator has no way back short of database surgery.

## Photographs

Managed from a site's edit page: reorder, correct the caption or credit, and withdraw.

Withdrawing marks the row rejected and leaves the object in storage. A hard delete would destroy the audit trail, and a takedown request needs a record that the image was removed and when — as well as letting a moderator reverse a mistaken removal. Purging stored objects is a separate, deliberate operation.

The first image in the order is the one the map uses, so ordering is editorial rather than cosmetic.

## Bulk review

The queue supports multi-select with publish-all and reject-all, capped at fifty. Each revision is decided independently and failures are reported per item rather than thrown: one revision that cannot be applied must not silently abandon the other forty-nine. A failed item is rolled back to pending so it returns to the queue rather than sitting in an ambiguous half-reviewed state.

## What is not built yet

Honest list, so nothing here is a surprise:

- **Purging withdrawn images** from object storage. Withdrawal is reversible by design; there is no operation that actually deletes bytes.
- **Notifications.** A contributor learns their edit was accepted by looking, not by being told.
- **Full-text search across descriptions.** Search covers titles and summaries only.
- **RDF / Pelagios output.** The GeoJSON feed exists; linked data does not.
- **Image reordering and deletion** — `sort_order` exists and is unused.
- **Offline tile caching.** The app is installable; it does not work without signal.
- **Off-box backups.** `docker/backup.sh` dumps Postgres nightly to a volume on the same VPS, and `pnpm db:snapshot` writes beside the database it copies. Neither leaves the machine yet.

### buy domain for Lettermint mail testing

### check: OpenAPI

the "follow the limes" feature switch is hidden, after choosing the barrington map. So rather place this switch below the map options button, when barrington has been chosen
