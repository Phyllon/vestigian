---
paths:
  - 'scripts/import/**'
  - 'scripts/backfill-country-codes.ts'
  - 'scripts/verify-concordances.ts'
  - 'server/api/places/**'
  - 'server/api/atlas/**'
---

## Known guesses that need verifying

- ~~The vici.org MySQL schema is inferred, not observed.~~ **Now verified against
  the October 2023 dump, and the guess was wrong in every particular.** There is
  no `places` table and no `lines` table; `02-mysql-to-postgres.ts` has been
  rewritten against the real shape. See "The vici.org schema, as observed" below.
- Migrations are **hand-written** (`0000_initial.sql`, `0001_revision_history.sql`) because drizzle-kit cannot emit PostGIS geometry columns, GiST indexes, or the expression indexes behind search. **Read any generated migration before applying it** — regenerating from the schema files would silently drop all three. See `server/database/migrations/README.md`.
- Vector-tile source layer names (`transportation`, `place`, `water`, `landuse`, `boundary`, `building`) follow the OpenMapTiles schema. Verify against the actual PMTiles/OpenFreeMap tiles.
- ~~`sites.country_code` is null on all 61,272 imported rows.~~ **Backfilled,
  and every new contribution now sets it on write** — see "Import pipeline"
  above for the full account, including the two wrong versions this went
  through before point-in-polygon against real country boundaries replaced a
  nearest-point match against the wrong dataset. The notebook's "Countries"
  count and the `five-countries` milestone now work.

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

pnpm import:fetch               # dumps → scratch MariaDB (reuses db_dumb/ if present)
pnpm import:convert             # → 61,272 sites, 11,720 tracings, 8,692 concordances
pnpm import:image-records       # → 39,212 site_images rows over 36,216 objects; no bytes
pnpm import:images              # → the photographs; ~12 hours, ~10 GB, resumable
pnpm import:geo-names           # → 447,053 rows, geo.sql.gz already in the scratch MariaDB
pnpm import:basemap dare        # → the DARE sheet; ~10 hours, ~1.2 GB, resumable
pnpm import:basemap satellite   # → Sentinel-2 cloudless; ~1.9M tiles, ~19 GB, resumable
pnpm import:atlas               # → the Barrington sheet: AWMC + Pleiades into PostGIS
pnpm import:limes               # → the frontier, derived from the atlas; ~1 minute
pnpm import:country-boundaries  # → 239 countries, Natural Earth, public domain
pnpm exec tsx scripts/backfill-country-codes.ts --repair   # needs country-boundaries first
pnpm import:edh-findspots       # → 29,861 inscription findspots, CC BY-SA 4.0
pnpm import:edh-inscriptions    # → 79,201 inscriptions (of 79,206), CC BY-SA 4.0, ~2 min
pnpm import:edh-inscription-images # → 24,779 photo records, metadata only, ~20s (no image bytes — every one is rights-reserved)
pnpm exec tsx scripts/verify-concordances.ts --repair       # overnight-scale, see its own docstring
pnpm import:cities              # → 235,666 modern cities and towns, CC BY 4.0
pnpm import:tabula-peutingeriana # → 2,574 places, 2,397 roads; licence unconfirmed, off by default
pnpm import:column-reliefs      # → Trajan's Column plates from Wikimedia Commons, public domain
pnpm import:empire-extents      # → 52 dated extent slices, OpenHistoricalMap, CC0
pnpm tiles:warm <url>
```

The map is fully usable after `import:convert`; everything after is photographs, geographic
enrichment and cross-referencing.

**`geo_names` was documented as "already holding what a reverse-geocode backfill would
need" before this was checked — it did not.** `01-fetch-dump.ts` fetches `geo.sql.gz`
into the scratch MariaDB alongside `vici.sql.gz`, but nothing ever transferred it into
Postgres; the table existed, indexed, empty. `pnpm import:geo-names`
(`scripts/import/02c-geo-names.ts`) is the missing step, and it turned out not to be
what `sites.country_code` actually needed anyway — see the next paragraph.

**`sites.country_code` has a real backfill now, and it went through two wrong versions
first.** A nearest-_point_ match against `geo_names` — sparse, and scoped to wherever
vici.org's own `geo.sql` dump happens to cover (five countries: DE, FR, IT, NL, BE) —
confidently mislabelled any site genuinely outside that area with whichever of the five
happened to be closest; caught by testing a real out-of-range coordinate (Madrid, which
came back `FR`) and found to affect 32,032 of 61,273 sites once audited. A 75 km distance
guard on the same lookup fixed the wrong-country problem but not the underlying one: a
nearest-point match can only ever answer for five countries, clearing the other 43,479
sites to null instead of answering them. `pnpm import:country-boundaries`
(`scripts/import/07-country-boundaries.ts`, Natural Earth 1:50m admin-0, public domain)
plus point-in-polygon (`scripts/backfill-country-codes.ts`, now `ST_Contains` against
real boundaries, with a 60 km coastal-tolerance fallback for genuinely coastal sites that
land just outside a simplified 1:50m coastline) is what actually answers this, for any
country, with no distance threshold to guess. `server/utils/revisions.ts`'s `insertSite`/
`updateSite` run the identical lookup on every write, so this only had to be backfilled
once — every new contribution gets a correct `country_code` from the moment it publishes.
Only 9 sites resolve to nothing at all: 4 in Northern Cyprus (a disputed territory with no
clean ISO code, even in Natural Earth's own data), 1 open-water shipwreck findspot, and 4
with corrupted source coordinates (two at exactly `0,0`, one at 76°N, one at longitude `0`
for what should be Orkney) — the system correctly declining to guess, not a bug.

**Cross-referencing beyond what vici.org's own import captured.** vici.org recognises 14
concordance schemes (`02-mysql-to-postgres.ts`'s `KNOWN_SCHEMES`), but only 4 ever got an
outbound URL (`server/utils/site-record.ts`'s `EXTERNAL_URL_PATTERNS`) — the rest rendered
as plain text. Extended to 10 confirmed-live schemes; `livius`, `mithraeum`, `romaq` and
`archis` are deliberately left unlinked (see that file's own comment for why each one,
checked rather than guessed, doesn't have a safe pattern). Three more schemes —
`edh`, `idai-gazetteer`, `historic-england` — do not come from vici.org's import at all:
`scripts/verify-concordances.ts` discovers and verifies them itself, against sources
researched and found to actually support this (two live APIs confirmed working; a third,
EDH, has no live search API at all and is a bulk import instead —
`scripts/import/08-edh-findspots.ts`; a fourth, the Portable Antiquities Scheme, is
blocked by a Cloudflare bot challenge on every request and was not pursued). Every
candidate, from any of these three, still has to pass the same distance-and-category gate
`server/utils/enrichment.ts`'s `verifyEnrichmentMatch` already applies to Wikidata — this
is the same rule extended to more sources, not a separate, looser one. Persisted in
`external_id_verifications` (one row per identifier×source, so the same Wikidata id can be
independently verified against Wikidata and against iDAI.gazetteer), shown in
`SiteExternalLinks.vue` as a verdigris mark — this project's own "approved/confirmed"
token — with the distance in a title, never a negative marker on an identifier nothing has
checked yet.

**New and edited sites are cross-referenced automatically — `scripts/verify-concordances.ts`
is the bulk backfill, not the only path.** `server/utils/concordances.ts`'s
`verifySiteConcordances(siteId)` runs the identical three checks for one site and is called
from `applyRevision()` — the one place a live row is ever written — so a contribution gets
checked against EDH, iDAI.gazetteer and Historic England the moment it publishes, whether
that's automatic (trust-based) approval, a moderator's approval, or an edit to an existing
site's position or title. It is fire-and-forget: `applyRevision()` calls it with `void`,
never `await`, because iDAI.gazetteer and Historic England are each one external request
with an 8s timeout, and nothing about a contribution's own approval should wait on them —
the same fail-open reasoning already applied to rate limiting and mail delivery. Failures
are caught and logged, never thrown into the caller. `concordances.ts` cannot be imported by
the standalone script — it uses `useSql()`/`useLogger()`, Nitro auto-imports with nothing
behind them in a bare `tsx` process — so the two files duplicate `recordConcordanceMatch`'s
shape rather than share it; the script remains the only way to backfill the 61k+ sites that
existed before this hook did, and the only reasonable way to re-run iDAI.gazetteer or
Historic England against the whole catalog after a threshold or source change, since one
site importing the app's own module graph on every write is not a batch tool.

New contributions carry no external identifiers at all today — there is no field for them
in `SiteEditorForm`, and `SitePayload` has none — so EDH (which joins by an existing
Pleiades/Trismegistos id) will only ever find something for an _edited_, previously-imported
site, never a brand-new one. iDAI.gazetteer (searched by title) and Historic England
(searched by position, GB-scoped) are the two that actually do useful work for a genuinely
new contribution.

**Modern-city search: a self-hosted table, not a live geocoding API.** The search bar
(`MapSearchField.vue`) needed to find modern cities and towns, not only Vestigian's own
records, so a reader typing "Trier" can navigate there even before anyone has contributed a
site nearby. There is no live geocoding API that is both EU-based and open-source the way
this project has consistently chosen elsewhere (self-hosted fonts, self-hosted glyphs,
self-hosted translation): Nominatim's public instance carries a strict 1 req/s fair-use
policy that rules out autocomplete-style use, and Photon (komoot, Germany, Apache-2.0) needs
its own Elasticsearch index to self-host — real new infrastructure for a feature that
doesn't need fuzzy geocoding, just "does a city by this name exist and where." Measured
against a real import rather than estimated: GeoNames.org's `cities500` extract (CC BY 4.0,
every populated place ≥500 people, worldwide) is 235,666 rows and **49 MB in Postgres**
(26 MB table + 23 MB indexes — a GiST index on `geom`, a trigram GIN index on `name`), a
rounding error against the rest of the database. `cities` (`scripts/import/09-cities.ts`,
`server/database/schema/geo.ts`) is deliberately not `geo_names`: that table exists only to
answer "which country" for a site's own coordinate and is a sparse point set scoped to
wherever vici.org's own dump happens to cover (five countries); this is worldwide and keyed
for name search. `adm-zip` is the one new dependency this needed — GeoNames ships as a
`.zip`, the only zipped source in this pipeline, and Node has no built-in zip-container
reader (`DecompressionStream` handles gzip/deflate streams, not the zip format itself).

`/api/places/search` (`PlaceSummary`, not `SiteSummary` — no `slug`, because there is no
page for a modern town) mirrors `/api/sites/search`'s trigram-fallback shape, but ranks
differently: an exact prefix match always outranks a fuzzy trigram-only one, and within
either group the more populous place wins. Ranking by trigram similarity alone put the
villages "Londa"/"Londe" ahead of London for the query "Lond" — similarity rewards a short
candidate matching a short query, which has nothing to do with which "Lond…" a reader
actually wants. `useSiteSearch` (`app/composables/data/useSiteQuery.ts`) queries both
`/api/sites/search` and `/api/places/search` in parallel via `Promise.allSettled` and merges
them into one ranked list (`MapSearchResult`, sites first), so one source failing does not
blank the other's results. Selecting a place only moves the camera — `goToResult` calls
`selectSite` for a site, never for a place, since a modern town has no detail panel to open.

**Ancient names are searchable too, from data already imported.** The Barrington sheet
draws names from `antiquity_places` (AWMC/Pleiades, `05-antiquity-atlas.ts`) that this
atlas holds no separate opinion about — e.g. modern Gauting was ancient "Bratananium".
Nothing new to import: `/api/atlas/places/search.get.ts` is a third sibling of
`sites/search.get.ts` and `places/search.get.ts`, same trigram-fallback shape, over
`antiquity_places.title` — needing its own hand-written `gin_trgm_ops` index
(`0017_ancient_place_search.sql`), the same drizzle-kit limitation documented above for
`cities_name_trgm_idx`. `useSiteSearch` now queries all three endpoints in parallel;
`AncientPlaceSummary` (`shared/types/site.ts`) has no slug either, for the same reason
`PlaceSummary` doesn't — there is no page for a name with nothing but a findspot behind
it. `goToResult` zooms in closer for an ancient place (z14) than a modern town (z12): it
marks one small point on the Barrington sheet, not a settlement with real extent.

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
