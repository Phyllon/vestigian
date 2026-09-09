# Scripts

Every script this project wrote itself, what it does, and how to run it.
Detail on _why_ a given design choice was made lives in the script's own
docstring — this file is the index, not a duplicate of it. Grouped as the
`scripts/` tree itself is grouped.

## Setup

| Script             | Run with     | What it does                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/setup.sh` | `pnpm setup` | Checks Node/pnpm/Docker/openssl, generates `.env` from `.env.example` with a real `NUXT_SESSION_PASSWORD`/`NUXT_ALTCHA_SECRET`, installs dependencies, brings up the dev stack, waits for Postgres, applies migrations. Stops there deliberately — see "Importing the vici.org data" in the root README. Safe to re-run; an existing `.env` is left untouched. |

## Import pipeline (`scripts/import/`)

Run in numeric order on first setup; each is independently re-runnable
afterward to refresh just that layer. Full detail, licensing rationale and
row counts: `.claude/rules/import-pipeline.md` and
`.claude/rules/antiquity-basemaps.md`.

| #   | Script                       | Run with                           | Source → what it fills                                                                                                                            |
| --- | ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | `01-fetch-dump.ts`           | `pnpm import:fetch`                | vici.org SQL dumps → scratch MariaDB (own machine only, ~3 GB)                                                                                    |
| 02  | `02-mysql-to-postgres.ts`    | `pnpm import:convert`              | MariaDB → `sites`, `tracings`, `external_ids` (61,272 sites, 11,720 tracings)                                                                     |
| 02b | `02b-image-records.ts`       | `pnpm import:image-records`        | vici image metadata → `site_images` rows (no bytes yet)                                                                                           |
| 02c | `02c-geo-names.ts`           | `pnpm import:geo-names`            | vici's `geo.sql.gz` (GeoNames-derived) → `geo_names` (447,053 rows, 5-country coverage)                                                           |
| 03  | `03-mirror-images.ts`        | `pnpm import:images`               | vici.org originals → object storage, one at a time, ~a day. **Tell René Voorburg before running at scale.**                                       |
| 04  | `04-mirror-basemap-tiles.ts` | `pnpm import:basemap`              | DARE + EOX Sentinel-2 raster tiles → object storage                                                                                               |
| 05  | `05-antiquity-atlas.ts`      | `pnpm import:atlas`                | AWMC (ODbL) + Pleiades (CC BY 3.0) → `antiquity_*` reference cartography                                                                          |
| 06  | `06-limes.ts`                | `pnpm import:limes`                | AWMC empire-extent polygons (ODbL) → the limes frontier line (5,123 km / 11 runs, Europe+Med)                                                     |
| 07  | `07-country-boundaries.ts`   | `pnpm import:country-boundaries`   | Natural Earth 1:50m admin-0 (public domain) → `country_boundaries`, for reverse-geocoding                                                         |
| 08  | `08-edh-findspots.ts`        | `pnpm import:edh-findspots`        | Epigraphic Database Heidelberg (CC BY-SA 4.0) → findspots for concordance verification                                                            |
| 09  | `09-cities.ts`               | `pnpm import:cities`               | GeoNames `cities500` (CC BY 4.0) → `cities`, worldwide, for map search                                                                            |
| 10  | `10-tabula-peutingeriana.ts` | `pnpm import:tabula-peutingeriana` | OmnesViae (René Voorburg) → Tabula Peutingeriana places and roads                                                                                 |
| 11  | `11-column-reliefs.ts`       | `pnpm import:column-reliefs`       | Wikimedia Commons (public domain) → Trajan's Column Cichorius plates (138 files)                                                                  |
| 13  | `13-battles.ts`              | `pnpm import:battles`              | Wikidata SPARQL (CC0) → ancient battle sites, worldwide                                                                                           |
| 14  | `14-ancient-ports.ts`        | `pnpm import:ports`                | Catalogue of Ancient Ports, de Graauw (CC BY 4.0) → `antiquity_ports` (~5,990 of 6,007 rows have coordinates)                                     |
| 15  | `15-orbis-routes.ts`         | `pnpm import:orbis-routes`         | ORBIS v2, Stanford (CC BY 3.0) → `antiquity_routes`, 1,215 edges, 6 route kinds                                                                   |
| 16  | `16-awmc-minor-features.ts`  | `pnpm import:awmc-features`        | AWMC Cultural Shapefiles (ODbL) → bridges, mines/quarries, dams, cemeteries, Barrington forts, tumuli                                             |
| 17  | `17-awmc-minor-lines.ts`     | `pnpm import:awmc-centuriation`    | Same AWMC release, line/polygon layers → centuriation grids, causeways, dikes (drawn into `antiquity_lines`/`antiquity_areas`, not a new overlay) |
| 18  | `18-chrr-coin-hoards.ts`     | `pnpm import:chrr-coin-hoards`     | Coin Hoards of the Roman Republic (CC BY-NC 3.0) → 620 findspot locations                                                                         |
| 19  | `19-ohm-empire-extents.ts`   | `pnpm import:empire-extents`       | OpenHistoricalMap Overpass (CC0) → dated Roman-state extent series, the Barrington period scrubber                                                |
| —   | `vici-licences.ts`           | not run directly                   | Shared licence-string vocabulary imported by `02-mysql-to-postgres.ts` and `03-mirror-images.ts` — not itself a pipeline stage                    |

## i18n (`scripts/i18n/`)

| Script                 | Run with                                                                                                           | What it does                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `translate-locales.ts` | `pnpm i18n:translate` (also runs automatically from the `pre-commit` hook whenever `i18n/locales/en.json` changes) | Bootstraps `de`/`fr`/`es`/`it`/`nl` from `en.json` via self-hosted LibreTranslate. ICU placeholders (`{name}`) are split out and never sent to the translator — an earlier token-substitution approach silently lost them instead. `FROZEN_KEYS`/`FROZEN_KEY_PREFIXES` list keys copied verbatim (proper nouns, monument names, licence strings) rather than translated. |

## One-off data-hygiene scripts (`scripts/`, no `pnpm run` — invoke with `tsx` directly)

These fix or verify data after the fact rather than running on a schedule.

| Script                      | Run with                                                                               | What it does                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backfill-country-codes.ts` | `pnpm exec tsx --env-file-if-exists=.env scripts/backfill-country-codes.ts [--repair]` | Fills `sites.country_code` by point-in-polygon against `country_boundaries` (needs `import:country-boundaries` first). Two earlier, wrong approaches (nearest-point against `geo_names`, then the same with a distance guard) are documented in its own header as a warning against reintroducing them. |
| `verify-concordances.ts`    | `pnpm exec tsx --env-file-if-exists=.env scripts/verify-concordances.ts [--repair]`    | Discovers and verifies cross-references to EDH, iDAI.gazetteer and Historic England, writing `external_ids` + `external_id_verifications`. Overnight-scale; runs automatically for new/edited sites too (see `.claude/rules/import-pipeline.md`).                                                       |
| `strip-description-html.ts` | `pnpm strip-description-html [--repair]`                                               | Strips markup left over from before `stripHtml` covered `summary`/`caption`/`attribution` (it originally covered only `description`). A direct `UPDATE`, not a revision — data hygiene, not an editorial change.                                                                                        |

## Operational scripts (`scripts/`)

| Script                  | Run with                                            | What it does                                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot-database.ts`  | `pnpm db:snapshot`                                  | Writes a compressed `pg_dump` of the live database (excludes `antiquity_*` reference tables — those are cheaply refilled by the import scripts, not backed up).                                     |
| `reconcile-images.ts`   | `pnpm images:reconcile [--repair]`                  | Compares the database against object storage; reports `missing`/`unstored`/`orphan`, and with `--repair` requeues `missing` rows to `pending`. Never deletes objects.                               |
| `warm-tiles.ts`         | `pnpm tiles:warm [baseUrl]`                         | Pre-renders the low-zoom clustered tiles after a deploy or data-version bump, so the first real traffic doesn't pay for cold cache generation.                                                      |
| `flush-rate-limits.ts`  | `pnpm flush-rate-limits`                            | Clears every `rl:*` key in Valkey. Exists for the e2e test-IP pool, which otherwise re-spends the same rate-limit budget across repeated local runs. **Dev/test only** — never point at production. |
| `create-dev-bundle.ts`  | `pnpm dev:bundle`                                   | Packages the local database (including `antiquity_*`, unlike `db:snapshot`) and every mirrored image into two files, so a new developer skips re-running the whole import pipeline.                 |
| `restore-dev-bundle.ts` | `pnpm dev:bundle:restore -- <dump> <images.tar.gz>` | Restores a bundle written by `create-dev-bundle.ts` into a clean, already-running stack.                                                                                                            |

## Asset-generation scripts (`scripts/`)

Run by hand, output committed to the repo — not part of any build step.

| Script                        | Run with                       | What it does                                                                                                                           |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `build-glyphs.ts`             | `pnpm glyphs:build <font.ttf>` | Renders SDF label glyphs for MapLibre from a TTF (currently Noto Sans, OFL 1.1) into `public/fonts/`. Only when the fontstack changes. |
| `generate-og-placeholders.ts` | `pnpm og:build`                | Renders one static Open Graph card per site category (plus tracings and a default) via sharp, for entities with no photograph.         |
| `generate-app-icons.ts`       | `pnpm icons:build`             | Rasterizes `public/favicon.svg` into the PWA icon files `manifest.webmanifest` references.                                             |

## Git hooks (`scripts/`, invoked by Husky — see `.husky/`)

| Script                 | Invoked by          | What it does                                                                                                                                                                  |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-commit-msg.ts` | `.husky/commit-msg` | Rejects an empty or under-10-character commit subject. A structural floor, not a Conventional Commits gate — this repo's own log stays lowercase, imperative, no type prefix. |

## Types-only support file

| File           | Used by                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `fontnik.d.ts` | `build-glyphs.ts` — fontnik ships no types; only the one function actually called (`range`) is declared. |

## See also

- `documents/architecture-overview.md` — system shape and data flow.
- `documents/runbook_prod.deployment.md` — production deployment steps.
- `.claude/rules/import-pipeline.md` — full import-pipeline rationale, schema detail, concordance verification.
- `.claude/rules/antiquity-basemaps.md` — every borrowed antiquity dataset, its licence verification, and what was deliberately not imported.
- `.claude/rules/enrichment-and-i18n.md` — the i18n pipeline's frozen-key list and the five-locale translation audit history.
