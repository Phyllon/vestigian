import { index, pgTable, serial, varchar } from 'drizzle-orm/pg-core'
import { pointGeometry } from './sites'

/**
 * Third-party findspot data used to discover and verify cross-references to
 * external heritage sources — never joined to `sites`, for the same reason
 * `antiquity_*` is kept separate (see `atlas.ts`): CC BY-SA 4.0's share-alike
 * attaches to a derivative *database*, so mixing this in would pull the
 * public GeoJSON feed under it.
 *
 * Epigraphic Database Heidelberg, `geography/edhGeographicData.json`
 * (`scripts/import/08-edh-findspots.ts`) — 29,861 findspots, each already
 * carrying a direct Pleiades and/or Trismegistos URI. That is what makes
 * this usable without a live search API (EDH has none — see the import
 * script's own comment): a site with a matching `external_ids` row for
 * either scheme joins to an EDH findspot by identifier, not by fuzzy name
 * or coordinate matching, and the resulting distance is still checked
 * before anything is recorded as verified (`shared` verification logic
 * makes no exception for an identifier match — see CLAUDE.md's own account
 * of the Wikidata sampling this rule already exists for).
 */
export const edhFindspots = pgTable(
  'edh_findspots',
  {
    id: serial('id').primaryKey(),
    /** e.g. 'https://edh-www.adw.uni-heidelberg.de/edh/geographie/0'. */
    edhUri: varchar('edh_uri', { length: 200 }).notNull(),
    ancientFindspot: varchar('ancient_findspot', { length: 200 }),
    /** Bare numeric id, extracted from the source's `pleiades_uri`. */
    pleiadesId: varchar('pleiades_id', { length: 32 }),
    /** Bare numeric id, extracted from the source's `trismegistos_geo_uri`. */
    trismegistosId: varchar('trismegistos_id', { length: 32 }),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [
    index('edh_findspots_geom_idx').using('gist', table.geom),
    index('edh_findspots_pleiades_idx').on(table.pleiadesId),
    index('edh_findspots_trismegistos_idx').on(table.trismegistosId),
  ],
)
