import { index, integer, pgTable, real, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { pointGeometry } from './sites'

/**
 * What the atlas's other records say about each conjectured or hypothetical
 * Itiner-e segment — written by `pnpm roads:audit`, read by the road-audit
 * overlay and its download. See `.claude/rules/road-audit.md`.
 *
 * Evidence, not a verdict: a row counts what lies within
 * `ROAD_AUDIT_BUFFER_METRES` of the segment and measures its steepest stretch.
 * What a count of zero means is the reader's to judge — Itiner-e's own
 * `certainty` stays the source's statement, and nothing here replaces it.
 *
 * **No foreign key to `antiquity_roman_roads`**, deliberately: the Itiner-e
 * import `TRUNCATE`s that table with `RESTART IDENTITY`, so its ids are
 * reassigned on every re-import and a row here would then describe a different
 * road. The import clears this table in the same statement instead, and the
 * audit is built again afterwards.
 *
 * Licence: derived from Itiner-e (CC BY 4.0), EDH (CC BY-SA 4.0), vici.org
 * (CC BY-SA 3.0) and terrain models. Kept in its own tables and in no
 * `/api/data` feed, like every other table beside the atlas's.
 */
export const roadAuditSegments = pgTable('road_audit_segments', {
  /** `antiquity_roman_roads.id` at the time of the build — see the note above. */
  roadId: integer('road_id').primaryKey(),
  lengthMetres: integer('length_metres').notNull(),
  /** Located EDH milestones within the buffer. */
  edhMilestones: integer('edh_milestones').notNull(),
  /** vici.org's approved milestone records within the buffer. */
  viciMilestones: integer('vici_milestones').notNull(),
  /** vici.org's approved road records within the buffer. */
  viciRoadSites: integer('vici_road_sites').notNull(),
  /** How many of the segment's two ends meet a `certain` segment (0–2). */
  certainEnds: integer('certain_ends').notNull(),
  /**
   * The steepest stretch of at least `ROAD_AUDIT_GRADIENT_WINDOW_METRES`, as an
   * absolute percentage. Null where the segment is shorter than the window or
   * the terrain under it could not be read.
   */
  steepestGradientPercent: real('steepest_gradient_percent'),
  /** Share of the samples that had terrain under them. */
  terrainCoverage: real('terrain_coverage'),
  modelVersion: integer('model_version').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Located milestones with no Itiner-e road within `ROAD_GAP_DISTANCE_METRES`:
 * where a road stood that the model does not have, or where a stone was
 * carried — findspots are often re-use sites, not the road itself.
 */
export const roadAuditGaps = pgTable(
  'road_audit_gaps',
  {
    id: serial('id').primaryKey(),
    /** `'edh'` (an EDH inscription) or `'vici'` (a vici.org record). */
    source: varchar('source', { length: 8 }).notNull(),
    /** EDH id (`HD012345`) or vici slug — what the popup links with. */
    sourceKey: varchar('source_key', { length: 160 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    /** Metres to the nearest segment, or null when none lies within the search box. */
    nearestRoadMetres: integer('nearest_road_metres'),
    modelVersion: integer('model_version').notNull(),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [index('road_audit_gaps_geom_idx').using('gist', table.geom)],
)
