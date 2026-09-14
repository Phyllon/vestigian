import { index, integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'

/**
 * What each import script wrote, and from what.
 *
 * Bookkeeping rather than atlas data — nothing the application reads. It exists
 * so `scripts/import/guard.ts` can compare a fetch against the last one and
 * refuse an implausible delta, which is the only way a third-party source that
 * silently changed shape gets noticed before it is already in the map.
 *
 * Append-only, like `revisions`, and for the same reason: the value is in the
 * series. One row per successful run means "cities has been 235k ± a few
 * hundred for nine months and today it is 12k" is a question somebody can
 * actually ask.
 */
export const importRuns = pgTable(
  'import_runs',
  {
    id: serial('id').primaryKey(),
    /** Stable upstream identifier, e.g. `geonames:cities500` — not the script name, which may be renamed. */
    source: varchar('source', { length: 80 }).notNull(),
    rowCount: integer('row_count').notNull(),
    /** SHA-256 of the source bytes as served, before parsing. Hex. */
    checksum: varchar('checksum', { length: 64 }).notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Every read is "the newest run for this source", so the ordering column
    // belongs in the index rather than being sorted after the fact.
    index('import_runs_source_idx').on(table.source, table.ranAt),
  ],
)
