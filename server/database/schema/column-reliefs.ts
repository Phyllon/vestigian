import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * Mirrored reference plates documenting the reliefs of a Roman column —
 * Cichorius's 1896–1900 scene-by-scene photographic plates of Trajan's
 * Column to start, all from Wikimedia Commons' "Cichorius Plates" category
 * (`PD-old-80-expired` / `CC-PD-Mark` — verified per-file, not assumed
 * uniform). This is imported reference material, not a contributed record:
 * no `siteId`, no `status`/moderation column, and `applyRevision()`'s
 * governance model does not apply here, the same reasoning already covers
 * `antiquity_*` (ODbL/CC BY) and `tabula_peutingeriana_*` (unconfirmed
 * licence) — each licensing regime gets its own table, never a join into
 * `sites`/`site_images`. `site_images.site_id` is `NOT NULL` besides; there
 * is no existing precedent for a site-less image row, and relaxing that
 * constraint to fit this case would be the wrong fix.
 *
 * `monument` is a free column rather than an enum: this table may one day
 * also hold a second monument's mirrored plates (the Column of Marcus
 * Aurelius is served instead via a live IIIF viewer, not mirrored — see
 * CLAUDE.md's "Column reliefs" section for why the two use different
 * mechanisms) without a second near-identical table, but nothing here
 * speculatively builds for that; it costs one varchar today.
 */
export const columnReliefPlates = pgTable(
  'column_relief_plates',
  {
    id: serial('id').primaryKey(),
    monument: varchar('monument', { length: 40 }).notNull(),
    /** Cichorius's own Tafel/scene numbering, parsed from the Commons file
     *  title where present. Null for the cropped detail shots that don't
     *  carry a single clean scene number — left null rather than guessed. */
    sceneNumber: integer('scene_number'),
    title: text('title').notNull(),
    /** Commons' own `extmetadata.ImageDescription` for the file — real,
     *  short scene captions ("Cavalry battle against Sarmatians (scene
     *  XXXVII)"), licensed identically to the image itself since it lives on
     *  the same file page. Stripped of the HTML Commons wraps it in on the
     *  way in (`stripHtml`), the same policy this project already applies to
     *  every other piece of free text. Null where Commons has none. */
    description: text('description'),
    /** Object key in storage. Derivatives are produced on the fly by imgproxy. */
    storageKey: varchar('storage_key', { length: 300 }).notNull(),
    licence: varchar('licence', { length: 60 }).notNull(),
    attribution: text('attribution'),
    /** The Commons file-page URL. Also the import's own conflict target, so
     *  re-running the mirror refreshes a row's metadata (licence, title)
     *  rather than duplicating it. */
    sourceUrl: text('source_url').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('column_relief_plates_monument_idx').on(table.monument, table.sceneNumber),
    uniqueIndex('column_relief_plates_source_url_idx').on(table.sourceUrl),
  ],
)
