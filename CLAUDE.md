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
| **Lettermint**                           | Transactional mail, hosted in the EU. Replaced Resend, whose only fault was being US-hosted for data — addresses, display names — that the CDN and object-store moves had already brought back inside the EU.                        |
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

## Antiquity basemaps — one borrowed, one built

The switcher offers four views in two groups. Two are recolourings of one
modern vector source; the two **antiquity** views replace it outright. A third
modern view, `terrain`, was deleted: it was the `vestigia` palette with one
hillshade layer spliced in, and the same elevation source does better work as
`atlas-hillshade` under the Barrington sheet — so the relief is still on the
map and the option was a fourth way of looking at the same roads.
`NUXT_PUBLIC_BASEMAP_TERRAIN_URL` stays; the tiles are still fetched.

**Antiquity (DARE)** is raster, from `dh.gu.se/tiles/imperium` — Johan Åhlfeldt,
Gothenburg. CC BY-SA 3.0 with attribution and a link, per his terms page. **But**
DARE's own legend credits two inputs as CC BY-NC 3.0 and CC BY-NC-SA, which the
blanket BY-SA cannot cover: the rendered tiles bake in layers DARE itself calls
non-commercial. Acceptable while nothing here is sold; the wrong dependency the
day it is. Mirrored with `pnpm import:basemap dare` — z3–z10 over Europe and the
Mediterranean, **29,593 tiles** at a measured 40 KB mean (~1.2 GB), one request
every 1.2 s. **Tell Åhlfeldt before the full run** (johan.ahlfeldt@lir.gu.se) and
quote that number, exactly as with René Voorburg's photographs; ask about the
NC-credited inputs in the same message. Until
`NUXT_PUBLIC_BASEMAP_ANTIQUITY_DARE_URL` is set the app falls back to his server.

**Antiquity (Barrington)** is ours, and the more interesting one. The CAWM tile
server that was going to supply it publishes _physical relief only_ — no roads,
no names, no settlements — so mirroring it would have bought a beautiful empty
map. What makes it an atlas is published separately as open data, so the data is
imported and this project draws the sheet itself:

| Layer                    | Source                                               | Rows   |
| ------------------------ | ---------------------------------------------------- | ------ |
| Ancient coastline        | AWMC `shoreline`                                     | 9,901  |
| Sea and inland water     | AWMC `open_water` (10 of 20 regions), `inland_water` | 13,907 |
| Roads                    | AWMC, from the Barrington Atlas                      | 3,166  |
| Aqueducts, canals, walls | AWMC                                                 | 477    |
| Urban extents            | AWMC                                                 | 95     |
| Regions and peoples      | AWMC `regional_name_linework`                        | 2,618  |
| Places                   | Pleiades                                             | 38,002 |

Places carry a **mark**, not just a name: Pleiades' free-text `featureTypes` are
collapsed once at import into the same nine categories the contributed records
use (`resolvePlaceCategory`), so one key explains the whole map. **They are drawn
as annotation — the same glyphs with no disc behind them and a thinner line.**
Twenty-two thousand borrowed places against sixty-one thousand contributed
records, given identical markers, would make the atlas look like the work; the
legend says so too when an antiquity view is showing. A place Pleiades does not
classify — a river, a cape, a people — gets its name and no mark, because
inventing a symbol would claim a site where the source records a landscape. So
does a place Pleiades declines to locate: `unlocated` and `related` rows carry a
representative point that is a filing convenience, and 8,545 of them are dropped
rather than drawn.

Relief comes from the elevation tiles at `NUXT_PUBLIC_BASEMAP_TERRAIN_URL`. CAWM's
raster sheet is exactly that and nothing else, and mirroring it would have cost
3.2 GB and thirty thousand requests to Iowa for imagery carrying no information
this map does not already draw. Where the ground genuinely has changed — a
silted harbour, a shifted delta — it is the coastline that records it, and that
comes from AWMC.

`pnpm import:atlas`, which downloads to `.import/atlas/`, replaces each layer
wholesale and bumps the atlas cache generation itself. `ATLAS_SKIP_OPEN_WATER=1`
omits the 240 MB of sea polygons and still gives a usable sheet. ~75 MB in
Postgres.

**AWMC is ODbL 1.0 and Pleiades is CC BY 3.0, which is why every row lives in
its own `antiquity_*` table and is never joined to `sites`.** ODbL's share-alike
attaches to a derivative _database_: folding these into the tables behind
`/api/data/sites.geojson` would arguably pull that feed under ODbL and
contradict the CC BY-SA / CC0 the contributed data carries. Rendered tiles are a
Produced Work and need only the attribution the style carries. Do not merge them.

Four things about these views that are not obvious:

1. **The overlay follows the _sheet_, not the theme** (`resolveSheetTone`).
   Parchment is parchment at midnight, and the night palette — pale ink on a
   dark disc — drawn on it makes every site marker vanish with nothing logged.
   Dark mode dims the surround instead, so the sheet reads as paper under a lamp.
2. **Tile URLs must be absolute.** MapLibre builds requests inside a worker,
   where a root-relative path has no base: `new Request('/api/tiles/…')` throws
   and the source silently loads nothing while the rest of the style renders.
3. **Atlas tile filters compare in 4326**, against the tile envelope transformed
   into it — never `ST_Transform(geom, 3857) && env`, which cannot use the GiST
   index and measured 1.1–2.6 s per tile against 3–60 ms.
4. **The atlas has its own cache generation**, and `getAtlasVersion` reads an
   unset key as 1 — so the first `INCR` by hand is a no-op. The import clears
   the key and the stale tiles itself; do not do it manually.

## The limes — a switch on the Barrington sheet

Not a fifth view. **Follow the limes** is a switch inside the antiquity group of
the basemap switcher, shown only when the Barrington sheet is chosen, and
`buildAtlasStyle(source, { limes })` is the same function either way — forking
it would have left two copies of a hundred layer specs to drift. There is a test
asserting the switch-off layer list is byte-for-byte what it was.

**There is no open dataset of "the limes".** There is one of where the empire
ended, which is the same thing: the boundary of AWMC's
`roman_empire_ce_200_extent` polygon, minus a 6 km buffer around the ancient
shoreline already in `antiquity_lines`. Measured, not assumed —
**5,123 km in 11 runs** over Europe and the Mediterranean, ~12,000 km over the
whole empire, against UNESCO's "over 5,000 km". The built works come from the 92
rows of `antiquity_lines.kind = 'wall'` the atlas import already loads.

`shared/utils/limes.ts` is the one editorial input: **names, dates, prose and a
bounding box** for seventeen sectors. Every metre of geometry is AWMC's. The
import reports every run and wall no sector claimed — deliberately including
~2,200 km of southern Egyptian desert edge, which was a provincial boundary and
not a frontier system, and the city and isthmus walls in AWMC's `walls` layer.

`pnpm import:limes`, after `pnpm import:atlas`. One 553 KB download and about a
minute of PostGIS; ~2 MB in Postgres. It rides the **atlas** cache generation
rather than a third counter and clears `limes:v*` alongside `atlas:v*`.

Seven things that are not obvious, five of them found by running it:

1. **`line-dasharray` is not data-driven.** A `match` on the segment's kind is
   the obvious way to draw a wall solid and a river dashed, and MapLibre accepts
   the style without complaint — the property is cross-faded, so the expression
   is ignored and every stretch comes out solid. One layer per kind.
2. **`ST_Union` then `ST_LineMerge` does not give you a course.** A sector's
   stretches cross constantly — Hadrian's Wall is the derived province edge plus
   ten pieces of wall linework running through it — and unioning nodes every
   crossing. The merged result was a four-point line that went 35 km west and
   came back, and every fort on the wall then located to the same point on it.
   Merge each stretch on its own and take the longest.
3. **`ST_LineLocatePoint` clamps.** Everything past either end of the path
   projects onto its first or last vertex, so a dozen forts beyond the western
   terminus opened the roll all reading "at the start". Anything that clamps
   from further out than `TERMINUS_METRES` is past the end of the stretch, not
   on it.
4. **Sector bounds overlap, so claiming must be exclusive.** A stretch is
   clipped into every sector it crosses — one Danube run legitimately spans
   Noricum, Pannonia and Moesia — but where two sectors accepting the same kind
   share ground, the earlier subtracts from the later. 209 km was in the
   database twice before `claimLimesSectors` did this.
5. **`Shape_Area` in AWMC's extent files lies.** Britain's polygon carries
   `Shape_Area: 0.0` in the 200 CE file, so filtering mainland masses on it
   dropped the entire British frontier while the import reported success. The
   filter measures the polygon's own extent instead.
6. **Two source populations, drawn apart.** Contributed fortifications get the
   plan marks with a disc; Pleiades military places get the same marks as
   annotation. Each layer excludes what the other draws, or every tower on the
   wall carries two glyphs stacked on one point.
7. **`sites.subcategory` is why turrets read as turrets.** `CATEGORY_BY_KIND`
   collapses vici's `fort`, `watchtower` and `camp` into one `fortification`
   category; the column keeps the source's own word beside it. Re-running
   `import:convert` fills it through
   `ON CONFLICT … DO UPDATE … WHERE subcategory IS NULL`, the only column a
   re-run may overwrite. 12,804 fortifications split into 6,914 watchtowers,
   5,551 forts, 339 camps.

**Licence:** the sector tables are ODbL, like `antiquity_*`, and are never
joined to `sites`. The one judgement call is `offsetMetres` in
`/api/limes/sectors/:slug` — a position measured against ODbL geometry for
records that are not ODbL. It is computed **on read and never stored**, and
`/api/data/sites.geojson` gains no field from it, so what leaves is a Produced
Work with both attributions attached. See the docstring on that endpoint.

## OpenAPI

Every route under `server/api/` declares `defineRouteMeta({ openAPI: {...} })`
for `tags`, `summary` and `description` — and only those three. **`defineRouteMeta`
is a build-time macro, not a runtime call**: its argument is parsed as an AST
(`nitropack/dist/rollup/index.mjs`'s `astToObject`) and only object/array
literals of literals survive. A function call — `paramsFromSchema(schema)` — or
a bare reference to an imported constant returns `undefined` there, silently,
with no build error. `tags`/`summary`/`description` are written as string
literals and come through; `parameters`, `requestBody`, `responses` and
`security` cannot be, since they need to be derived from the same zod schema a
handler actually validates against — so they do not live in `defineRouteMeta`
at all.

Instead, `server/api/openapi.json.get.ts` fetches Nitro's own auto-generated
document (moved to the internal path `/_nitro-base-openapi.json` via
`nitro.openAPI.route` in `nuxt.config.ts` specifically so nothing collides with
this route) and merges in `parameters`/`requestBody`/`responses`/`security` by
path and method, built from each route's real, already-`export`ed zod schema
via `zodToJsonSchema` (`server/utils/openapi.ts`). One schema, not two — a route
whose validation changes and whose documentation does not is worse than no
documentation.

Both of Nitro's bundled UIs (`/_scalar`, `/_swagger`) are switched off in
`nuxt.config.ts` (`openAPI.ui`). Both load their renderer from
`cdn.jsdelivr.net` — the exact third-party runtime request self-hosted fonts,
self-hosted glyphs and ALTCHA-over-Turnstile all exist to avoid — and the CSP
here would refuse it silently, the same way the missing nonce token once did.
`/api/openapi.json` is same-origin JSON in development; paste it into
Insomnia, Postman or scalar.com's own hosted reference rather than serving a
UI bundle from this app.

**Dev only — 404s in production.** A machine-readable map of every route,
parameter and response shape is a development convenience, not something to
leave reachable on the public internet, even though each endpoint underneath
still enforces its own auth guard and rate limit regardless of whether its
shape is documented anywhere. Two independent guards: `nitro.openAPI.production`
is `false` in production, so Nitro's own base document
(`/_nitro-base-openapi.json`) stops being generated at all; and
`server/api/openapi.json.get.ts` refuses outright on `!import.meta.dev` before
it ever fetches that base document, rather than relying on the fetch failing
to fail this route indirectly.

## SEO

No SEO npm module (`@nuxtjs/sitemap`, `@nuxtjs/robots`, `nuxt-og-image` and
friends) — everything below is hand-rolled Nitro routes/composables, on
purpose: `sitemap.xml.get.ts` already does the hard part these modules exist
to save you from (DB-driven URL discovery across two entity types plus
dynamic limes sectors), so wrapping that in a generic module's config shape
would buy nothing and add a build-hook surface to reconcile with
`nuxt-security`'s CSP.

**Sitemap is an index, not one file.** `sitemap.xml.get.ts` returns a
`<sitemapindex>` pointing at `sitemap-static.xml` (the hand-written pages and
every limes sector), and `sitemap-sites/{page}` / `sitemap-tracings/{page}` —
paginated at `SITEMAP_PAGE_SIZE` (`server/utils/sitemap.ts`) rows per file,
comfortably under the sitemaps.org 50,000-URL/50MB cap per file. Sites alone
(61k+) already exceeded a single file's cap; tracings (11.7k) were missing
from the sitemap entirely before this. Pages are ordered `updated_at desc, id
desc` — the `id` tiebreaker matters because bulk-imported rows routinely
share a timestamp, and `updated_at` alone can skip or duplicate a row across
a page boundary. `changefreq`/`priority` are deliberately not emitted —
Google's own docs say both are largely ignored, and there's no honest
frequency to invent for moderation-gated content.

**robots.txt disallows crawling, page-level `noindex` disallows indexing.**
These are different mechanisms and this app uses both: `robots.txt` keeps a
crawler from spending budget on `/login`, `/register`, `/site/*/edit`, etc.,
but an already-linked disallowed URL can still be indexed sans content —
`useNoIndex()` (`app/composables/data/useNoIndex.ts`) closes that gap on the
same pages plus `/moderation`, `/verify`, `/reset-password`.

**Canonical URLs never carry a query string.** `useCanonicalUrl()` always
resolves to the bare `route.path`, never `route.fullPath` — there is no
filtered or paginated content view in this app today, so a query param
reaching a canonical would only ever be noise, and stripping it defensively
now avoids inventing a rule later once one exists.

**Structured data (JSON-LD) lives in `shared/utils/structuredData.ts`**, not
`server/utils/` — the builders are called from page `<script setup>` blocks,
which run in the Nuxt app, and `server/utils/` is Nitro-only and not part of
that module graph. Sites and tracings are both `@type: "Place"` (not
`ArchaeologicalSite` — not a real schema.org type). Tracing geometry
(GeoJSON Line/Polygon) is never encoded as `geo` — schema.org's `GeoShape`
has poor real-world rich-result support, so omitting it beats emitting
something a crawler silently ignores.

**OG images: a real photo when one exists, a static category card otherwise.**
`IMAGE_PRESETS.og` (1200×630, Open Graph's documented size) reuses the
existing signed imgproxy redirect at `/api/images/:id/og` — no CSP change
needed, since `og:image`/`twitter:image` are fetched directly by the sharing
platform's scraper, never loaded as an in-page `<img>`. Entities with no
photo (every tracing — `site_images` has no FK to `tracings` — and any site
with zero approved images) fall back to one of the eleven static cards in
`public/og/`, regenerated by `pnpm og:build`
(`scripts/generate-og-placeholders.ts`). Per-entity dynamic OG rendering
(the title actually burned into the card) is deliberately deferred: Open
Graph only requires a reachable, correctly sized image, and a headless-
browser or Satori/SVG render pipeline is a real new dependency for a purely
cosmetic gain.

**`hreflang` is not implemented, and should not be.** With i18n's `no_prefix`
strategy there is exactly one URL per page regardless of locale, and
`hreflang` alternates require distinct crawlable URLs per language variant —
tags here would either no-op or read as contradictory duplicates. See the
comment on the `i18n` block in `nuxt.config.ts` for the two cheap
mitigations instead (`htmlAttrs.lang`, already correct; the
`Content-Language` response header from `server/middleware/content-language.ts`).

`pnpm icons:build` (`scripts/generate-app-icons.ts`) rasterizes
`public/favicon.svg` into the three PWA icon files `manifest.webmanifest` has
referenced from the start — a maskable icon needs its artwork rendered at
80% and centred, per the W3C's safe-zone convention, not a plain resize, or
content gets clipped the moment an OS masks the icon to a circle.

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
reads `ST_X`/`ST_Y` through Drizzle, as `` sql`ST_X(${schema.sites.geom})` `` inside
a normal `.select()`: table, columns and enum literals stay checked, and only the
two accessors are raw. Reach for `useSql()` when the _statement shape_ is beyond
the builder, not when one expression is.

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
- **A decision reaches the person it was made about.** `review`, `review-batch`
  and `trust` mail the author or the account after the write, never before, and
  a mail failure can never undo a decision that has already been applied — see
  `server/utils/notifications.ts`. A revert is excluded: its author is the
  moderator, so the mail would report someone's housekeeping back to them.
  The review queue and the contributor list send the moderator's own words with
  it — the note per revision, the reason for a suspension. Both are optional and
  the copy adapts, but a rejection with nothing in it is a decision the author
  cannot act on, which is why suspending is now two clicks with a field between
  them.
- **Nobody can change their own role** (`checkRoleChange`), which is also what keeps an instance from losing its last admin — that rule's own `last-admin` branch cannot be reached, since removing the final admin requires being them. See the comments in the function.
- **Role and trust are re-read from the database inside every guard.** The session cookie is sealed at login and nothing refreshes it, so reading a role from it let a demoted moderator keep moderating until they logged out. `requireModerator`/`requireAdmin` cost one primary-key lookup and are the reason a demotion bites on the next request.
- **Slugs never change on edit.** Inbound links, citations and the sitemap point at them.
- Suspension leaves `approved_contributions` untouched, so restoring trust returns someone exactly where they were.

## Security invariants — do not weaken these either

- argon2id at OWASP parameters. Login always hashes (against `DUMMY_HASH` when no user matches) so timing cannot enumerate the user table.
- `forgot-password` responds **identically** whether or not the address exists. Registration no longer does: a duplicate email or display name is reported as a 409 so the person can try again. That was a deliberate trade of the enumeration guarantee for a form that is not a dead end — see the comment in `server/api/auth/register.post.ts`, which records what still throttles it and what the alternative was.
- Only the SHA-256 **hash** of an email token is stored; comparison is constant-time.
- **A password reset tells the owner it happened.** The reset link goes to an
  inbox an attacker may already hold; this message lands afterwards and is the
  only point at which the real owner finds out, so it names the recovery route
  rather than merely confirming.
- **An unverified login re-sends the confirmation link**, at most one per
  quarter of an hour. It sits _below_ the credential check on purpose: after a
  correct password there is nothing left to enumerate. Without it the flow dead
  ends — the first link is worth nothing after a day, login refuses an
  unconfirmed address, and nothing else issues another.
- **Mail delivery never throws.** A provider outage that propagated would make
  `forgot-password` answer 500 for a registered address and 200 for an unknown
  one — the exact oracle the identical-response rule exists to close. Failures
  land in the log and in `mail_deliveries_total{outcome="failed"}` instead.
- **Nothing a user typed reaches an inbox as markup.** Display names and the
  submitted address are escaped by `renderTokenEmail`; that is what
  `mail-template`'s tests are for.
- Uploads: the declared content type is a hint. Format is read from **magic bytes** (`detectImageFormat`), and every image is **re-encoded through sharp**, which strips EXIF and guarantees the stored object is a plain JPEG. Storage keys derive from database ids, **never** from the uploaded filename.
- Images with an unresolved licence (`UNKNOWN`) or `ARR` are never published.
- Signup: **self-hosted ALTCHA** proof of work + honeypot (positioned off-screen, not `display:none`) + per-IP rate limit + email verification. ALTCHA replaced Turnstile to remove the last third-party runtime dependency; it prices automated signup rather than detecting it, which is **weaker** against a funded attacker. That is acceptable only because login refuses unverified addresses and every new account is trust level 0, so a bot that solves the puzzle still earns nothing but a queued revision. The solved salt is burned in Valkey — `verifySolution` checks the HMAC and expiry, both of which a replay satisfies.
- **Forwarded headers are believed only behind a trusted proxy** (`NUXT_BEHIND_TRUSTED_PROXY`). `cf-connecting-ip` used to be taken unconditionally, so anything reaching the origin could mint a fresh rate-limit bucket per request and every policy in `RATE_LIMITS` was decorative. The header is now `x-real-ip`, and **`x-forwarded-for` is deliberately never read**: Bunny sends the CDN address first and the visitor second, so the usual "leftmost is the client" reading would put every visitor in one bucket. Setting the flag without an origin firewall is worse than leaving it off.
- **The session cookie expires.** `maxAge` was unset, which in h3 means the iron seal is sealed with `ttl: 0` — never expiring — and the cookie carries no `Max-Age`. A captured session was valid forever, with no server-side revocation because the session is stateless.
- **sharp is given an explicit `limitInputPixels`.** Its ~268 MP default meant a compressible PNG under the 8 MB body limit could decode to about a gigabyte of resident memory, and `.rotate()` forces the full decode.
- **Detection is not enforcement.** CrowdSec writes decisions; nothing applies them until a bouncer exists. See `docker/security/README.md`.
- Rate limiting **fails open** — a cache outage must not lock everyone out.
- CSP allows only the map asset origins listed in `nuxt.config.ts`.
- **`nuxt-security`'s `xssValidator` is off** (`security.xssValidator: false` in
  `nuxt.config.ts`), and that is a considered decision, not a gap. It ran every
  GET query and POST body through the `xss` package's `FilterXSS`, then
  rejected the request outright the moment filtering changed a single byte.
  `FilterXSS` HTML-escapes any `<` it cannot parse as a tag it recognises, so a
  site summary reading "the wall is <2m tall" or a field note with "<1m wide"
  was escaped to `&lt;2m` and refused — identically to `<script>alert(1)`,
  because the check only asks "did anything change", not "was anything
  dangerous". No whitelist option fixes that: it is what the library is for,
  applied to a body it assumes is HTML rather than JSON carrying free prose.
  Turning it off is safe here specifically because **there is no `v-html`
  anywhere in this app** (`grep -rn v-html app/` returns nothing), so every
  value a Vue template renders is escaped by `{{ }}` regardless of this
  middleware, and the two surfaces that are not Vue-rendered already encode for
  their own context explicitly and are unit-tested for it: HTML mail
  (`mail-template.ts`'s `escapeHtml`) and the GPX field kit (`gpx.ts`'s
  `escapeXml`). If a `v-html` is ever added, this decision needs revisiting
  before that lands, not after.

## GDPR / legal

Not legal advice — the operator's real identity still has to go into
`app/pages/impressum.vue` and the controller/supervisory-authority blocks of
`app/pages/privacy.vue` before either goes live, and a lawyer should read both
before real users see them. What follows is the technical side, verified
against the actual code rather than assumed.

**No cookie-consent banner exists, and none should be added.** The app sets
exactly three cookies — `nuxt-session` (7 days, `nuxt.config.ts`'s
`session.maxAge`), `vestigia-color-mode`, `vestigia-locale` — and all three
are strictly necessary for functionality the visitor directly requested.
There is no analytics, no tracking pixel, no advertising cookie anywhere in
the app (confirmed by grep, not assumed). §25(2) TDDDG — the German
implementation of the ePrivacy Directive — exempts exactly this case: consent
is required for storing or reading something on a device, not for cookies a
requested feature cannot work without. A banner here would be consent theatre
for cookies that need none. If a future change adds analytics or an
advertising cookie, **that** is what needs a banner — the exemption stops
applying the moment a cookie exists that a visitor could reasonably decline.

**Right to erasure** (`server/api/auth/account.delete.ts`) anonymises the
`users` row — email becomes `deleted-{id}@vestigia.invalid` (`.invalid` is the
TLD RFC 2606 reserves for exactly this), display name becomes
`Deleted account #{id}`, password hash becomes `DUMMY_HASH` — rather than
deleting it outright. `revisions.author_id`, `sites.created_by`,
`tracings.created_by` and `site_images.created_by` are all
`ON DELETE SET NULL`, so a hard delete would work too, but every erased
contributor's history would then read the same generic fallback with no way
to tell one from another. Anonymising keeps history exactly as legible as it
is for anyone else, while erasing everything that identifies the person. The
content of past contributions is kept, not the identity — the Art. 17(3)(d)
exemption for archival material of public interest, which is a reasonable
position for a cultural-heritage atlas but, like everything else on this
page, not a substitute for legal review of that specific argument. A
confirmation mail is sent to the _original_ address before it's overwritten,
per the project's standing rule that a decision reaches the person before
it's irreversible — see "A decision reaches the person it was made about"
under "Governance model."

**Right to access/portability** (`server/api/auth/export.get.ts`) returns the
caller's own account fields plus every site, tracing, image and revision they
authored, as JSON. Scoped entirely by the caller's own session id — there is
no admin variant of this endpoint.

**IP addresses are logged and retained 30 days** (Loki, per
`docker/observability/loki.yml`'s `retention_period`), on the
legitimate-interest basis of operating and securing the service — this
matches what `server/utils/logger.ts`'s `REDACTED_FIELDS` already does not
scrub (passwords, emails and tokens are redacted; IPs are not, deliberately,
since abuse investigation needs them). Rate-limit keys in Valkey embed a
plaintext IP for at most one hour (`RATE_LIMITS`' longest window).

**CrowdSec's `DISABLE_ONLINE_API: 'false'`** (`docker/compose.prod.yml`)
shares IP addresses flagged as abusive with CrowdSec's central community
blocklist — the one outbound flow of visitor-derived data that isn't proxied
or EU-internal, on the same legitimate-interest basis as the request logs.
Documented in both the compose file and `privacy.vue`'s recipients section;
previously undocumented anywhere.

**Wikidata, Wikipedia and Pleiades never see a visitor's IP** — confirmed in
`server/utils/enrichment-sources.ts`'s own docstring and unchanged by this
audit: the server proxies every call, so only the server's own request
reaches these non-EU services. **Mapterhorn's basemap tiles are fetched
directly by the browser** (`mapAssetOrigins` in `nuxt.config.ts`), so a
visitor's IP does reach that host the way it would for any embedded map — its
hosting location is not confirmed in this repository and should be verified
before the privacy policy's recipients section is treated as final.

## Layout

```
e2e/                         Playwright, against the production build (+README)
i18n/locales/ en fr es de it nl .json    bootstrapped by scripts/i18n/translate-locales.ts
app/
  assets/css/main.css        design tokens (Tailwind v4 @theme)
  components/
    map/       MapCanvas BasemapSwitcher GeolocateButton MapSearchField Legend FeaturePicker
    site/      SiteDetailPanel SiteGallery SiteGalleryManager SiteMetaList
               SiteExternalLinks SiteEnrichment
    tracing/   TracingDetailPanel
    contribute/ ContributionPanel SiteEditorForm TracingEditorForm GeometryDrawTool ImageUploader
    auth/      LoginForm RegisterForm PasswordField PasswordRequirements AccountMenu
    moderation/ ReviewQueue RevisionDiff ContributorTable
    limes/     LimesPanel
    notebook/  NotebookControls MilestoneStamps
    ui/        ThemeToggle LanguageSwitcher RevisionHistory
  composables/
    map/  useMapInstance useBasemapStyle useViewportTiles useGeolocation useSiteIcons
          useNotebookOverlay                                                           (+__test__/)
    data/ useSiteQuery useSiteEnrichment useImageUrl useCanonicalUrl useNoIndex useSocialMeta
                                                                                       (+__test__/)
    auth/ useSession
    user/ useNotebook
    limes/ useLimes
    ui/   useColorScheme useUiLocale useBreakpoint                                      (+__test__/)
  layouts/ default.vue (map shell) reading.vue (documents)
  middleware/ authenticated.ts moderator.ts
  router.options.ts          scroll behaviour; the camera hash is not a selector
  pages/ index login register verify forgot-password reset-password
         licence privacy impressum settings
         notebook/index notebook/visits notebook/contributions
         contributor/[name]
         site/[slug] site/[slug]/edit tracing/[id] tracing/[id]/edit
         limes/index limes/[slug]
         moderation/index moderation/contributors
server/
  plugins/ observability.ts   the only per-request hook: id, access log, span
  middleware/ content-language.ts   sets Content-Language from the locale cookie
  api/ tiles/[z]/[x]/[y]  tiles/antiquity/[z]/[x]/[y]
       tiles/limes/[z]/[x]/[y]
       sites/  tracings/  contributions/
       auth/ (+ account.delete.ts export.get.ts change-password.post.ts change-email.post.ts)
       me/ (index.get/patch contributions visits bookmarks map.geojson field-kit.gpx)
       contributors/[name]
       moderation/  data/  limes/
       images/[id]/[preset]  sites/[id]/enrichment  health ready metrics openapi.json
  routes/ robots.txt sitemap.xml sitemap-static.xml
          sitemap-sites/[page]  sitemap-tracings/[page]
  database/ schema/ (users sites notebook geo atlas) migrations/ migrate.ts
  utils/ mvt atlas limes openapi permissions ratelimit images images-order uploads tokens diff
         notebook gpx
         mail mail-template notifications
         site-record validation
         revisions slug db cache argon altcha enrichment enrichment-sources translate
         logger metrics tracing sitemap
                                                                            (+__test__/)
shared/types/  vocabulary shared by both sides
shared/utils/  password policy, authorization rules, the limes gazetteer, JSON-LD builders
                                                                              (+__test__/)
scripts/import/  four-stage vici.org import + vici-licences.ts (shared vocabulary)
                 04-mirror-basemap-tiles.ts 05-antiquity-atlas.ts 06-limes.ts
scripts/generate-og-placeholders.ts  static per-category Open Graph cards, run by hand
scripts/warm-tiles.ts snapshot-database.ts reconcile-images.ts build-glyphs.ts
scripts/i18n/translate-locales.ts   bootstraps i18n/locales/{fr,es,de,it,nl}.json via LibreTranslate
public/fonts/    self-hosted SDF label glyphs + the font's OFL
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
7. Git hooks run automatically after `pnpm install` (Husky's `prepare` script,
   alongside `nuxt prepare` in `postinstall`). **pre-commit** runs
   `lint-staged` — the same `eslint --fix` then `prettier --write` order as
   `pnpm fix`, scoped to staged files. **commit-msg**
   (`scripts/verify-commit-msg.ts`) rejects an empty or under-10-character
   subject; it is a structural check, not a conventional-commits gate — this
   repo's own log is lowercase, imperative, no type prefix, and the hook
   protects that style rather than replacing it. **pre-push** runs the full
   `pnpm check`, the same gate CI runs, so a bad push is caught locally first.

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
- **`sites.country_code` is null on all 61,272 imported rows.** The column
  exists, the schema declares it, and nothing in the vici import fills it —
  measured, not assumed. Two things quietly depend on it: the notebook's
  "Countries" count reads 0 for everyone, and the `five-countries` milestone is
  unreachable. Neither is wrong, both are inert. `geo_names` already holds what
  a reverse-geocode backfill would need, so this is a one-off script rather
  than a schema question; until it is run, do not build anything else on that
  column.

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
pnpm import:basemap dare    # → the DARE sheet; ~10 hours, ~1.2 GB, resumable
pnpm import:atlas           # → the Barrington sheet: AWMC + Pleiades into PostGIS
pnpm import:limes           # → the frontier, derived from the atlas; ~1 minute
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

Neither snapshot leaves the machine yet — see "Not built".

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

**`/api/sites/:id/enrichment` now takes `lang`** (one of the six enrichment
languages, `shared/types`' `ENRICHMENT_LANGUAGES`), defaulting to
`translate.target` when omitted. The Valkey cache key is
`` `enrich:v3:${siteId}:${lang}` `` — language-scoped, unlike the earlier
`v3:${siteId}` key, because without it whichever visitor happened to warm the
cache first would silently serve their translation to every other language's
request for the same site. `loadWikidataFacts` also takes the target language
and tries that Wikipedia edition first, before falling back to the fixed
`en, nl, de, es, it, fr` order — a native article in the language actually
being read beats a machine translation of the English one, which is the same
gap the sampling above already measured.

## i18n

Six languages — French, Spanish, English, German, Italian, Dutch — via
`@nuxtjs/i18n`, `strategy: 'no_prefix'`. The locale lives in a cookie
(`vestigia-locale`), not the URL: slugs never change on edit and the sitemap
points at them, and prefixing every route with `/fr`, `/de`, … would double
the URL surface six times over with no `hreflang` investment to back it, for a
change that is about interface text and enrichment content, not localized
routing.

`i18n/locales/en.json` is the central message catalogue this file used to call
a prerequisite for adding locales at all — namespaced by the same folder
grouping as `app/components/` (`map.basemapSwitcher.*`, `auth.login.*`, …), so
a key's home is obvious from its name. The other five are bootstrapped from it
by `pnpm i18n:translate` (`scripts/i18n/translate-locales.ts`) against the
self-hosted LibreTranslate instance — once, offline, not per request the way
enrichment translation is: UI chrome does not change per visitor, so there is
no reason to pay a translation call on every page load for it. The script never
sends an ICU placeholder (`{id}`) to the translator at all — it splits each
string around its placeholders and translates only the surrounding text,
splicing the placeholder back in verbatim, because the first version tried
substituting a token (`⟦0⟧`) instead and the real LibreTranslate instance
silently dropped it rather than preserving it: "Select revision {id}" came
back as "Selecteer revisie:" with nothing about the response looking wrong
until something tried to interpolate into it. It also writes progress after
every key rather than once at the end of a language — the first run hung on
`nl`'s very first call with no timeout and no partial file to show for it —
is resumable (a key already translated to something other than the English
source is left alone), and reports any key LibreTranslate returned nothing
useful for so a human knows what still needs a manual pass. The five output
files are static, checked-in
JSON, editable afterward like any translation.

**`pnpm i18n:translate` preflights the LibreTranslate endpoint** (`/languages`,
resolved against the origin of `NUXT_TRANSLATE_URL` — that variable already
points at `/translate`, so naively appending `/languages` to it hits a 404 that
looks identical to a dead service) with its own 5s timeout before starting.
Without it a dead arbiter (below) hangs the whole run instead of failing fast
with a message that says what to do.

**LibreTranslate's gunicorn arbiter has been observed dropping to zero
workers, twice, and `init: true` alone does not fix it.** Its own entrypoint
runs gunicorn with `--max-requests 250`; the burst of small requests
`translate-locales.ts` fires hits that ceiling on both `LT_THREADS` workers
within about a minute of each other, and gunicorn is supposed to spawn a
replacement the instant it retires one ("Autorestarting worker after current
request") — confirmed by container logs, twice, that it sometimes does not.
The container keeps listening and the healthcheck can still pass on stale
luck, so every request queues forever with nothing to accept it. `init: true`
(tini as PID 1, the standard fix for a dockerized process losing signals) is
kept in both compose files as correct hygiene but was tried first and did
**not** stop this from recurring, which is what proves the arbiter itself is
wedging — plausibly in a `child_exit` hook tied to the Prometheus multiprocess
cleanup the entrypoint sets up — rather than a signal-reaping problem. The
actual fix is `autoheal` (`willfarrell/autoheal`, both compose files):
`libretranslate` carries `labels: { autoheal: 'true' }` and a healthcheck cut
from `retries: 30` to `3`, so `unhealthy` is reached in well under a minute
instead of five, and the sidecar restarts the container itself — nothing in
this repo can fix gunicorn's own arbiter, so restarting around it is the
whole mitigation. `docker restart vestigia-dev-libretranslate-1` is still the
manual fallback if autoheal hasn't caught up yet, and the preflight check
above is what turns a still-wedged arbiter into a clear message instead of a
silent hang in the meantime.

**The pre-commit hook keeps the five locales from drifting.** When
`i18n/locales/en.json` is staged, `.husky/pre-commit` runs
`scripts/i18n/translate-locales.ts` before `lint-staged` and stages whatever
it changes — the script is already resumable and a no-op in well under a
second when nothing is pending, so this costs nothing on a commit that didn't
touch strings. A translation failure (LibreTranslate unreachable, most likely)
blocks the commit with the same message the script prints standalone, rather
than letting an English source change ship with four stale locales and a
fifth that quietly reads the same as English.

`app/composables/ui/useUiLocale.ts` wraps `useI18n()` the way `useColorScheme.ts`
wraps `useColorMode()` — except colour mode leans entirely on `@nuxt/ui`'s
built-in module for persistence, and there is no locale equivalent, so the
cookie handling is new here. `LanguageSwitcher.vue` sits beside
`ThemeToggle.vue` in both layout headers.

**Component migration now covers `app/components/`, `app/pages/` and the
composables/shared utilities their strings came from.** A handful of pure
functions with no guaranteed i18n context (`useGeolocation`'s error state,
`useSiteQuery`'s `formatPeriod`, `useLimes`'s `formatFrontierYears` and
`formatOffset`, `checkPasswordRules`) were changed to return a code or accept
a `t` function from the calling component rather than a hardcoded English
string — the pattern to follow for the next one like it. What vici's own
source calls a site or tracing by (`sites.category`, six languages' worth of
`psummaries`/`ptexts`) is unaffected; only this app's own interface chrome is
translated.

## The field notebook — the reader's own traces

The project is called _traces_, and until now the one set of traces it did not
record was the visitor's own. `site_visits` and `site_bookmarks` fix that: **I
have stood here**, and **places to go**. It is the one feature here with no
analogue in vici.org, and it follows from what this atlas already claims to be —
a record made by the people who visit the places in it.

Everything else in this database is the shared record. These two tables are not,
and three rules follow from that. They are stated in
`server/database/schema/notebook.ts` and in migration `0006`, and each has an
e2e test in `e2e/notebook.spec.ts` because each would be trivially broken from
somewhere none of them live:

1. **A visit never goes through `applyRevision()`.** That function is still the
   only writer of the shared record; the handlers under `server/api/me/` are the
   only writes in the app that touch a table directly, because a private note
   about somebody's travel is not a change other people review. Sending it
   through moderation would put a moderator in front of it.
2. **The notebook never joins `/api/data/sites.geojson`** or any public feed.
   The `antiquity_*` tables are excluded from that feed for a licence reason;
   these are excluded for a data-protection one.
3. **The notebook never enters the MVT pipeline.** Tile invalidation is one
   global counter (`bumpDataVersion()`) — the reason tiles cache far longer than
   editable content normally allows. A per-user layer inside `ST_AsMVT` would
   make every cache key per-user and throw that away, for a few hundred points
   that fit in one response. The map draws them from a plain `geojson` source
   fed by `/api/me/map.geojson`, as a ring _around_ the category mark rather than
   a second glyph on the same coordinate.

Four more things worth knowing:

- **Erasure deletes the notebook outright, and that is a different decision from
  the rest of `account.delete.ts`.** That endpoint _anonymises_ rather than
  deletes, so the `ON DELETE CASCADE` on these tables never fires — a private
  record of where somebody has physically been would otherwise outlive the
  account that erased itself. The Art. 17(3)(d) archival reasoning that keeps
  contribution content does not reach it: nobody else can read a visit, and
  removing it takes nothing from the atlas. The deletes and the anonymisation
  are one transaction.
- **`visited_on` is nullable and `visited` is a column, not an inference.** "I
  have been, I do not recall when" is a real answer; a required date would be
  filled in with an invented one, and `visitedOn !== null` is therefore not the
  same question as "has this person stood here".
- **One row per person per site.** Revisiting updates rather than appends. This
  records _whether_ someone has been somewhere, not an itinerary — a log of
  repeat trips is a movement history worth more to an attacker than to its owner.
- **The GPX field kit is the offline story.** Offline tiles are still unbuilt and
  are a large piece of work; `/api/me/field-kit.gpx` is small, works on a
  handheld GPS or OsmAnd with no signal, and is most of that need.
  `server/utils/gpx.ts` is hand-written — the escaping is the only hard part and
  is the part that is tested, because an unescaped `&` in an imported title makes
  the file unparseable and a GPS reports that as "no waypoints" rather than as an
  error.

### Milestones, and why there is no game

`shared/utils/milestones.ts` derives eight named marks on read and **stores
none of them** — the same reasoning that deleted `users.trust_level` in
migration `0002`. Every mark is either _the first time_ something happened or _a
round number of_ something, so there is nothing to optimise. There are
deliberately no points, streaks, levels or leaderboards: a streak rewards
whoever lives nearest a frontier, and a leaderboard turns a shared record into a
contest that pays for thin records submitted quickly. The one mark worth having
is `recorded-and-stood` — visiting a place you yourself recorded — which is the
thesis of the project in a single fact and the only one that cannot be earned
from a desk.

### The public contributor page is opt-in and a strict projection

`users.public_profile` is off by default, and `/api/contributors/[name]` returns
display name, bio, joining **month** and published work. Never email, never role
(which would make the moderator list enumerable), never trust state (a
moderation judgement is not a public fact), and never visits or bookmarks —
that switch is about _attribution for contributions_, not general visibility.
A profile that is off answers **404, not 403**, so the route cannot be used to
enumerate display names. The month rather than the day because an exact
registration timestamp is a fingerprint. `contributor-projection.test.ts`
asserts the absences against the source.

### The account menu

`AuthAccountMenu` replaced a bare button in `default.vue` that showed the
display name and **signed you out on click** — no dropdown, no confirmation, and
no route to anything else about the account. The moderation queue stays a
header link rather than moving into the menu: moderators open it constantly.
The menu is `ClientOnly` for a different reason than `LanguageSwitcher` and
`ThemeToggle` — the session _is_ available during SSR, and a display name baked
into the HTML of `/` would be a cross-user leak the moment anyone enables edge
caching for pages, which nothing in `routeRules` currently forbids.

### Credentials

`auth/change-password.post.ts` and `auth/change-email.post.ts` both require the
**current password**: a session is proof of a past sign-in, not of present
possession, so without it a borrowed laptop is enough to take an account — worse
than the reset flow, where an attacker at least needs the inbox. Both notify,
and both ignore `notify_by_email`, because an attacker holding a session could
otherwise switch the preference off and act in silence. That switch covers
messages about your _contributions_; never messages about your _credentials_.

A change of address writes **nothing** to `users` up front. The new address is
parked on a `change-email` token (`email_tokens.new_email`) and only moves when
someone proves they can read that inbox. Writing it immediately and clearing
`email_verified_at` would leave a typo — or an address typed into a borrowed
session — locking the real owner out of an account they can still see and can no
longer recover, since `forgot-password` would now mail the wrong inbox. Two
messages go out: the link to the new address, and a warning to the **old** one,
which is the only signal reaching the genuine owner. It does not name the new
address; if the request was not theirs, that is a stranger's inbox.

`verify.post.ts` redeems both `verify-email` and `change-email`, because from the
recipient's side they ask the same thing. The purpose comes from the stored row,
never the request.

## Not built

- Purging withdrawn images from object storage (withdrawal is reversible by design — nothing deletes bytes).
- Notifications beyond mail. A review decision and a trust change reach the
  person by email (`server/utils/notifications.ts`), and `users.notify_by_email`
  now turns both off from `/settings`; a role change and a revert still send
  nothing, and there is nothing in the interface itself. Security notices —
  password changed, address change requested — deliberately ignore that
  preference, for the reason given under "Credentials" above.
- Full-text search across descriptions (titles and summaries only).
- RDF / Pelagios linked data. The GeoJSON feed at `/api/data/sites.geojson` exists.
- Offline tile caching. The app is installable as a PWA but needs signal.
- Full i18n component coverage — see "i18n" above for what is and is not migrated. Note the vici source has `nl`, `de` and `fr` text for thousands of sites — the import takes `en` and discards the rest; none of that is surfaced by the interface language yet, only the borrowed Wikipedia enrichment is.
- Off-box backups. `docker/backup.sh` writes nightly to a volume on the same VPS, and `pnpm db:snapshot` writes beside the database it copies. Neither survives losing the machine.

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
- **Accessibility every time** — ARIA and the rest, improved where possible. Also take keyboard i18n into account.
- **Semantic HTML** — the most fitting tag, always.
- **Short answers in chat**, without dropping anything important.
- **ORM over string queries.**
- **Install type packages** whenever they exist, and use those types.
- **Open source** look for established open source projects to solve some problem first instead of
  writing the logic yourself directly. Then ask for decision
- **Agents** may be used, but ask for permission before
- **Planning mode** while in planning mode, instead of writing the plan to a temporary file or chat, save it under current workdir's ".plans/" automatically and open it.
- **Completed tasks** when having completed a task, never print the achieved goals to the chat, keep it clean
- **EU/GDPR compliance** all packages or code dealing with user data or which are user-related must be GDPR compliant
- **e2e-tests** add e2e-tests when new critical features were added
- **i18n** always use i18n for defined languages (de, en, fr, es, it, nl)
