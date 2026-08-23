# CLAUDE.md — Vestigia

Context for continuing this project. Read this first.

## What this is

**Vestigia** ("traces") is an atlas of the ancient world — settlements, roads, fortifications, findspots — recorded by the people who visit them. It is an independent reimplementation inspired by [vici.org](https://vici.org), reusing that project's openly-licensed data.

**It is not a fork and must not become one.** Do not copy vici.org's code, markup, layout, or visual language. The data is shared; the character is not.

**Status: the map runs, on real data.** It was originally written without network
access — nothing had been executed, no dependency installed, no query run. That
is no longer true of the spine: the stack comes up, the import pipeline runs
end to end, and 61,272 sites and 11,720 tracings render through `ST_AsMVT`.

Still unexercised: everything above the map — auth, contribution, moderation,
revisions, uploads through the app's own endpoints. Treat those as unverified,
and expect the same class of bug that the map had (see "Start here").

## Design brief

The agreed mood is **"a field notebook carried through Roman Europe."** Every visual decision follows from that sentence.

- Ground is aged laid paper (`#f2ede1`), cooler and greener than a generic warm cream.
- Text is iron-gall ink, browned — never pure black.
- One oxide red (`#9a3b22`) as accent, used **once per screen**, never decoratively.
- Bronze for linear features, verdigris only for approved/confirmed states.
- Dark mode is a _night_ notebook, not an inverted one: warm charcoal, never blue-grey.
- Type: Fraunces Variable (display, optical-size axis), IBM Plex Sans (body), IBM Plex Mono (coordinates, ids, licences). **All self-hosted via `@fontsource*` — never a runtime request to Google.**
- Signature element: `.leaf`, a sheet of the notebook — raised ground, 2px corners, a shallow shadow. It once had a companion `.leaf-margin` that drew a ruled annotation column down the left of every panel; nothing was ever put in the column, so it read as a stray vertical line beside an oddly indented block and has been removed. If the ruled margin returns, it returns with provenance, licence and revision state actually in it.

Tokens live in `app/assets/css/main.css` as Tailwind v4 `@theme` variables. Nuxt UI is pointed at those palettes in `app/app.config.ts`, so components inherit the palette rather than being restyled individually.

## Code conventions (these were specified — follow them exactly)

- **Arrow functions only.** No `function` declarations.
- **Clear, readable function names.** No abbreviations.
- **Define a named interface when a function takes more than two parameters.** Do not add a third positional parameter.
- **Vue SFC order: `<script setup>` first, `<template>` second.** No `<style>` blocks — Tailwind inline only.
- **Nuxt lifecycle hooks (`onMounted`, `onBeforeUnmount`) go at the bottom of the script block**, after all other declarations.
- **Unit tests live in `__test__/` subfolders beside the code they test** — for composables and server utils only. **Components have no `__test__` folders and no tests.**
- **Components and composables are grouped into folders by meaning** (`map`, `site`, `contribute`, `auth`, `moderation`, `ui` / `data`).
- **Prefer established open Vue/Nuxt components over hand-rolling.** Nuxt UI v3 (built on Reka UI) covers forms, inputs, buttons, selects, toasts, checkboxes. Do not write a custom form control.
- Tests cover **critical logic only** — tile planning, trust, permissions, rate limiting, licences, diffing, ordering. Not glue.

## Stack and why

| Choice                                   | Reason it was chosen over the alternative                                                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MapLibre GL JS v5**                    | Vector + GPU. Handles 20k sites via clustering and 1k tracings as styled LineStrings. Leaflet would thrash the DOM; OpenLayers (what vici uses) has a worse mobile feel; Mapbox GL charges per load. |
| **PostGIS `ST_AsMVT`**                   | The viewport requirement is answered by _tiles_, not bbox GeoJSON queries. This is the single most important architectural decision in the project.                                                  |
| **PMTiles basemap** (OpenFreeMap in dev) | Custom style = the app's character. A hosted MapTiler style would make it look like everything else. PMTiles is read by the browser over HTTP range requests — **no tile server process exists**.    |
| **Drizzle + `postgres.js`**              | TS-first. Raw SQL used wherever PostGIS is involved, which is most of the hot path.                                                                                                                  |
| **Valkey**                               | Tile cache, sessions, rate limits. Redis-compatible, no licence question.                                                                                                                            |
| **R2 + imgproxy**                        | One original stored per image; derivatives on the fly. Zero egress.                                                                                                                                  |
| **terra-draw**                           | Framework-agnostic drawing that works with MapLibre.                                                                                                                                                 |
| **Dokploy on one Hetzner VPS**           | ~€27/month all-in vs ~€60–90 for managed k8s. Dokploy _is_ Docker Compose, so dev and prod are the same artifact.                                                                                    |

The app is strictly 12-factor (env-only config, no local disk writes, `/api/health` + `/api/ready`), so moving to Kubernetes later is a translation, not a rewrite.

## How the map stays fast

1. `GET /api/tiles/{z}/{x}/{y}.mvt` → validate coordinate → check Valkey → `ST_AsMVT` against a GiST index.
2. **Below zoom 9**: counted clusters, snapped to a grid in _projected_ space (square cells at every latitude). **At 9+**: individual sites. **Tracings from zoom 7**, simplified with a tolerance derived from metres-per-pixel.
3. Tiles carry `id`, `slug`, `title`, `category` **only**. Descriptions and images come from `/api/sites/:id` on demand — this keeps tiles small and cacheable far longer than editable content allows.
4. Cache invalidation is **one counter**. `bumpDataVersion()` changes the key prefix for every tile at once. Approvals are rare; tile reads are not.
5. Empty tiles are cached for 24h — most of the pyramid is ocean.

After any deploy or bulk import, run `pnpm tiles:warm <url>`.

## Governance model — do not weaken these

- Every change to a site or tracing is written to `revisions` **before** any live table is touched.
- `applyRevision()` in `server/utils/revisions.ts` is the **only** place a live row is written. Automatic approval, moderator approval and revert all go through it. Do not add a second path.
- **Trust:** new accounts are queued. After **2 accepted contributions** (`evaluateTrust`), edits publish immediately. Moderators can revoke. Images do not count toward trust — uploading two photos is a weaker signal than two records surviving review.
- **A moderator cannot approve their own contribution** (`canReviewRevision`).
- **An edit that removes more than it adds is queued regardless of trust** (`isBlankingEdit`). This deliberately overrides the trust rule; a wrong auto-approval on a blanking edit costs far more than a moderator glance.
- **Revert writes a new revision** restoring the prior state. Never delete a revision. History is append-only.
- **Reverts do not increment the moderator's trust counter** — housekeeping is not contribution.
- **The last admin cannot be demoted** (`checkRoleChange`), and nobody can change their own role.
- **Slugs never change on edit.** Inbound links, citations and the sitemap point at them.
- Suspension leaves `approved_contributions` untouched, so restoring trust returns someone exactly where they were.

## Security invariants — do not weaken these either

- argon2id at OWASP parameters. Login always hashes (against `DUMMY_HASH` when no user matches) so timing cannot enumerate the user table.
- `forgot-password` responds **identically** whether or not the address exists. Registration no longer does: a duplicate email or display name is reported as a 409 so the person can try again. That was a deliberate trade of the enumeration guarantee for a form that is not a dead end — see the comment in `server/api/auth/register.post.ts`, which records what still throttles it and what the alternative was.
- Only the SHA-256 **hash** of an email token is stored; comparison is constant-time.
- Uploads: the declared content type is a hint. Format is read from **magic bytes** (`detectImageFormat`), and every image is **re-encoded through sharp**, which strips EXIF and guarantees the stored object is a plain JPEG. Storage keys derive from database ids, **never** from the uploaded filename.
- Images with an unresolved licence (`UNKNOWN`) or `ARR` are never published.
- Signup: Turnstile + honeypot (positioned off-screen, not `display:none`) + per-IP rate limit + email verification.
- Rate limiting **fails open** — a cache outage must not lock everyone out.
- CSP allows only the map asset origins listed in `nuxt.config.ts`.

## Layout

```
app/
  assets/css/main.css        design tokens (Tailwind v4 @theme)
  components/
    map/       MapCanvas BasemapSwitcher GeolocateButton MapSearchField
    site/      SiteDetailPanel SiteGallery SiteGalleryManager SiteMetaList SiteExternalLinks
    tracing/   TracingDetailPanel
    contribute/ ContributionPanel SiteEditorForm TracingEditorForm GeometryDrawTool ImageUploader
    auth/      LoginForm RegisterForm
    moderation/ ReviewQueue RevisionDiff ContributorTable
    ui/        ThemeToggle RevisionHistory
  composables/
    map/  useMapInstance useBasemapStyle useViewportTiles useGeolocation   (+__test__/)
    data/ useSiteQuery useImageUrl                                          (+__test__/)
    auth/ useSession
    ui/   useColorScheme useBreakpoint
  layouts/ default.vue (map shell) reading.vue (documents)
  middleware/ authenticated.ts moderator.ts
  pages/ index login register verify forgot-password reset-password
         site/[slug] site/[slug]/edit tracing/[id] tracing/[id]/edit
         moderation/index moderation/contributors
server/
  api/ tiles/[z]/[x]/[y]  sites/  tracings/  auth/  contributions/  moderation/  data/  health ready
  routes/ robots.txt sitemap.xml
  database/ schema/ migrations/ migrate.ts
  utils/ mvt trust permissions roles ratelimit images images-order uploads tokens mail diff
         revisions slug db cache argon turnstile                            (+__test__/)
shared/types/  vocabulary shared by both sides
scripts/import/  four-stage vici.org import + vici-licences.ts (shared vocabulary)
scripts/warm-tiles.ts snapshot-database.ts reconcile-images.ts
docker/  Dockerfile compose.dev.yml compose.prod.yml traefik/ backup.sh
```

## Start here (in this order)

The map, the tile pipeline and the record import now run and have been seen
working against real data. What has _not_ been exercised is most of the
application above the map: auth, contribution, moderation, revisions.

1. `pnpm install`
2. `pnpm stack:up && pnpm db:migrate && pnpm dev`
3. Import — see "Import pipeline" below. The map is populated after
   `import:convert`; photographs come later and cost someone else's bandwidth.
4. `pnpm typecheck` — **still expect errors.** Most likely in Nuxt UI v3
   component props (`UForm`, `USelect`, `UButton` colour/variant names changed
   across betas), the MapLibre `StyleSpecification` strict types in
   `useBasemapStyle.ts`, and the `Transaction` type alias in
   `server/utils/revisions.ts`.
5. `pnpm test` — the pure logic should pass; these files have no runtime
   dependencies.

Two things that had never run and silently broke everything, now fixed — worth
knowing because both failed _invisibly_:

- **CSP without a nonce token killed the entire client app.** `script-src` did
  not allowlist the nonce Nuxt stamps on its inline scripts, so the one setting
  `window.__NUXT__.config` was refused and Vue never mounted. The page showed
  its server-rendered "Unfolding the map" placeholder forever.
- **`maplibre-gl.css` was never imported**, leaving the canvas `position: static`.

Scripts do not read `.env` on their own — every `tsx` entry in `package.json`
now passes `--env-file-if-exists=.env`. Before that, `NUXT_DATABASE_URL` was
`undefined` in all of them and they worked only because their fallbacks happened
to match the compose defaults.

## Known guesses that need verifying

- ~~The vici.org MySQL schema is inferred, not observed.~~ **Now verified against
  the October 2023 dump, and the guess was wrong in every particular.** There is
  no `places` table and no `lines` table; `02-mysql-to-postgres.ts` has been
  rewritten against the real shape. See "The vici.org schema, as observed" below.
- Migrations are **hand-written** (`0000_initial.sql`, `0001_revision_history.sql`) because drizzle-kit cannot emit PostGIS geometry columns, GiST indexes, or the expression indexes behind search. **Read any generated migration before applying it** — regenerating from the schema files would silently drop all three. See `server/database/migrations/README.md`.
- Vector-tile source layer names (`transportation`, `place`, `water`, `landuse`, `boundary`, `building`) follow the OpenMapTiles schema. Verify against the actual PMTiles/OpenFreeMap tiles.

## The vici.org schema, as observed

Verified against the October 2023 dump. A site is assembled from five tables, a
tracing from two, and none of them are named what the original code assumed.

| Holds                 | Table                               | Notes                                                                             |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| sites                 | `points`                            | `pnt_id, pnt_name, pnt_kind, pnt_lat, pnt_lng`; 87,688 rows                       |
| visibility            | `pnt_visible = 1 AND pnt_hide = 0`  | 61,284 qualify. There is no `deleted` column                                      |
| summary / description | `psummaries`, `ptexts`              | **one row per language** — 70k `en`, 8.6k `nl`, 6.5k `de`                         |
| period, concordances  | `pmetadata`                         | `pmeta_startyr/endyr`; concordances are **columns**, not rows                     |
| category vocabulary   | `pkinds`                            | 25 values: `city, fort, graves, vicus, mansio, watchtower, shipwreck, milestone…` |
| tracings              | `plines` + `pline_data`             | geometry is **not KML**                                                           |
| images                | `images`, `img_data`, `pnt_img_lnk` | 43,373 links over 39,358 distinct images                                          |

Four traps, every one of which produces plausible-looking wrong data rather than
an error:

1. **`pline_data` stores `[lat, lng]`.** GeoJSON wants `[lon, lat]`. Imported
   unswapped, every Roman road lands in the Indian Ocean and the code looks
   fine. The swap happens in `parseLineVertices` and nowhere else.
2. **`line_kind` is not a category.** It joins cleanly to `pkinds` but only ever
   holds 1–5 — it is a drawing type. Read as a category it files the Aqua
   Claudia aqueduct under _baths_. The real category is on the point the tracing
   hangs from (`points.pnt_kind`).
3. **`pline_data` holds each tracing six times**, pre-generalised into zoom
   bands. Import the most detailed and let PostGIS simplify per tile.
4. **`pmeta_extids` is free text** — `wikidata=Q2409236`, `archis: 26284`,
   `dare id=17247`, `tp:place=18` and bare URLs, all wrapped in span tags.
   Deriving a scheme from it naively yields 68 "schemes" including `https` and
   `austenhenrylayard18171894nineveh`. The parser works from an allowlist and
   reports what it drops.

Licence ids resolve through `scripts/import/vici-licences.ts`, shared by the
record and image stages so a licence cannot mean two things in one pipeline.

## Import pipeline

Order matters and each step is resumable. The scratch MariaDB is **not** part of
`pnpm stack:up` — it is read once and thrown away.

```bash
docker run -d --name vici-mysql -p 3307:3306 -e MARIADB_ROOT_PASSWORD=root mariadb:11

pnpm import:fetch           # dumps → scratch MariaDB (uses db_dumb/ if already downloaded)
pnpm import:convert         # → 61,272 sites, 11,720 tracings, 8,692 concordances
pnpm import:image-records   # → 39,212 site_images rows over 36,216 objects; no bytes fetched
pnpm import:images          # → the photographs; ~12 hours, ~10 GB, resumable
pnpm tiles:warm <url>
```

The map is fully usable after `import:convert`. Everything after that is
photographs.

**Contact René Voorburg before running the image mirror at scale.** The licences
permit reuse; the bandwidth is his server's. Quote the real figures — **36,216
requests** at 1.2 s apart, ~10 GB — and prove the setup first with
`MIRROR_LIMIT=5 pnpm import:images`.

Re-running the mirror after rebuilding the records does **not** re-download:
an object already in storage is adopted (read back locally, re-measured, marked
approved) with no request to vici.org and no pause. Without that, every rebuild
of `site_images` would cost his server another 36,000 requests.

### Where the photographs live — verified, and counter-intuitive

- `vici.org/uploads/{file}` is a **soft 404**: HTTP 200 with an HTML body reading
  "404 - file not found". It reaches an image pipeline as a corrupt file rather
  than as a missing one, so `response.ok` proves nothing. The mirror checks
  magic bytes with `detectImageFormat` for this reason.
- Photographs are served from **`images.vici.org`**, and originals are not
  exposed: `/uploads/{file}` there is a genuine 404. Everything must come
  through a transform.
- Use **`/size/w{width}/uploads/{file}` — width only.** Both `size/w2400xh2400`
  and `crop/w2400xh2400` return exactly that box, distorting or cropping
  anything non-square. Width is capped at the recorded `imgd_width` so small
  originals are not upscaled.
- Consequence: **2400px is a permanent ceiling** for imported photographs. The
  "one original stored per image" principle cannot hold for this content.

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

Neither snapshot leaves the machine yet. That is the open gap.

Data is CC BY-SA (text) / CC0 (metadata); **image licences vary per record**, which is why `licence` and `attribution` are non-null columns and attribution renders under every image rather than hiding behind an interaction.

## Not built

- Purging withdrawn images from object storage (withdrawal is reversible by design — nothing deletes bytes).
- Notifications — a contributor learns an edit was accepted by looking.
- Full-text search across descriptions (titles and summaries only).
- RDF / Pelagios linked data. The GeoJSON feed at `/api/data/sites.geojson` exists.
- Offline tile caching. The app is installable as a PWA but needs signal.
- i18n. English only by decision; strings are not yet centralised into one module, which they should be before adding locales. Note the source has `nl`, `de` and `fr` text for thousands of sites — the import takes `en` and discards the rest.
- Off-box backups. `docker/backup.sh` writes nightly to a volume on the same VPS, and `pnpm db:snapshot` writes beside the database it copies. Neither survives losing the machine.
- PWA icons. `public/manifest.webmanifest` references `/icons/icon-192.png`, `-512` and `-maskable`; none of them exist.

## Deployment

`docker/compose.prod.yml` is the deployment unit. GitHub Actions runs tests, builds a multi-stage image to GHCR, calls a Dokploy webhook. Traefik terminates TLS. Nightly `pg_dump` kept 14 days.

**One VPS is one failure domain.** Test the restore, not just the dump.

To move from OpenFreeMap to self-hosted tiles: download a Europe + Mediterranean extract from maps.protomaps.com, upload to R2, set `NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles` and `NUXT_PUBLIC_BASEMAP_PMTILES_URL`.

## Working style for this project

When something is uncertain, say so rather than guessing silently — several things here are inferred (the vici schema above) and were flagged as such deliberately. When a decision has a real trade-off, name the trade-off. Prefer fixing an unverified assumption over adding a feature: the codebase is broad and completely unexercised, so the highest-value work right now is making it run, not making it bigger.

### Say it once, in the file

When you write a docstring or comment explaining what something does, why it
exists, or how it failed — **that is the explanation, and it does not get
repeated in chat.** Reply with a pointer: what you did, and where the reasoning
now lives. `Fixed the recursion; the ordering constraint is documented above
attachOverlay.` Not a paragraph restating it.

The chat transcript is thrown away; the file is read by whoever touches this
next. If an explanation is worth writing, it is worth writing where it will be
found — so when the urge to explain in the reply appears, extend the docstring
instead. A reader who wants the detail opens the file.

This does not apply to things that have no home in the source: what you
verified and how, what is still unproven, a trade-off the user has to decide,
or a finding that contradicts what they asked for. Those belong in the reply,
because there is no file for them.

### Mobile first
 Every component has to be optimized for mobile use (e.g. fast load, perfect UX/UI etc.), desktop secondly but not to be neglected. <!-- Supported breakpoints start from 375px to <768px (phone), to <1000px (tablet) and above (desktop). -->

### Performance, clean code, best practices
When adding or changing some code/feature, make it run as fast as possible (performance) but keep an eye on clean code and stick to best modern practices.

### Accessibility
Take a11y into account every time and boost it where possible (ARIA etc.)

### Clean and modern HTML
Always use best suitable HTML tags when building components