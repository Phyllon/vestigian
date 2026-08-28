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
- Type: Fraunces Variable (display), IBM Plex Sans (body), IBM Plex Mono (coordinates, ids, licences). **All self-hosted via `@fontsource*` — never a runtime request to Google.** Only `latin` and `latin-ext` are shipped, and only the **weight** axis of Fraunces: the brief once called for its optical-size axis, but `index.css` is a hard link to `wght.css`, so `'opsz'` was being set against a font that did not carry it and did nothing. Restoring it costs 54 KB across the two subsets — worth doing deliberately, not by leaving a dead declaration in the CSS.
- Signature element: `.leaf`, a sheet of the notebook — raised ground, 2px corners, a shallow shadow. It once had a companion `.leaf-margin` that drew a ruled annotation column down the left of every panel; nothing was ever put in the column, so it read as a stray vertical line beside an oddly indented block and has been removed. If the ruled margin returns, it returns with provenance, licence and revision state actually in it.

Tokens live in `app/assets/css/main.css` as Tailwind v4 `@theme` variables. Nuxt UI is pointed at those palettes in `app/app.config.ts`, so components inherit the palette rather than being restyled individually.

## Code conventions (these were specified — follow them exactly)

- **Arrow functions only.** No `function` declarations.
- **Clear, readable function names.** No abbreviations.
- **Define a named interface when a function takes more than two parameters.** Do not add a third positional parameter.
- **Vue SFC order: `<script setup>` first, `<template>` second.** No `<style>` blocks — Tailwind inline only.
- **Nuxt lifecycle hooks (`onMounted`, `onBeforeUnmount`) go at the bottom of the script block**, after all other declarations.
- **Unit tests live in `__test__/` subfolders beside the code they test** — for composables and server utils only. **Components have no `__test__` folders and no tests.**
- **End-to-end tests live in `./e2e`** and run under Playwright against the **production build**, never `nuxt dev` — two of this project's worst bugs existed only in the built output. `pnpm test:e2e`, separate from `pnpm test`. Read `e2e/README.md` before adding one: every anti-flake rule there was a real failure first.
- **Components and composables are grouped into folders by meaning** (`map`, `site`, `contribute`, `auth`, `moderation`, `ui` / `data`).
- **Prefer established open Vue/Nuxt components over hand-rolling.** Nuxt UI v3 (built on Reka UI) covers forms, inputs, buttons, selects, toasts, checkboxes. Do not write a custom form control.
- Tests cover **critical logic only** — tile planning, trust, permissions, rate limiting, licences, diffing, ordering. Not glue.

## Stack and why

| Choice                                   | Reason it was chosen over the alternative                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MapLibre GL JS v5**                    | Vector + GPU. Handles 20k sites via clustering and 1k tracings as styled LineStrings. Leaflet would thrash the DOM; OpenLayers (what vici uses) has a worse mobile feel; Mapbox GL charges per load.                                 |
| **PostGIS `ST_AsMVT`**                   | The viewport requirement is answered by _tiles_, not bbox GeoJSON queries. This is the single most important architectural decision in the project.                                                                                  |
| **PMTiles basemap** (OpenFreeMap in dev) | Custom style = the app's character. A hosted MapTiler style would make it look like everything else. PMTiles is read by the browser over HTTP range requests — **no tile server process exists**.                                    |
| **Drizzle + `postgres.js`**              | TS-first. Drizzle is the default for every query; raw SQL is kept for PostGIS only — six files, not "most of the hot path" as this table used to claim. See "Which client to reach for".                                             |
| **Valkey**                               | Tile cache, sessions, rate limits. Redis-compatible, no licence question.                                                                                                                                                            |
| **Bunny.net + imgproxy**                 | One original stored per image; derivatives on the fly. Zero egress.                                                                                                                                                                  |
| **terra-draw**                           | Framework-agnostic drawing that works with MapLibre.                                                                                                                                                                                 |
| **Grafana + Loki + Tempo + Prometheus**  | One agent (Alloy) carries logs, traces and metrics; Vector carries no traces, and Alloy's built-in exporters replace four separate exporter containers. Promtail reached EOL in March 2026. All on local disk — see "Observability". |
| **Dokploy on one Hetzner VPS**           | ~€27/month all-in vs ~€60–90 for managed k8s. Dokploy _is_ Docker Compose, so dev and prod are the same artifact.                                                                                                                    |

The app is strictly 12-factor (env-only config, no local disk writes, `/api/health` + `/api/ready`), so moving to Kubernetes later is a translation, not a rewrite.

## How the map stays fast

1. `GET /api/tiles/{z}/{x}/{y}.mvt` → validate coordinate → check Valkey → `ST_AsMVT` against a GiST index.
2. **Below zoom 9**: counted clusters, snapped to a grid in _projected_ space (square cells at every latitude). **At 9+**: individual sites. **Tracings from zoom 7**, simplified with a tolerance derived from metres-per-pixel.
3. Tiles carry `id`, `slug`, `title`, `category` **only**. Descriptions and images come from `/api/sites/:id` on demand — this keeps tiles small and cacheable far longer than editable content allows.
4. Cache invalidation is **one counter**. `bumpDataVersion()` changes the key prefix for every tile at once. Approvals are rare; tile reads are not.
5. Empty tiles are cached for 24h — most of the pyramid is ocean.

After any deploy or bulk import, run `pnpm tiles:warm <url>`.

## Which client to reach for

`useDatabase()` — Drizzle — is the default. Column names are checked against
`server/database/schema` at compile time and rows are typed from the same
place, which the raw client cannot do: `sql<{ id: number }[]>` is an assertion
the compiler takes on trust, so a renamed column stays green until production.

`useSql()` is for **PostGIS and nothing else** — eight files, each with a
reason a query builder cannot answer: `ST_AsMVT` and its aggregates
(`server/utils/mvt.ts`, via the tile route), `ST_AsMVTGeom`,
`ST_SetSRID`/`ST_MakePoint`/`ST_GeomFromGeoJSON` on write, the `geography`
casts behind proximity search, `ST_AsGeoJSON` on read, and the `SELECT 1` in
`ready.get.ts`.

A handful of geometry accessors is **not** such a reason. `sites/[id]/enrichment`
reads `ST_X`/`ST_Y` through Drizzle, as `sql\`ST_X(${schema.sites.geom})\``inside a normal`.select()`: table, columns and enum literals stay checked, and
only the two accessors are raw. Reach for `useSql()` when the _statement shape_
is beyond the builder, not when one expression is.

**The two hold separate connections, so a transaction cannot span them.**
`server/utils/revisions.ts` is the reason it matters: `applyRevision()` writes
geometry and bumps a trust counter inside one `sql.begin`, and splitting the
counter onto Drizzle would put it outside that transaction while still looking
atomic. A handler that needs one transaction picks one client for all of it.

The split exists because `drizzle(client)` overwrites the timestamp parsers on
whatever client it is handed — see the note in `server/utils/db.ts`.

## Governance model — do not weaken these

- Every change to a site or tracing is written to `revisions` **before** any live table is touched.
- `applyRevision()` in `server/utils/revisions.ts` is the **only** place a live row is written. Automatic approval, moderator approval and revert all go through it. Do not add a second path.
- **Every authorization rule lives in `shared/utils/authorization.ts`** and nowhere else — both sides import it, and the guards that throw are the only thing left in `server/utils/permissions.ts`. Casbin, CASL and Cerbos were assessed as replacements and rejected: three roles fixed in a `pgEnum` buy nothing from a runtime policy engine, and the rules that actually matter here are not the subject/action/resource shape they model. `users.trust_level` was dropped for the same reason — a derived column written by two hand-transcribed SQL copies of the threshold.
- **Trust:** new accounts are queued. After **2 accepted contributions** (`evaluateTrust`), edits publish immediately. Moderators can revoke. Images do not count toward trust — uploading two photos is a weaker signal than two records surviving review.
- **A moderator cannot approve their own contribution** (`canReviewRevision`).
- **An edit that removes more than it adds is queued regardless of trust** (`isBlankingEdit`). This deliberately overrides the trust rule; a wrong auto-approval on a blanking edit costs far more than a moderator glance.
- **Revert writes a new revision** restoring the prior state. Never delete a revision. History is append-only.
- **Reverts do not increment the moderator's trust counter** — housekeeping is not contribution.
- **Nobody can change their own role** (`checkRoleChange`), which is also what keeps an instance from losing its last admin — that rule's own `last-admin` branch cannot be reached, since removing the final admin requires being them. See the comments in the function.
- **Role and trust are re-read from the database inside every guard.** The session cookie is sealed at login and nothing refreshes it, so reading a role from it let a demoted moderator keep moderating until they logged out. `requireModerator`/`requireAdmin` cost one primary-key lookup and are the reason a demotion bites on the next request.
- **Slugs never change on edit.** Inbound links, citations and the sitemap point at them.
- Suspension leaves `approved_contributions` untouched, so restoring trust returns someone exactly where they were.

## Security invariants — do not weaken these either

- argon2id at OWASP parameters. Login always hashes (against `DUMMY_HASH` when no user matches) so timing cannot enumerate the user table.
- `forgot-password` responds **identically** whether or not the address exists. Registration no longer does: a duplicate email or display name is reported as a 409 so the person can try again. That was a deliberate trade of the enumeration guarantee for a form that is not a dead end — see the comment in `server/api/auth/register.post.ts`, which records what still throttles it and what the alternative was.
- Only the SHA-256 **hash** of an email token is stored; comparison is constant-time.
- Uploads: the declared content type is a hint. Format is read from **magic bytes** (`detectImageFormat`), and every image is **re-encoded through sharp**, which strips EXIF and guarantees the stored object is a plain JPEG. Storage keys derive from database ids, **never** from the uploaded filename.
- Images with an unresolved licence (`UNKNOWN`) or `ARR` are never published.
- Signup: **self-hosted ALTCHA** proof of work + honeypot (positioned off-screen, not `display:none`) + per-IP rate limit + email verification. ALTCHA replaced Turnstile to remove the last third-party runtime dependency; it prices automated signup rather than detecting it, which is **weaker** against a funded attacker. That is acceptable only because login refuses unverified addresses and every new account is trust level 0, so a bot that solves the puzzle still earns nothing but a queued revision. The solved salt is burned in Valkey — `verifySolution` checks the HMAC and expiry, both of which a replay satisfies.
- **Forwarded headers are believed only behind a trusted proxy** (`NUXT_BEHIND_TRUSTED_PROXY`). `cf-connecting-ip` used to be taken unconditionally, so anything reaching the origin could mint a fresh rate-limit bucket per request and every policy in `RATE_LIMITS` was decorative. The header is now `x-real-ip`, and **`x-forwarded-for` is deliberately never read**: Bunny sends the CDN address first and the visitor second, so the usual "leftmost is the client" reading would put every visitor in one bucket. Setting the flag without an origin firewall is worse than leaving it off.
- **The session cookie expires.** `maxAge` was unset, which in h3 means the iron seal is sealed with `ttl: 0` — never expiring — and the cookie carries no `Max-Age`. A captured session was valid forever, with no server-side revocation because the session is stateless.
- **sharp is given an explicit `limitInputPixels`.** Its ~268 MP default meant a compressible PNG under the 8 MB body limit could decode to about a gigabyte of resident memory, and `.rotate()` forces the full decode.
- **Detection is not enforcement.** CrowdSec writes decisions; nothing applies them until a bouncer exists. See `docker/security/README.md`.
- Rate limiting **fails open** — a cache outage must not lock everyone out.
- CSP allows only the map asset origins listed in `nuxt.config.ts`.

## Layout

```
e2e/                         Playwright, against the production build (+README)
app/
  assets/css/main.css        design tokens (Tailwind v4 @theme)
  components/
    map/       MapCanvas BasemapSwitcher GeolocateButton MapSearchField Legend FeaturePicker
    site/      SiteDetailPanel SiteGallery SiteGalleryManager SiteMetaList
               SiteExternalLinks SiteEnrichment
    tracing/   TracingDetailPanel
    contribute/ ContributionPanel SiteEditorForm TracingEditorForm GeometryDrawTool ImageUploader
    auth/      LoginForm RegisterForm PasswordField PasswordRequirements
    moderation/ ReviewQueue RevisionDiff ContributorTable
    ui/        ThemeToggle RevisionHistory
  composables/
    map/  useMapInstance useBasemapStyle useViewportTiles useGeolocation useSiteIcons (+__test__/)
    data/ useSiteQuery useSiteEnrichment useImageUrl                                  (+__test__/)
    auth/ useSession
    ui/   useColorScheme useBreakpoint
  layouts/ default.vue (map shell) reading.vue (documents)
  middleware/ authenticated.ts moderator.ts
  router.options.ts          scroll behaviour; the camera hash is not a selector
  pages/ index login register verify forgot-password reset-password
         site/[slug] site/[slug]/edit tracing/[id] tracing/[id]/edit
         moderation/index moderation/contributors
server/
  plugins/ observability.ts   the only per-request hook: id, access log, span
  api/ tiles/[z]/[x]/[y]  sites/  tracings/  auth/  contributions/  moderation/  data/
       images/[id]/[preset]  sites/[id]/enrichment  health ready metrics
  routes/ robots.txt sitemap.xml
  database/ schema/ migrations/ migrate.ts
  utils/ mvt permissions ratelimit images images-order uploads tokens mail diff
         site-record validation
         revisions slug db cache argon altcha enrichment enrichment-sources translate
         logger metrics tracing
                                                                            (+__test__/)
shared/types/  vocabulary shared by both sides
shared/utils/  password policy + authorization rules, shared by both sides   (+__test__/)
scripts/import/  four-stage vici.org import + vici-licences.ts (shared vocabulary)
scripts/warm-tiles.ts snapshot-database.ts reconcile-images.ts
docker/  Dockerfile compose.dev.yml compose.prod.yml traefik/ backup.sh
  observability/  alloy.alloy loki.yml tempo.yml prometheus.yml alerts.yml
                  alertmanager.yml grafana/{datasources,dashboards}
```

## Start here (in this order)

The map, the tile pipeline and the record import now run and have been seen
working against real data. What has _not_ been exercised is most of the
application above the map: auth, contribution, moderation, revisions.

1. `pnpm install`
2. `pnpm stack:up && pnpm db:migrate && pnpm dev`
3. Import — see "Import pipeline" below. The map is populated after
   `import:convert`; photographs come later and cost someone else's bandwidth.
4. `pnpm check` — lint, typecheck, tests and formatting, run in parallel by
   `concurrently` and reported under one exit code. It is the same gate CI
   runs. **It passes; treat any output as a regression rather than as the
   backlog it used to be.** Typecheck in particular was 36 errors and is now
   zero — the `Transaction` alias in `server/utils/revisions.ts` was most of
   them, deriving its type from an overloaded `sql.begin` and collapsing to
   `never`.
5. `pnpm stack:observability` when you need Grafana — see "Observability".
6. `pnpm fix` applies what is mechanically fixable: `lint:fix` then `format`.
   It is deliberately sequential — ESLint and Prettier both rewrite the same
   files, so running them together would have them clobbering each other.

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

Order matters; each step is resumable. The scratch MariaDB is **not** part of
`pnpm stack:up` — read once, thrown away.

```bash
docker run -d --name vici-mysql -p 3307:3306 -e MARIADB_ROOT_PASSWORD=root mariadb:11

pnpm import:fetch           # dumps → scratch MariaDB (reuses db_dumb/ if present)
pnpm import:convert         # → 61,272 sites, 11,720 tracings, 8,692 concordances
pnpm import:image-records   # → 39,212 site_images rows over 36,216 objects; no bytes
pnpm import:images          # → the photographs; ~12 hours, ~10 GB, resumable
pnpm tiles:warm <url>
```

The map is fully usable after `import:convert`; everything after is photographs.

**Contact René Voorburg before mirroring images at scale.** The licences permit
reuse; the bandwidth is his server's. Quote real figures — **36,216 requests**
at 1.2 s apart, ~10 GB — and prove the setup with `MIRROR_LIMIT=5
pnpm import:images` first. Re-running after rebuilding records does **not**
re-download: an object already in storage is adopted (read back, re-measured,
marked approved) with no request and no pause. Without that, every rebuild of
`site_images` would cost him another 36,000 requests.

### Where the photographs live — verified, and counter-intuitive

- `vici.org/uploads/{file}` is a **soft 404**: HTTP 200 with an HTML body saying
  "404 - file not found", so `response.ok` proves nothing and it reaches an
  image pipeline as a corrupt file. Hence the `detectImageFormat` magic-byte
  check in the mirror.
- Photographs come from **`images.vici.org`**; originals are not exposed
  (`/uploads/{file}` there is a real 404). Everything must go through a
  transform.
- Use **`/size/w{width}/uploads/{file}` — width only.** Both `size/w2400xh2400`
  and `crop/w2400xh2400` return exactly that box, distorting or cropping
  anything non-square. Width is capped at the recorded `imgd_width`, so small
  originals are not upscaled.
- Therefore **2400px is a permanent ceiling** for imported photographs, and
  "one original stored per image" cannot hold for this content.

## Observability — what the silence used to hide

Six containers: Grafana, Loki, Tempo, Prometheus, Alertmanager and **Alloy**,
which carries logs, traces and metrics in one agent. Vector was the initial
choice and carries no traces; Alloy also has built-in
`prometheus.exporter.{unix,cadvisor,postgres,redis}`, which is four exporter
containers not run. Promtail, the other candidate, reached EOL in March 2026.

**Everything is on local disk.** R2 was considered and refused: Loki and Tempo
write often enough for Class A operations to be a real line item, and telemetry
is diagnostic rather than a record of record. Retention is 15d metrics, 30d
logs, 7d traces — under 20 GB of the 240 GB disk, and roughly 1.6 GB of RAM.

**Grafana has no Traefik router and binds to loopback.** It holds request logs
containing visitor IPs and the moderation trail. Reach it with
`ssh -L 3001:localhost:3001 <vps>`.

### Why the point was never the dashboards

The app fails open in eight places, every one of them formerly silent. The
worst is `enforceRateLimit`: a Valkey outage removes **every** policy in
`RATE_LIMITS`, including the four signups an hour that `register.post.ts` names
as its defence against account farming, and nothing recorded it.
`rate_limit_decisions_total{outcome="failed_open"}` and the
`RateLimiterFailingOpen` alert exist for that one case. `ready` now counts the
cache too, so the same outage takes the container out of the load balancer
instead of reporting healthy.

### Three traps, all found by running it

- **Sampling must key on `url.path`, not the span name.** Sampling happens at
  span creation, which in Nitro is _before_ routing — `matchedRoute` is
  undefined there, so every span is named `unmatched` at that moment. Keying on
  the name matched nothing and traced every tile at full rate. The span is
  renamed to the route pattern in `beforeResponse`.
- **Child spans need the parent passed explicitly** (`withSpan({ parent })`).
  The server span opens in `request` and closes in `beforeResponse` — two
  callbacks, so there is no call stack to wrap and nothing ambient to inherit.
  Without it, sixty tile requests produced sixty orphaned `postgis.render_tile`
  root traces that also escaped sampling.
- **Never label a metric with an identifier.** Route _patterns_ only:
  `/api/sites/:id`, never `/api/sites/61272`. Sixty thousand sites would
  otherwise be sixty thousand series.

Two PromQL habits the alerts depend on: `or vector(0)` on a division's
numerator, because an empty vector makes an alert unable to fire in exactly the
case it exists for; and excluding read-only filesystems from the disk alert,
since a read-only image mount reports 0% free by definition and fires forever.

### Tracing is manual, deliberately

No `auto-instrumentations-node`. ESM auto-instrumentation needs a loader hook
before any instrumented module loads (`node --import`), but the runtime image
ships only `.output`, so a root-level bootstrap has no `node_modules` to resolve
against. `postgres.js` has no OTel instrumentation package regardless — `pg`
does, and this project does not use `pg`. Spans exist only where `withSpan` is
called, which is the cost; no loader hook and no Dockerfile change is the gain.

**Pino ships no transport in production.** Its transports run in a worker
thread, which Rollup cannot bundle — Nitro tree-shakes the target out and the
process dies at startup looking for a module that was never emitted. Plain JSON
to stdout is what Docker's json-file driver and Alloy want anyway. `pino-pretty`
is guarded behind `import.meta.dev`, where nothing is bundled.

### Reaching the logs

**Development**: `pnpm dev` pretty-prints to the terminal, and that stays the
fast loop. `pnpm stack:observability` adds Grafana on `localhost:3001` when a
dashboard or alert rule needs testing. Traces and metrics work fully; **the
app's own logs do not reach Loki**, because `nuxt dev` runs on the host and
Alloy discovers containers. Container logs do arrive.

**Production**: Pino → stdout → json-file → Alloy → Loki → Grafana over the SSH
tunnel. `docker compose logs -f` still works and is the fallback for when Loki
is itself the broken thing.

### Unresolved

- Nothing mounts `docker/traefik/`, so `deny-external@file` — which keeps
  `/api/metrics` off the public router — rests on the same unconfirmed
  mechanism as `app-rate-limit@file`. Until that is checked on the box, treat
  `/api/metrics` as reachable; it leaks route names and volumes, not data.
- Alertmanager sends through Resend SMTP, reusing `MAIL_API_KEY`. The README
  notes an intent to move to Lettermint; that would move this too.
- Request logs contain IP addresses. 30 days on an EU box is the position, and
  `REDACTED_FIELDS` in `server/utils/logger.ts` is the rest of it.

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

## Enrichment — borrowed prose, and how sure we are of it

`/api/sites/:id/enrichment` returns a Wikipedia extract, or null. **Null is an
ordinary answer.** A server proxy behind Valkey, not a browser fetch: the CSP
allows no Wikimedia origin, one fetch serves every visitor, and Wikidata's
search endpoint refused eight calls spaced 800 ms apart.

Nothing is written to Postgres. Storage would be trivial (~7 MB); the objection
is that the text is CC BY-SA and third-party, so a stored copy makes this a
republisher rather than a linker, and nothing would ever invalidate it. Valkey
keeps a hit 7 days and a refusal 1 day; the browser keeps its own 7 days.

**A concordance is a lead, not a guarantee.** Across 30 sites with a Wikidata
id, coordinates agreed to a median of 53 m — but p90 was 1,050 m and the worst
35.8 km, a Q-id pointing at a modern municipality. A match therefore needs the
identifier **and** a coordinate within 250 m **and** a place type that does not
contradict `category`. That last check is what stops "Castellum Aardenburg"
being described by the article for the _town_ of Aardenburg, and rejects the
Pleiades join resolving to "Aardenburg (Samian Ware Discovery Site)" 1.2 km off.

**Six Wikipedias**: `en`, then `nl`, `de`, `es`, `it`, `fr`. Over 60 random
sites with a Q-id, English alone reached 77%, the set 87%; of 52 matches English
served 46, German 4, Dutch 1, Spanish 1. On Dutch ground it matters far more —
one slice of 14 went from 2 matches to 10.

**Translation is a service we run.** `libretranslate` in both compose files,
internal network only, driven by the `translate` package via
`NUXT_TRANSLATE_URL` — self-hosted so reading a site tells no third party
anything. `LT_LOAD_ONLY` pins the six languages (**1.2 GB of models**, plus an
872 MB image; es→en alone is 302 MB, de 158 MB each way, nl/fr ~80 MB). Without
it every available model loads. `LT_UPDATE_MODELS` is required or a language
added to `LT_LOAD_ONLY` is silently ignored on an existing volume.

Translation happens server-side, so it runs once per site into the same Valkey
entry. **It fails open, and that is load-bearing**: with the container stopped,
Dutch articles still arrive labelled `nl` in under 600 ms. The app deliberately
does not `depends_on` it — a cold volume takes minutes and no deploy should wait
on an optional nicety.

Nothing is passed off as English that is not: translated text says
"Machine-translated from Dutch", untranslated says "In Dutch", and the paragraph
carries `lang` either way. A machine translation of a CC BY-SA article is still
that article's derivative.

Remaining losses are not fixable by loosening the threshold — no article in any
of the six, genuinely too far, or no coordinate to check.

## Not built

- Purging withdrawn images from object storage (withdrawal is reversible by design — nothing deletes bytes).
- Notifications — a contributor learns an edit was accepted by looking.
- Full-text search across descriptions (titles and summaries only).
- RDF / Pelagios linked data. The GeoJSON feed at `/api/data/sites.geojson` exists.
- Offline tile caching. The app is installable as a PWA but needs signal.
- i18n. English only by decision; strings are not yet centralised into one module, which they should be before adding locales. Note the source has `nl`, `de` and `fr` text for thousands of sites — the import takes `en` and discards the rest.
- Off-box backups. `docker/backup.sh` writes nightly to a volume on the same VPS, and `pnpm db:snapshot` writes beside the database it copies. Neither survives losing the machine.
- PWA icons. `public/manifest.webmanifest` references `/icons/icon-192.png`, `-512` and `-maskable`; none of them exist.

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

`docker/compose.prod.yml` is the deployment unit. GitHub Actions runs tests, builds a multi-stage image to GHCR, calls a Dokploy webhook. Traefik terminates TLS. Nightly `pg_dump` kept 14 days.

**One VPS is one failure domain.** Test the restore, not just the dump.

To move from OpenFreeMap to self-hosted tiles: download a Europe + Mediterranean extract from maps.protomaps.com, upload to R2, set `NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles` and `NUXT_PUBLIC_BASEMAP_PMTILES_URL`.

## Working style for this project

Say when something is uncertain rather than guessing silently — several things
here are inferred and flagged as such. Name real trade-offs. Prefer fixing an
unverified assumption over adding a feature.

**Say it once, in the file.** A docstring explaining what something does, why it
exists or how it failed **is** the explanation; it does not get repeated in
chat. Reply with a pointer — "fixed the recursion; the ordering constraint is
documented above `attachOverlay`" — not a paragraph restating it. The transcript
is thrown away, the file is read by whoever comes next, so when the urge to
explain in the reply appears, extend the docstring instead.

Exceptions, because they have no home in the source: what you verified and how,
what is still unproven, a trade-off the user must decide, and any finding that
contradicts what they asked for. Those belong in the reply.

**Also, always:**

- **Mobile first.** Every component optimised for phones (fast load, real UX),
  desktop second but not neglected. Breakpoints: 375px–<768px phone, <1000px
  tablet, above desktop.
- **Fast, clean, modern.** Make it quick, keep it readable, use current best
  practice, lazy-load where it helps.
- **Accessibility every time** — ARIA and the rest, improved where possible.
- **Semantic HTML** — the most fitting tag, always.
- **Short answers in chat**, without dropping anything important.
- **ORM over string queries.**
- **Install type packages** whenever they exist, and use those types.
- **Open source** look for established open source projects to solve some problem first instead of
  writing the logic yourself directly. Then ask for decision
- **Agents** may be used, but ask for permission before
- **Planning mode** while in planning mode, instead of writing the plan to a temporary file or chat, save it under
  ".plans" automatically and open it.
- **Completed tasks** when having completed a task, never print the achieved goals to the chat, keep it clean
- **EU/GDPR compliance** all packages or code dealing with user data or which are user-related must be GDPR compliant
