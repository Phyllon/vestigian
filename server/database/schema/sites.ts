import { sql } from 'drizzle-orm'
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * PostGIS geometry columns. Drizzle has no native PostGIS type, so the column
 * is declared through customType and every read goes through ST_AsGeoJSON in
 * the query rather than being deserialised here.
 */
export const pointGeometry = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Point, 4326)',
})

export const anyGeometry = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Geometry, 4326)',
})

export const siteCategoryEnum = pgEnum('site_category', [
  'settlement',
  'fortification',
  'sanctuary',
  'burial',
  'infrastructure',
  'villa',
  'production',
  'findspot',
  'other',
])

export const reviewStatusEnum = pgEnum('review_status', ['pending', 'approved', 'rejected'])

export const geometryKindEnum = pgEnum('geometry_kind', ['point', 'line', 'area'])

export const sites = pgTable(
  'sites',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    category: siteCategoryEnum('category').notNull().default('other'),
    /**
     * The source's own word for what this is, where it had one — vici's
     * `pnt_kind`, so `watchtower` and `camp` survive a category that calls them
     * both `fortification`. Free text because the vocabulary belongs to the
     * source, not to this project: a kind added upstream must not be a
     * migration here. Null for anything not imported from vici.
     */
    subcategory: varchar('subcategory', { length: 40 }),
    summary: text('summary'),
    description: text('description'),
    geom: pointGeometry('geom').notNull(),
    periodFrom: integer('period_from'),
    periodTo: integer('period_to'),
    countryCode: varchar('country_code', { length: 2 }),
    modernPlace: varchar('modern_place', { length: 240 }),
    status: reviewStatusEnum('status').notNull().default('pending'),
    /** Provenance of the record, e.g. 'vici.org#4711' for imported rows. */
    sourceRef: varchar('source_ref', { length: 120 }),
    licence: varchar('licence', { length: 60 }).notNull().default('CC-BY-SA-3.0'),
    attribution: text('attribution'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The single most important index in the project: every tile request is a
    // bounding-box intersection against this.
    index('sites_geom_idx').using('gist', table.geom),
    index('sites_status_idx').on(table.status),
    index('sites_category_idx').on(table.category),
    // Partial: only vici-sourced rows carry a subcategory, and the frontier
    // queries ask for one specific kind at a time.
    index('sites_subcategory_idx')
      .on(table.subcategory)
      .where(sql`${table.subcategory} IS NOT NULL`),
    uniqueIndex('sites_slug_idx').on(table.slug),
    uniqueIndex('sites_source_ref_idx').on(table.sourceRef),
    index('sites_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.title} || ' ' || coalesce(${table.summary}, ''))`,
    ),
  ],
)

/** Line and area tracings: Roman roads, aqueducts, walls, limes sections. */
export const tracings = pgTable(
  'tracings',
  {
    id: serial('id').primaryKey(),
    title: varchar('title', { length: 240 }).notNull(),
    kind: geometryKindEnum('kind').notNull().default('line'),
    category: siteCategoryEnum('category').notNull().default('infrastructure'),
    geom: anyGeometry('geom').notNull(),
    description: text('description'),
    status: reviewStatusEnum('status').notNull().default('pending'),
    sourceRef: varchar('source_ref', { length: 120 }),
    licence: varchar('licence', { length: 60 }).notNull().default('CC-BY-SA-3.0'),
    attribution: text('attribution'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tracings_geom_idx').using('gist', table.geom),
    index('tracings_status_idx').on(table.status),
    uniqueIndex('tracings_source_ref_idx').on(table.sourceRef),
  ],
)

export const siteImages = pgTable(
  'site_images',
  {
    id: serial('id').primaryKey(),
    siteId: integer('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Object key in R2. Derivatives are produced on the fly by imgproxy. */
    storageKey: varchar('storage_key', { length: 300 }).notNull(),
    caption: text('caption'),
    licence: varchar('licence', { length: 60 }).notNull(),
    attribution: text('attribution'),
    sourceUrl: text('source_url'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Retained separately from EXIF so it survives the strip on upload. */
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    status: reviewStatusEnum('status').notNull().default('pending'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('site_images_site_idx').on(table.siteId),
    index('site_images_status_idx').on(table.status),
  ],
)

export const externalIds = pgTable(
  'external_ids',
  {
    id: serial('id').primaryKey(),
    siteId: integer('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** 'pleiades', 'wikidata', 'trismegistos', 'vici' … */
    scheme: varchar('scheme', { length: 40 }).notNull(),
    value: varchar('value', { length: 120 }).notNull(),
  },
  (table) => [
    uniqueIndex('external_ids_unique').on(table.siteId, table.scheme, table.value),
    index('external_ids_lookup').on(table.scheme, table.value),
  ],
)

export const verificationStatusEnum = pgEnum('verification_status', ['verified', 'rejected'])

/**
 * A companion table, not columns on `external_ids` — an identifier is
 * authored (parsed once, on import); a verification is computed, and
 * recomputable, against whichever external source was checked. One row per
 * (identifier, source) pair: a Wikidata id can be verified independently
 * against Wikidata's own coordinate and against iDAI.gazetteer's, and each
 * check keeps its own distance and timestamp rather than one overwriting
 * the other.
 */
export const externalIdVerifications = pgTable(
  'external_id_verifications',
  {
    id: serial('id').primaryKey(),
    externalIdId: integer('external_id_id')
      .notNull()
      .references(() => externalIds.id, { onDelete: 'cascade' }),
    status: verificationStatusEnum('status').notNull(),
    /** Null when the source consulted has no coordinate to compare against. */
    distanceMetres: integer('distance_metres'),
    /** Which source produced this row — 'wikidata', 'edh', 'idai-gazetteer' … */
    checkedVia: varchar('checked_via', { length: 40 }).notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('external_id_verifications_unique').on(table.externalIdId, table.checkedVia),
  ],
)

/**
 * Every change to a site, image or tracing is written here first. The public
 * map reads only approved records; the moderation queue reads pending ones.
 * Nothing is ever destroyed, so any edit can be reverted.
 */
export const revisions = pgTable(
  'revisions',
  {
    id: serial('id').primaryKey(),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: integer('entity_id'),
    /** Full proposed state, so a revision can be replayed without joins. */
    payload: jsonb('payload').notNull(),
    /** What this revision replaced. Null on the first revision of a record. */
    previousPayload: jsonb('previous_payload'),
    editSummary: text('edit_summary'),
    status: reviewStatusEnum('status').notNull().default('pending'),
    authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerId: integer('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    reviewNote: text('review_note'),
    autoApproved: integer('auto_approved').notNull().default(0),
    /** Set when this revision restores an earlier one. */
    revertsRevisionId: integer('reverts_revision_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /**
     * Drawn for a second look *after* publishing — never a gate.
     *
     * Trust is binary at two accepted contributions and nothing ever re-checks,
     * so a contributor who earns it and then degrades records is invisible.
     * These two columns are how a sample of already-published, auto-approved
     * work gets back in front of a moderator. Null on everything that was not
     * drawn, which is most of it. See `server/utils/sampling.ts`.
     */
    sampledAt: timestamp('sampled_at', { withTimezone: true }),
    sampleReason: varchar('sample_reason', { length: 20 }),
  },
  (table) => [
    index('revisions_status_idx').on(table.status, table.createdAt),
    index('revisions_history_idx').on(table.entityType, table.entityId, table.createdAt),
    index('revisions_entity_idx').on(table.entityType, table.entityId),
    index('revisions_author_idx').on(table.authorId),
    // Partial: the sampled set is a small fraction of a large table, and the
    // only query against it is "the outstanding ones, newest first".
    index('revisions_sampled_idx')
      .on(table.sampledAt)
      .where(sql`${table.sampledAt} IS NOT NULL`),
  ],
)
