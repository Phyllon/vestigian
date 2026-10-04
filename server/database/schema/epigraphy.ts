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

/**
 * Attic Inscriptions Online (`scripts/import/14-attic-inscriptions.ts`,
 * Phase 2) — a second, smaller, genuinely separate corpus, not a
 * duplicate of `inscriptions`. Confirmed live before building: AIO's own
 * REST API (`atticinscriptions.com/api/`) is real but thin — a paginated
 * list (3,412 records) and a per-record endpoint carrying only the English
 * translation (as base64 EpiDoc), a translator credit, cross-references to
 * other corpora (IG, SEG, PHI, …) and a generic `"IPR": "Creative Commons"`
 * string. The actually useful structured metadata this table needs —
 * monument type, inscription type, date, and critically a **Pleiades URI
 * per findspot** — is rendered only in each inscription's own HTML page,
 * never exposed by the JSON API at all. `14-attic-inscriptions.ts` fetches
 * both per record. The generic "Creative Commons" IPR string is not the
 * real licence: every inscription page carries a `rel="license"` link to
 * `creativecommons.org/licenses/by-sa/3.0/`, checked against several
 * records spanning different translators and source volumes, not assumed
 * from one sample or from the vaguer API field.
 *
 * `geom` resolves through the **same** `pleiadesId` extraction
 * `05-antiquity-atlas.ts` already uses (the last path segment of a
 * Pleiades URI) joined against `antiquityPlaces.pleiadesId` — confirmed
 * live that both sample findspot ids from AIO's own pages, including a
 * newer long-form Pleiades id, already resolve in that table. No new join
 * key needed; this is the same identifier space the Barrington sheet's own
 * places already live in, not a second geocoding scheme.
 *
 * `translationEdition` is parsed from the **rendered HTML**, not the raw
 * EpiDoc XML the API returns — AIO's own translation markup
 * (`.insline`/`.aio_place`/`.translit`/`.inslineno`) is simpler and more
 * reliable to read than re-deriving the same structure from nested XML,
 * and it is what "the site itself already renders safely" looks like, the
 * same "read the real page" call already made for the column-relief plate
 * numbers and the minor-antiquities AWMC codes. It is never rendered with
 * `v-html` — every segment is a typed object the Vue template branches on
 * explicitly, the same discipline `inscriptions.textEdition` already uses
 * for EDH's abbreviation tokens.
 */
export const atticInscriptions = pgTable(
  'attic_inscriptions',
  {
    id: serial('id').primaryKey(),
    /** e.g. 'AIO_5' — AIO's own stable identifier, and this table's natural key. */
    aioKey: varchar('aio_key', { length: 16 }).notNull().unique(),
    title: text('title').notNull(),
    /** Human-readable citation, e.g. 'IG II³ 1 292' — display only, not a join key. */
    primarySource: varchar('primary_source', { length: 160 }),
    /** Raw text, e.g. '352/1 BC' — Athenian archon-year notation, not reliably
     *  reducible to a single calendar year, so kept verbatim alongside the
     *  best-effort `notBefore`/`notAfter` parse below. */
    dateText: varchar('date_text', { length: 120 }),
    notBefore: integer('not_before'),
    notAfter: integer('not_after'),
    monumentType: varchar('monument_type', { length: 80 }),
    /** A short phrase ('Decree (People?) and Correction'), not a small enum
     *  like EDH's `inscriptionType` — AIO does not publish a controlled
     *  vocabulary for this field, so it is stored and shown as-is. */
    inscriptionType: text('inscription_type'),
    translators: text('translators').array(),
    translationEdition: jsonb('translation_edition').$type<AtticTranslationSegment[]>(),
    footnotes: jsonb('footnotes').$type<AtticFootnote[]>(),
    originalLocation: jsonb('original_location').$type<AtticPlaceRef | null>(),
    /** A record can name more than one findspot — a decree cut on two
     *  stelai, or a text assembled from fragments found in different
     *  places. `geom` denormalises the first resolvable one for the map;
     *  the full list is what the detail page actually shows. */
    findspots: jsonb('findspots').$type<AtticFindspot[]>(),
    imageCredits: jsonb('image_credits').$type<AtticImageCredit[]>(),
    references: jsonb('references').$type<AtticReference[]>(),
    sourceUrl: varchar('source_url', { length: 300 }).notNull(),
    licence: varchar('licence', { length: 40 }).notNull().default('CC-BY-SA-3.0'),
    geom: pointGeometry('geom'),
  },
  (table) => [
    index('attic_inscriptions_geom_idx').using('gist', table.geom),
    index('attic_inscriptions_monument_idx').on(table.monumentType),
  ],
)

export interface AtticTranslationSegment {
  type: 'text' | 'break' | 'lineNumber' | 'place' | 'gloss' | 'note'
  text?: string
  pleiadesId?: string
  number?: number
}

export interface AtticFootnote {
  number: number
  text: string
}

export interface AtticPlaceRef {
  text: string
  pleiadesId: string | null
}

export interface AtticFindspot extends AtticPlaceRef {
  label: string | null
}

export interface AtticImageCredit {
  collection: string
  url: string
}

export interface AtticReference {
  source: string
  reference: string
  externalLinks: string[]
  isTranslationSource?: boolean
}

/**
 * I.Sicily — the inscriptions of ancient Sicily across all its languages
 * (`scripts/import/24-isicily-inscriptions.ts`), Oxford / ERC Crossreads, from
 * `github.com/ISicily/ISicily`. A third, genuinely separate corpus beside EDH
 * and Attic Inscriptions Online: 5,136 EpiDoc records, 3,210 of them Greek and
 * several in Elymian, Sikel and Punic that neither of the others covers.
 *
 * **Licence is per record and read from it**: 5,130 files state CC BY 4.0 and
 * six state CC BY-NC 4.0 (`licence`). **The photographs are not mirrored**, even
 * though the text is: each `<graphic>` is captioned "with the permission of the
 * Assessorato Regionale dei Beni Culturali e dell'Identità Siciliana", a
 * permission to I.Sicily, not a licence to anyone downstream — see
 * `.claude/rules/epigraphy.md`.
 *
 * `geom` is the file's own `<geo>`, which is the modern settlement the stone is
 * attributed to, not an excavated findspot. It is shown as an approximate place.
 */
export const isicilyInscriptions = pgTable(
  'isicily_inscriptions',
  {
    id: serial('id').primaryKey(),
    /** e.g. 'ISic000001' — I.Sicily's own filename and natural key. */
    isicilyId: varchar('isicily_id', { length: 16 }).notNull().unique(),
    title: text('title').notNull(),
    /** ISO 639 code of the main text language: grc, la, xpu, xly, scx, osc, he. */
    language: varchar('language', { length: 8 }),
    /** I.Sicily's own `function.*` vocabulary: funerary, dedication, honorific, … */
    inscriptionFunction: varchar('inscription_function', { length: 60 }),
    objectType: varchar('object_type', { length: 80 }),
    material: varchar('material', { length: 80 }),
    /** The editor's wording, e.g. "between later 1st and 3rd century CE". */
    dateText: text('date_text'),
    /** Traditional year counts, negative for BCE — the same convention as `attic_inscriptions`. */
    notBefore: integer('not_before'),
    notAfter: integer('not_after'),
    placeName: varchar('place_name', { length: 160 }),
    ancientPlaceName: varchar('ancient_place_name', { length: 160 }),
    pleiadesId: varchar('pleiades_id', { length: 24 }),
    geonamesUrl: varchar('geonames_url', { length: 300 }),
    /** Where it is now: the museum or collection, if the record names one. */
    repository: varchar('repository', { length: 240 }),
    /** How and when it was found, in the editor's words. */
    provenance: text('provenance'),
    /** The primary edition as plain text, one line of the stone per line. */
    edition: text('edition'),
    /** English translation, when the record carries one (1,218 of them do). */
    translation: text('translation'),
    trismegistosId: varchar('trismegistos_id', { length: 24 }),
    edcsId: varchar('edcs_id', { length: 24 }),
    edrId: varchar('edr_id', { length: 24 }),
    licence: varchar('licence', { length: 24 }).notNull(),
    sourceUrl: varchar('source_url', { length: 300 }).notNull(),
    geom: pointGeometry('geom'),
  },
  (table) => [
    index('isicily_inscriptions_geom_idx').using('gist', table.geom),
    index('isicily_inscriptions_function_idx').on(table.inscriptionFunction),
  ],
)
