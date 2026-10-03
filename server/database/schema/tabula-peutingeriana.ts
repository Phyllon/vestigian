import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  serial,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { pointGeometry } from './sites'

const lineGeometry = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(LineString, 4326)',
})

/**
 * The Tabula Peutingeriana's own places and roads, reconstructed to real
 * coordinates — not the manuscript image itself (that lives behind
 * `/tabula-peutingeriana`'s IIIF viewer, unrelated to this table).
 *
 * Sourced from `omnesviae.org/data/omnesviae.json`, René Voorburg's
 * compilation from Richard Talbert's scholarly georeferencing of the
 * manuscript, filled out from the Itinerarium Antonini where the map itself
 * is lost, cross-checked against Pleiades. Kept in its own tables and never
 * joined to `sites` or `antiquity_places`, for a stronger reason than the
 * ODbL/CC-BY isolation those tables already document: **this dataset states
 * no licence anywhere** — not in the JSON-LD, not on omnesviae.org, not on
 * its Codeberg repository. Its compiler, René Voorburg, confirmed reuse here,
 * and `NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED` (on by default) is how that
 * permission is withdrawn if he ever asks (see
 * `server/api/tabula-peutingeriana/network.geojson.get.ts`). See
 * `.claude/rules/tabula-peutingeriana.md`.
 */
export const tabulaPeutingerianaPlaces = pgTable(
  'tabula_peutingeriana_places',
  {
    id: serial('id').primaryKey(),
    /** omnesviae's own `#TPPlace…` / `#OVPlace…` fragment id, kept for `sourceId` joins on re-import. */
    sourceId: varchar('source_id', { length: 40 }).notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    modernName: varchar('modern_name', { length: 200 }),
    /** The manuscript's own drawing-symbol code (e.g. `Aa9`), where recorded. Not a category. */
    symbol: varchar('symbol', { length: 16 }),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [
    uniqueIndex('tp_places_source_idx').on(table.sourceId),
    index('tp_places_geom_idx').using('gist', table.geom),
  ],
)

export const tabulaPeutingerianaRoads = pgTable(
  'tabula_peutingeriana_roads',
  {
    id: serial('id').primaryKey(),
    sourceId: varchar('source_id', { length: 80 }).notNull(),
    fromPlaceId: integer('from_place_id')
      .notNull()
      .references(() => tabulaPeutingerianaPlaces.id, { onDelete: 'cascade' }),
    toPlaceId: integer('to_place_id')
      .notNull()
      .references(() => tabulaPeutingerianaPlaces.id, { onDelete: 'cascade' }),
    /** Roman miles, as recorded on the manuscript. Null for the ~7% of legs with no figure. */
    distanceRomanMiles: integer('distance_roman_miles'),
    /** Gap filled from the Itinerarium Antonini rather than read off the manuscript itself. */
    isReconstructed: boolean('is_reconstructed').notNull().default(false),
    overWater: boolean('over_water').notNull().default(false),
    crossesMountains: boolean('crosses_mountains').notNull().default(false),
    /** The river's own name as the manuscript gives it (e.g. "Fl. Padvs"), not a boolean. */
    crossesRiver: varchar('crosses_river', { length: 120 }),
    /**
     * A straight line between the two endpoints, not a traced course. The
     * source data is an endpoint pair and a distance, nothing else — drawing
     * anything more detailed would invent a road alignment the data does not
     * contain.
     */
    geom: lineGeometry('geom').notNull(),
  },
  (table) => [
    uniqueIndex('tp_roads_source_idx').on(table.sourceId),
    index('tp_roads_geom_idx').using('gist', table.geom),
    index('tp_roads_from_idx').on(table.fromPlaceId),
    index('tp_roads_to_idx').on(table.toPlaceId),
  ],
)
