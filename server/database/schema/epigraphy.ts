import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  varchar,
} from 'drizzle-orm/pg-core'
import { pointGeometry } from './sites'

/**
 * Epigraphic Database Heidelberg's `inscriptions/` tree
 * (`scripts/import/12-edh-inscriptions.ts`), a sibling of the `geography/`
 * dump `edh_findspots` already mirrors — 79,206 EpiDoc TEI records at import
 * time, CC BY-SA 4.0 (the licence is stated inside every file). Own table,
 * not joined to `sites`: this is imported reference material with its own
 * share-alike licence, the same reasoning that already keeps `antiquity_*`
 * and `edh_findspots` out of `sites`/the public GeoJSON feed. No `siteId`,
 * no `status` column — `applyRevision()`'s governance model is for
 * contributed records, and nothing here is one.
 *
 * `geom` is denormalised from `edh_findspots` at import time via
 * `originTrismegistosId` — a live join at read time would work too, but a
 * point this table draws its own map tiles from is worth carrying directly,
 * the same call every `antiquity_*` table already makes for its own geometry.
 *
 * `textEdition` holds the EpiDoc `<expan><abbr>…</abbr><ex>…</ex></expan>`
 * markup as structured `{ line, tokens: [{ text, abbr?, expansion? }] }[]` —
 * every abbreviation on every mirrored inscription arrives already
 * machine-parsed from the source, not inferred. This is what the formulary
 * aggregation (`app/pages/inscriptions/index.vue`) reads.
 */
export const inscriptions = pgTable(
  'inscriptions',
  {
    id: serial('id').primaryKey(),
    /** e.g. 'HD000001' — EDH's own stable identifier, and this table's natural key. */
    edhId: varchar('edh_id', { length: 16 }).notNull().unique(),
    trismegistosTextId: varchar('trismegistos_text_id', { length: 16 }),
    /** Free text, not capped — checked live against the full 79,206-record
     *  corpus: a fixed `varchar(200)` here overflowed on a real title well
     *  past that length, the same class of "this is scholarly prose, not a
     *  code" field `antiquity_places.description` already treats as `text`. */
    title: text('title').notNull(),
    /** Normalised from the EAGLE `typins` vocabulary term (e.g. 'Grabinschrift' → 'funerary'). */
    inscriptionType: varchar('inscription_type', { length: 80 }),
    /** Normalised from the EAGLE `objtyp` vocabulary term (e.g. 'Tafel' → 'plaque'). */
    objectType: varchar('object_type', { length: 80 }),
    material: text('material'),
    decorated: boolean('decorated').notNull().default(false),
    decorationNote: text('decoration_note'),
    heightCm: numeric('height_cm'),
    widthCm: numeric('width_cm'),
    depthCm: numeric('depth_cm'),
    /** The source gives a range ('3.2-2'), not a single figure — kept as text, not parsed apart. */
    letterHeightCm: varchar('letter_height_cm', { length: 32 }),
    originPlaceName: text('origin_place_name'),
    /** Joins `edh_findspots.trismegistos_id` — the same identifier, not a duplicate concept. */
    originTrismegistosId: varchar('origin_trismegistos_id', { length: 32 }),
    provinceName: text('province_name'),
    notBefore: integer('not_before'),
    notAfter: integer('not_after'),
    datingMethod: varchar('dating_method', { length: 120 }),
    findModernPlace: text('find_modern_place'),
    findModernCountryCode: varchar('find_modern_country_code', { length: 2 }),
    /** BCP-47-ish source language of the edition text, e.g. 'la', 'grc' — the source's own `xml:lang`. */
    textLanguage: varchar('text_language', { length: 8 }),
    /** Line-numbered diplomatic reading, `<lb>` breaks preserved as newlines. */
    textDiplomatic: text('text_diplomatic'),
    textEdition: jsonb('text_edition').$type<InscriptionEditionLine[]>(),
    commentary: text('commentary'),
    bibliography: text('bibliography').array(),
    sourceUrl: varchar('source_url', { length: 300 }).notNull(),
    licence: varchar('licence', { length: 40 }).notNull().default('CC-BY-SA-4.0'),
    geom: pointGeometry('geom'),
  },
  (table) => [
    index('inscriptions_geom_idx').using('gist', table.geom),
    index('inscriptions_trismegistos_idx').on(table.originTrismegistosId),
    index('inscriptions_type_idx').on(table.inscriptionType),
    index('inscriptions_language_idx').on(table.textLanguage),
  ],
)

export interface InscriptionEditionToken {
  text: string
  abbr?: string
  expansion?: string
}

export interface InscriptionEditionLine {
  line: number
  tokens: InscriptionEditionToken[]
}

/**
 * EDH's `image_metadata/` tree (`scripts/import/13-edh-inscription-images.ts`,
 * Phase 2) — CIDOC-CRM RDF records naming each photograph's own reuse
 * rights. Checked exhaustively, not sampled, before writing this table:
 * every one of the 43,199 real records (one of 43,200 files is empty) names
 * the identical Europeana rights code `rr-f` — "Rights Reserved – Free
 * Access", confirmed against Europeana's own page for it: "This digital
 * object is protected by copyright... free access [but] all other acts of
 * reproduction and communication to the public are subject to the licensing
 * conditions attached to the digital object." Not CC BY-SA like the text
 * corpus, not any open licence — retired by Europeana in favour of "In
 * Copyright", the plainest possible signal. **Bytes are never mirrored as a
 * result** — `mirrored` reads `false` and `storageKey` stays null for every
 * row this import writes. The rights check still runs per record rather
 * than being hardcoded to `false`, the same discipline
 * `11-column-reliefs.ts` applies to Commons' `Copyrighted` field: if EDH
 * ever adds an openly-licensed photograph, a future run picks it up without
 * this file needing to change.
 */
export const inscriptionImages = pgTable(
  'inscription_images',
  {
    id: serial('id').primaryKey(),
    inscriptionId: integer('inscription_id')
      .notNull()
      .references(() => inscriptions.id),
    /** e.g. 'F000001' — EDH's own photograph identifier. */
    edhPhotoId: varchar('edh_photo_id', { length: 16 }).notNull().unique(),
    rightsStatement: varchar('rights_statement', { length: 200 }).notNull(),
    rightsHolder: varchar('rights_holder', { length: 200 }),
    mirrored: boolean('mirrored').notNull().default(false),
    storageKey: varchar('storage_key', { length: 300 }),
    sourceUrl: varchar('source_url', { length: 300 }).notNull(),
  },
  (table) => [index('inscription_images_inscription_idx').on(table.inscriptionId)],
)
