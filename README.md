# Vestigia

An atlas of the traces antiquity left behind — settlements, roads, fortifications and findspots, recorded by the people who go and look at them.

Built on data contributed to [Vici.org](https://vici.org) by René Voorburg and its contributors, reused under CC BY-SA. Vestigia is an independent reimplementation, not a fork of the vici.org codebase.

## Getting started

```bash
cp .env.example .env          # then set NUXT_SESSION_PASSWORD
pnpm install
pnpm stack:up                 # postgres+postgis, valkey, minio, imgproxy, mailpit
pnpm db:generate && pnpm db:migrate
pnpm dev
```

The map runs against OpenFreeMap out of the box, so nothing needs an API key to see it working. Site data will be empty until you run the import.

## Importing the vici.org data

The dumps are ~1 GB compressed and the image mirror is a multi-hour crawl, so this is three separate resumable steps rather than one command.

```bash
docker run -d --name vici-mysql -p 3307:3306 \
  -e MARIADB_ROOT_PASSWORD=root mariadb:11

pnpm import:fetch      # download the dumps, load into the scratch MariaDB
pnpm import:convert    # transform into PostGIS
pnpm import:images     # mirror originals into object storage
```

**Before running the image mirror at full scale, contact René Voorburg.** The licences permit reuse; the bandwidth is still his server's. The crawler waits 1.2 s between requests for the same reason.

Images whose licence string cannot be resolved to a known licence are imported but left unpublished. That is deliberate — an ambiguous licence should never quietly appear on the public map under a guessed one.

## How the map stays fast

The viewport requirement is answered by vector tiles generated in Postgres, not by bbox queries:

- `/api/tiles/{z}/{x}/{y}.mvt` runs `ST_AsMVT` against a GiST index and returns a binary tile.
- Below zoom 9 the tile contains counted clusters; above it, individual sites plus simplified tracings.
- Tiles are cached in Valkey under a data-version prefix. Approving a revision bumps one counter and invalidates everything at once.
- MapLibre requests only newly exposed tiles when panning, so movement costs almost nothing after the first paint.
- Tiles carry an id and a label only. Descriptions and images arrive from `/api/sites/:id` when a feature is opened, which keeps tiles small and cacheable far longer than editable content would allow.

## Contribution and moderation

Every change is written to `revisions` before it touches a live table. New accounts are queued; after **two accepted contributions** an account's edits publish immediately. A moderator can revoke that at any time, and no moderator can approve their own submission.

Signup is protected by Cloudflare Turnstile, a honeypot field, per-IP rate limiting and email verification. Registration responds identically whether or not an address already exists, so it cannot be used to enumerate accounts.

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
scripts/import/   the three-stage vici.org import
docker/           Dockerfile, dev and production compose, Traefik
```

Components put `<script setup>` before `<template>`, use inline Tailwind, and keep lifecycle hooks at the bottom of the script block.

## Deployment

One VPS, Docker Compose, orchestrated by [Dokploy](https://dokploy.com). Roughly €27/month including object storage:

| | |
|---|---|
| Hetzner CPX41 | app, Postgres, Valkey, imgproxy, Traefik |
| Cloudflare R2 | images and the PMTiles basemap, zero egress |
| Cloudflare (free) | CDN and Turnstile |

`docker/compose.prod.yml` is the deployment unit. GitHub Actions runs the tests, builds a multi-stage image to GHCR, and calls the Dokploy webhook.

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

Registration issues a hashed, single-use token and emails a confirmation link. Without `NUXT_MAIL_API_KEY` the message is written to the server log instead, so the whole flow works locally without configuring a provider.

- Verification links last a day; password reset links last an hour and void every other outstanding link for that account.
- Only the SHA-256 hash of a token is stored, and comparison is constant-time.
- `forgot-password` answers identically whether or not the address exists.
- Resetting a password does not sign you in — that is deliberate.

## Uploads

`POST /api/contributions/images` accepts one photograph per request. The declared content type is treated as a hint only: the format is read from the file's leading bytes, and every image is re-encoded through sharp, which strips EXIF and guarantees the stored object is a plain JPEG. Storage keys are derived from database identifiers, never from the uploaded filename.

Licences are chosen from a closed list at upload time, since an image with an unresolved licence cannot be published.

## Public data

`GET /api/data/sites.geojson?bbox=west,south,east,north` returns approved sites as GeoJSON with licence and attribution on every feature, CORS-open and bounded to 1000 records per request. RDF and a Pelagios-compatible gazetteer dump are the natural next step if you want other projects to link to Vestigia's places.

## Operations

**After every deploy or bulk import, warm the tile cache:**

```bash
pnpm tiles:warm https://vestigia.org
```

The only predictable slow moment is the minutes after a data-version bump, when the low-zoom clustered tiles are all generated at once by real traffic. There are a few hundred of them over the data's extent, so warming takes seconds and removes the spike.

`/robots.txt` and `/sitemap.xml` are generated from the database. Tiles and search are disallowed — crawling the tile pyramid would produce millions of requests for content worthless in an index.

## Editing and history

The atlas is no longer append-only.

- **Edit** at `/site/[slug]/edit`, reachable from both the map panel and the full entry. Edits carry an optional note explaining the change, which is what makes the history readable later.
- **History** on every site page: who changed what, when, and whether it was auto-published or reviewed. Each entry expands into a field-level diff.
- **Revert** is a moderator action that writes a *new* revision restoring the earlier state, rather than deleting the offending one. History stays append-only, so the record of what was reverted and by whom survives.
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
- **RDF / Pelagios output.** The GeoJSON feed is there; linked data is not.
- **Offline tile caching.** The app is installable; it does not work without signal.
- **External identifier import.** The `external_ids` table is defined and read by the API, but `02-mysql-to-postgres.ts` does not yet populate it from vici's concordance data.
