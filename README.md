<h1 align="center">
  <img src="documents/Vestigian_logo.png" alt="Vestigian" width="320">
</h1>

An atlas of the traces antiquity left behind — settlements, roads, fortifications and findspots and more, recorded by the people who go and look at them.

**Live at [vestigian.org](https://vestigian.org).**

Built on data contributed to [Vici.org](https://vici.org) by René Voorburg and its contributors, reused under CC BY-SA. Vestigian is an independent reimplementation, not a fork of the vici.org codebase.

## Further documentation

This file covers what a new contributor needs first. Deeper, topic-scoped detail lives in:

- **[`documents/scripts.md`](documents/scripts.md)** — every script this project wrote itself: what it does and how to run it.
- **[`documents/architecture-overview.md`](documents/architecture-overview.md)** — the system shape and data flow.
- **[`documents/runbook_prod.deployment.md`](documents/runbook_prod.deployment.md)** — the production deployment runbook.

## Getting started

### Prerequisites

| Tool                                                       | Version    | Why                                                                                                                            |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [Volta](https://volta.sh) (recommended)                    | any recent | Switches to the exact Node and pnpm pinned under `volta` in `package.json` — set `VOLTA_FEATURE_PNPM=1` so it manages pnpm too |
| [Node.js](https://nodejs.org)                              | ≥22        | Runs the app and every `tsx` script — `volta.node` is the version CI uses                                                      |
| [pnpm](https://pnpm.io/installation)                       | 9.x        | This repo's package manager — `packageManager` in `package.json` pins it                                                       |
| [Docker](https://docs.docker.com/get-docker/) + Compose v2 | any recent | Postgres/PostGIS, Valkey, MinIO, imgproxy, Mailpit — the whole dev stack                                                       |
| `openssl`                                                  | any        | Generates the session and ALTCHA signup secrets                                                                                |

No database, cache, or object store to install by hand — the entire dev stack is one `docker compose` file, and `NUXT_PUBLIC_BASEMAP_PROVIDER=openfreemap` (the default) means no map API key either.

### Two commands

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

It deliberately stops there: the atlas starts empty. Loading data is a
separate step the maintainers run, not something a setup script does; see
"Where the data comes from" below.

```bash
pnpm dev   # → http://localhost:3000
```

The map runs against OpenFreeMap out of the box, so nothing needs an API key to see it working. The atlas will be empty until data is loaded.

### By hand, if you'd rather

`pnpm setup` is exactly the following, in case you want to run it yourself or adapt a step:

```bash
cp .env.example .env          # then set NUXT_SESSION_PASSWORD and NUXT_ALTCHA_SECRET
pnpm install
pnpm stack:up                 # postgres+postgis, valkey, minio (+bucket), imgproxy, mailpit
pnpm db:generate && pnpm db:migrate
pnpm dev
```

## Where the data comes from

The records are Vici.org's openly licensed data (CC BY-SA), the photographs
carry the licences their authors gave them, and the atlas also carries the
limes frontier, Barrington-style antiquity cartography, Trajan's Column, the
Tabula Peutingeriana, ancient ports, ORBIS routes, battles, Roman roads
(Itiner-e), mints (Nomisma), Roman monuments (Wikidata), Sicilian inscriptions
(I.Sicily), the Roman state's neighbours (Cliopatria), the hillforts of Britain
and Ireland, dated sites from the Ancient Sites and Monuments Survey and more. **Sources, licences and what each import does:
[`documents/scripts.md`](documents/scripts.md).**

**The import is a maintainer's job, not a setup step, and please do not run it
against the upstream servers.** The sources are run by individuals and small
institutions, and every copy of this project that crawled them would be load
on their systems. Everything below works against an empty atlas, or against a
database snapshot restored from `pnpm db:snapshot` (see "Backups").

Images whose licence string cannot be resolved to a known licence are left
unpublished. That is deliberate — an ambiguous licence should never quietly
appear on the public map under a guessed one.

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
  components/     map · site · tracing · contribute · auth · moderation ·
                  limes · notebook · columns · ui
  composables/    map · data · auth · user · limes · ui   (unit tests in __test__/)
  layouts/ pages/ middleware/
server/
  api/            tiles · sites · tracings · contributions · moderation ·
                  auth · me · contributors · limes · images · health
  database/       drizzle schema and migrations
  utils/          mvt · trust · permissions · ratelimit · images · argon ·
                  revisions · notifications · enrichment (tests in __test__/)
shared/types/     the vocabulary both sides share
scripts/import/   the vici.org import plus every antiquity/reference overlay
scripts/          snapshot-database · reconcile-images · warm-tiles · setup.sh
docker/           Dockerfile, dev and production compose, Traefik, observability
```

The full, current layout — every folder, every page and API route — lives in
`CLAUDE.md`, kept in sync as the source of truth for anyone (or any agent)
picking the project up; this section stays a sketch. Component/script
detail beyond the sketch above: **[`documents/scripts.md`](documents/scripts.md)**
for every script this project wrote itself, and
**[`documents/architecture-overview.md`](documents/architecture-overview.md)**
for the data-flow view.

Components put `<script setup>` before `<template>`, use inline Tailwind, and keep lifecycle hooks at the bottom of the script block.

## Deployment

One VPS, Docker Compose, orchestrated by [Dokploy](https://dokploy.com):

|                    |                                                                    |
| ------------------ | ------------------------------------------------------------------ |
| Netcup RS 4000 G12 | app, Postgres, Valkey, imgproxy, Traefik and the rest of the stack |
| Bunny.net          | CDN and Edge Storage: photographs and the PMTiles basemaps         |

`docker/compose.prod.yml` is the deployment unit. GitHub Actions builds a multi-stage image to GHCR, and calls the Dokploy webhook.

The app is strictly 12-factor — env-only config, no local disk writes, `/api/health` and `/api/ready` probes — so moving to Kubernetes later is a translation rather than a rewrite.

**One VPS is one failure domain.** The `backup` service dumps Postgres nightly and keeps fourteen days. Test the restore, not just the dump.

### Switching to self-hosted basemap tiles

```bash
# A Europe + Mediterranean extract, roughly 15–25 GB
# Download from https://maps.protomaps.com and upload to Bunny Edge Storage, then:
NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles
NUXT_PUBLIC_BASEMAP_PMTILES_URL=https://your-zone.b-cdn.net/europe.pmtiles
```

PMTiles is read directly by the browser over HTTP range requests. There is no tile server to run.

## Versioning

Semantic versioning via [Changesets](https://github.com/changesets/changesets), not Conventional-Commits-driven tooling — this repo's `commit-msg` hook deliberately keeps commit subjects freeform (lowercase, imperative, no `feat:`/`fix:` prefix), so the version bump lives in its own file instead of being inferred from the message.

```bash
pnpm changeset          # record a change: pick major/minor/patch, write a summary
pnpm changeset:status   # see what's pending, unreleased
pnpm changeset:version  # apply pending changesets, bump package.json, rewrite CHANGELOG.md
```

Cutting a release is a deliberate action, not something every push triggers: run the **release** workflow from the Actions tab and pick a `bump` (patch/minor/major) from the dropdown. It used to run automatically on every push to `main`, but a bot committing and pushing straight to `main` with no branch in the loop could land at the same moment as a human push, diverging `main` and rejecting the human's push — so it now only runs on `workflow_dispatch`. The chosen bump is a floor, not an override: a pending changeset recorded at a higher severity still wins. A second workflow, `changeset-check.yml`, is a non-blocking reminder on pull requests for anyone working from a branch. Deploy images (`ghcr.io/…`) carry the version as a tag alongside `latest` and the commit SHA, so a specific release can be pulled or rolled back to by name. Full mechanism and rationale: "Versioning & releases" in `CLAUDE.md`.

## Testing

### Unit-Tests

```bash
pnpm test
```

### E2E-Tests against local production build

```bash
pnpm test:e2e
```

## Licensing

Site text and descriptions: CC BY-SA. Metadata: CC0. Images carry their own licence per record, which is why `licence` and `attribution` are non-null columns and why attribution is rendered under every image rather than hidden behind an interaction.

## Accounts and email

Registration issues a hashed, single-use token and emails a confirmation link. Mail goes through **Brevo**, hosted in the EU — the same reasoning that moved the CDN and the object store there. `NUXT_MAIL_API_KEY` is a Brevo API key.

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

`GET /api/data/sites.geojson?bbox=west,south,east,north` returns approved sites as GeoJSON with licence and attribution on every feature, CORS-open and bounded to 1000 records per request; `offset` pages through the rest in `id` order. `GET /api/data/sites.lp.json` serves the same atlas as Linked Places Format v1.3 (what Recogito, Peripleo and the World Historical Gazetteer read), with the same `bbox`, `category`, `limit` and `offset`, plus `dated=true` for only the dated records. `GET /api/data/sites.ttl` is the same records as RDF in Turtle (GeoSPARQL geometry, `skos:closeMatch` links to Pleiades and Wikidata).

The reference layers this atlas adapted from ODbL sources are offered back under the same licence, as ODbL asks: `GET /api/odbl/<layer>.geojson` and `.ttl` for `awmc-water`, `awmc-lines`, `awmc-areas`, `awmc-regions`, `awmc-features`, `coin-hoards`, `limes` and `survey-sites`, with `bbox`, `kind`, `source`, `limit` and `offset`. Each collection names its licence, credit and what was altered, and each feature names its own source where sources differ. `/licence` lists every feed, grouped by licence.

## OpenAPI

Every route under `server/api/` is documented, and the documentation is derived from the zod schema the handler validates with — not written beside it. **It exists in development only**: with `pnpm dev` running, the interactive reference (Scalar) is at <http://localhost:3000/_scalar> and the raw document at `/api/openapi.json`. Both 404 in production, where a machine-readable map of every route is withheld on purpose; `/api/data/sites.geojson` remains the documented public feed. To inspect a production shape, run the dev server and paste `/api/openapi.json` into Insomnia, Postman or any hosted reference.

How the document is assembled:

| Half                                                                                     | Source                                                                                                                           | Carries                                              |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Nitro's generated base document, served internally at `/_nitro-base-openapi.json`        | `defineRouteMeta({ openAPI: { tags, summary, description } })` in each route file                                                | paths, methods, `tags`, `summary`, `description`     |
| Request-time merge in [`server/api/openapi.json.get.ts`](server/api/openapi.json.get.ts) | `OPERATION_OVERRIDES`, keyed by path then method, built with the helpers in [`server/utils/openapi.ts`](server/utils/openapi.ts) | `parameters`, `requestBody`, `responses`, `security` |

The split exists because `defineRouteMeta` is a build-time macro: only literals survive, so a call such as `paramsFromSchema(schema)` is silently dropped with no build error. Anything derived from a schema is therefore computed at request time in the merge route.

Helpers in `server/utils/openapi.ts`:

- `paramsFromSchema(schema, 'query' | 'path')` and `bodyFromSchema(schema)` — convert a route's exported zod schema with `zod-to-json-schema`.
- `COMMON_RESPONSES` / `errorResponse` — the `{ statusCode, statusMessage, message }` error shape every `createError` produces.
- `jsonResponse(description)` — a success body described in words, used where the handler returns a TypeScript type with no schema to derive from.
- `TILE_PARAMS` / `TILE_RESPONSES` — the shared `z/x/y.mvt` contract of the tile routes.
- `SESSION_SECURITY` — references the `sessionCookie` scheme, which is registered once through `$global` in [`server/api/auth/login.post.ts`](server/api/auth/login.post.ts).

**Adding or changing a route:**

1. Give the route a `defineRouteMeta` with string-literal `tags`, `summary` and `description`.
2. `export` the zod schemas the handler validates with (`querySchema`, `paramsSchema`, …).
3. Import them in `openapi.json.get.ts` and add the route to `OPERATION_OVERRIDES` under its OpenAPI path (`/api/sites/{id}`, not `[id]`).

Two known limits: an `OPERATION_OVERRIDES` entry whose path no longer matches a route is skipped without warning, so a renamed route quietly loses its parameters; and no unit test covers the merge, so check `/_scalar` by hand after touching either file.

Scalar and Swagger both load their renderer from `cdn.jsdelivr.net`, a third-party runtime request this project otherwise avoids. Swagger is off outright, Scalar is on only when `!isProduction`, and the CSP allowlists that host under the same condition. The rationale and the two independent production guards are in [`.claude/rules/openapi.md`](.claude/rules/openapi.md).

## Operations

### Observability

Six containers — Grafana, Loki, Tempo, Prometheus, Alertmanager and Alloy —
all writing to local disk, about 1.6 GB of RAM.

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
can be rebuilt by the import pipeline; **the photographs in the object store
cannot** — treat the bucket as the only copy.
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

Add `image-archive/` to `.gitignore` first: at ~10 GB it must not go near git.

To restore, mirror the same pair of arguments the other way — source and
target swap, everything else is identical:

```bash
docker run --rm --network container:vestigian-dev-minio-1 \
  -v "$PWD/image-archive:/out" minio/mc:latest sh -c \
  "mc alias set dst http://127.0.0.1:9000 vestigian vestigian-dev-secret && mc mirror /out dst/vestigian"
```

In production the bucket is Bunny Edge Storage, reachable over the public
internet rather than a Docker network — run this from wherever the archive
lives (the VPS, or a laptop with the archive downloaded), with no
`--network` flag needed, and the same `BUNNY_*` values `compose.prod.yml`
already injects into the app container:

```bash
docker run --rm -v "$PWD/image-archive:/out" minio/mc:latest sh -c \
  "mc alias set src https://<BUNNY_S3_ENDPOINT> <BUNNY_ACCESS_KEY_ID> <BUNNY_SECRET_ACCESS_KEY> && mc mirror src/<BUNNY_BUCKET> /out"

# restore, same swap as above
docker run --rm -v "$PWD/image-archive:/out" minio/mc:latest sh -c \
  "mc alias set dst https://<BUNNY_S3_ENDPOINT> <BUNNY_ACCESS_KEY_ID> <BUNNY_SECRET_ACCESS_KEY> && mc mirror /out dst/<BUNNY_BUCKET>"
```

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
  Suspension leaves the accepted-contribution count untouched, so restoring trust returns someone to exactly where they were. Three rules guard role changes: only admins may make them, nobody may change their own, and no admin can demote another admin — removing one requires direct database access, the same as creating the very first one.

## The admin station

`/admin`, administrators only, reached from the account menu and linked from nowhere else. It is disallowed in `robots.txt`, carries an `X-Robots-Tag: noindex` header and `no-store`, and answers 404 rather than 403 to anyone signed in without the role.

- **Activity**: every revision the atlas has, newest first — including the edits a trusted contributor published with nobody reviewing them, which the moderator's queue by definition cannot show. Filter by status, kind, author, date, whether anyone reviewed it, and whether it removes more than it adds; search titles and edit summaries.
- **Accounts**: the roll with email addresses (audited on every read), role, standing, two-factor and verification state. Suspend or restore automatic publishing, change roles, end every session an account has open, and block or unblock an account.
- **A dossier per account**: everything one person created, changed, photographed and endorsed, with diffs — and one counted, reversible sweep that takes all of it offline.
- **Photographs**: the review backlog, plus every image whose licence is `UNKNOWN` or `ARR`. Those can never be published, and no other screen lists them.
- **Audit trail**: append-only, every admin action with who and when. No addresses of origin, no credentials.
- **System**: readiness of both database pools and the cache, backlog counts, signup-abuse signals, and the four counters worth a screen — failed mail deliveries first, since mail delivery never throws and a broken provider is otherwise silent.

A **block stops the person, not their work**: login is refused, every live session ends immediately, and their published records stay on the atlas, still credited. Taking that work offline is the separate sweep above. **Changing a role and blocking an account ask for the password again**, because neither can be undone from inside the application — and no administrator can be blocked at all, for the same reason none can be demoted.

## Photographs

Managed from a site's edit page: reorder, correct the caption or credit, and withdraw.

Withdrawing marks the row rejected and leaves the object in storage. A hard delete would destroy the audit trail, and a takedown request needs a record that the image was removed and when — as well as letting a moderator reverse a mistaken removal. Purging stored objects is a separate, deliberate operation.

The first image in the order is the one the map uses, so ordering is editorial rather than cosmetic.

## Bulk review

The queue supports multi-select with publish-all and reject-all, capped at fifty. Each revision is decided independently and failures are reported per item rather than thrown: one revision that cannot be applied must not silently abandon the other forty-nine. A failed item is rolled back to pending so it returns to the queue rather than sitting in an ambiguous half-reviewed state.

## What is not built yet

Honest list, so nothing here is a surprise — kept in sync with CLAUDE.md's
own "Not built" section, which is the authoritative copy:

- **Purging withdrawn images** from object storage. Withdrawal is reversible by design; there is no operation that actually deletes bytes.
- **Notifications beyond mail.** A review decision and a trust change reach the person by email, and it can be turned off from `/settings` — but a role change and a revert still send nothing, and there is nothing in the interface itself.
- **Full-text search across descriptions.** Search covers titles and summaries only.
- **RDF beyond Turtle.** The feeds are offered as Linked Places Format, GeoJSON and Turtle (`/api/data/sites.ttl`, `/api/odbl/*.ttl`); there is no SPARQL endpoint, no content negotiation, no per-site dereferenceable RDF, and no RDF for the CC BY / CC0 reference layers.
- **Full i18n component coverage.** See "i18n" in CLAUDE.md for what is and is not migrated.
- **Off-box backups, until configured.** `docker/backup.sh` dumps Postgres nightly and pushes it to netcup Storage Space through restic, but only once `RESTIC_REPOSITORY`, `RESTIC_OFFSITE_DIR` and `RESTIC_PASSWORD` are set and the storage is mounted (runbook §20); without them the dump stays on the VPS. `pnpm db:snapshot` writes beside the database it copies.
