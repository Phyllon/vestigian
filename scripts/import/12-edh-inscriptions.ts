/**
 * Imports the Epigraphic Database Heidelberg's inscription text corpus —
 * `inscriptions/**\/*.xml` in the same GitHub mirror `08-edh-findspots.ts`
 * already reads (`epigraphic-database-heidelberg/data`), one EpiDoc TEI file
 * per inscription. Verified live before this was written: 79,206 files,
 * CC BY-SA 4.0 stated inside every one of them
 * (`<licence target="…/by-sa/4.0/">`), carrying material, dimensions,
 * object/decoration type, inscription type, dating, origin place, findspot
 * and — the reason this import exists — inline abbreviation markup
 * (`<expan><abbr>D</abbr><ex>is</ex></expan>`) already machine-parsed by the
 * source, needing no OCR or NLP to recover.
 *
 * One file per record over GitHub's unauthenticated Contents API (60 req/hr)
 * cannot work at 79,206 files, so this fetches the whole repository as one
 * tarball from `codeload.github.com` — the same one-shot "download once,
 * read locally, thrown away" shape the vici.org MySQL dump already uses —
 * and extracts only the `inscriptions/` subtree, ignoring `image_metadata/`,
 * `bibliography/` and `geography/` (the last of those is what
 * `08-edh-findspots.ts` already imports separately).
 *
 * Geometry is not in these files at all — an inscription's `<origPlace>`
 * carries a Trismegistos *place* reference, not coordinates. Resolved by
 * joining `edh_findspots.trismegistos_id`, the same identifier
 * `verifySiteAgainstEdh` already uses, in a second pass after the main
 * insert rather than a per-row lookup.
 *
 * Photographs are not imported here — EDH's own per-photo rights statements
 * vary (checked live: a sample is "Rights Reserved – Free Access", not an
 * open licence) and need their own per-record decision. That is
 * `13-edh-inscription-images.ts`, a separate later stage.
 *
 *   pnpm import:edh-inscriptions
 *   IMPORT_LIMIT=200 pnpm import:edh-inscriptions
 */
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { DOMParser, type Document, type Element, type Node as XmlNode } from '@xmldom/xmldom'
import { Redis } from 'ioredis'
import postgres from 'postgres'
import * as tar from 'tar'
import {
  checksumOfSource,
  guardImport,
  isDryRun,
  recordImportRun,
  type RecordImportRunInput,
} from './guard'
import type { InscriptionEditionLine, InscriptionEditionToken } from '../../server/database/schema'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'edh-inscriptions')
const ARCHIVE_PATH = join(CACHE_DIR, 'data.tar.gz')
const EXTRACT_DIR = join(CACHE_DIR, 'inscriptions')
const SOURCE_URL = 'https://codeload.github.com/epigraphic-database-heidelberg/data/tar.gz/master'
/** Names the upstream, not this file — the script may be renamed, the source may not. */
const SOURCE_ID = 'edh:inscriptions'

const IMPORT_LIMIT = Number(process.env.IMPORT_LIMIT ?? Number.POSITIVE_INFINITY)

/**
 * Only the handful of German EAGLE-vocabulary terms actually observed while
 * building this import, not the full upstream vocabulary — EAGLE's own LOD
 * endpoints were not confirmed live for this pass (see the plan's own note
 * on this). An unrecognised term is kept as-is rather than guessed at, the
 * same restraint this project already applies to AWMC's material/period
 * codes (`.claude/rules/map-and-tiles.md`) — extend this table as real data
 * surfaces more terms, don't invent coverage ahead of seeing them. Widened
 * once already against a real 1,500-record sample (still a fraction of the
 * full 79,206), which is also what surfaced the trailing `?` EDH appends to
 * a term when its own classification is uncertain — stripped before lookup
 * in `normaliseVocabTerm` rather than preserved, since carrying "uncertain"
 * through as its own fact would need a second column this pass doesn't add.
 */
const INSCRIPTION_TYPE_LABELS: Record<string, string> = {
  grabinschrift: 'funerary',
  'bau-/stifterinschrift': 'building',
  bauinschrift: 'building',
  weihinschrift: 'votive',
  ehreninschrift: 'honorific',
  meilenstein: 'milestone',
  'meilen-/leugenstein': 'milestone',
  grenzstein: 'boundary-marker',
  grenzmarkierung: 'boundary-marker',
  militärdiplom: 'military-diploma',
  'besitzer-/herstellerinschrift': 'owner-or-maker',
  beischrift: 'label',
  akklamation: 'acclamation',
  defixio: 'curse-tablet',
  'rechtliche verfügung, öffentlich': 'public-legal-decree',
  'rechtliche verfügung, privat': 'private-legal-decree',
  verzeichnis: 'register',
  kalender: 'calendar',
  unbestimmt: 'undetermined',
}

const OBJECT_TYPE_LABELS: Record<string, string> = {
  tafel: 'plaque',
  stele: 'stele',
  altar: 'altar',
  sarkophag: 'sarcophagus',
  platte: 'slab',
  block: 'block',
  säule: 'column',
  statue: 'statue',
  meilenstein: 'milestone',
  'instrumentum domesticum': 'domestic-item',
  statuenbasis: 'statue-base',
  architekturteil: 'architectural-element',
  ziegel: 'brick',
  tessera: 'tessera',
  unbestimmt: 'undetermined',
}

const NO_DECORATION_LABELS = new Set(['nein', 'no', 'none', 'keine'])

export const normaliseVocabTerm = (
  raw: string | null,
  table: Record<string, string>,
): string | null => {
  if (!raw) return null
  const trimmed = raw.trim().replace(/\?$/, '')
  return table[trimmed.toLowerCase()] ?? trimmed
}

const exists = async (path: string): Promise<boolean> =>
  readFile(path)
    .then(() => true)
    .catch(() => false)

const downloadArchive = async (): Promise<void> => {
  if (await exists(ARCHIVE_PATH)) {
    console.log('Archive already downloaded, reusing it.')
    return
  }

  process.stdout.write('  ↓ epigraphic-database-heidelberg/data (full tarball) … ')
  const response = await fetch(SOURCE_URL)
  if (!response.ok || !response.body) {
    throw new Error(`${SOURCE_URL} answered ${response.status}`)
  }
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(ARCHIVE_PATH),
  )
  console.log('done.')
}

/** Extracts only the `inscriptions/` subtree — `image_metadata/` and
 *  `bibliography/` are Phase 2/unused, no reason to spend disk on them here. */
const extractInscriptions = async (): Promise<void> => {
  if (existsSync(EXTRACT_DIR)) {
    console.log('Archive already extracted, reusing it.')
    return
  }

  console.log('Extracting inscriptions/ from the tarball…')
  await tar.extract({
    file: ARCHIVE_PATH,
    cwd: CACHE_DIR,
    strip: 1,
    filter: (path) => path.includes('/inscriptions/') && path.endsWith('.xml'),
  })
}

const listXmlFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.xml'))
    .map((entry) => join(entry.parentPath, entry.name))
}

const firstChildByTag = (node: Element | Document, tag: string): Element | null =>
  node.getElementsByTagName(tag).item(0)

const attr = (node: Element | null | undefined, name: string): string | null =>
  node?.getAttribute(name) || null

const text = (node: Element | null | undefined): string | null => {
  const value = node?.textContent?.trim()
  return value || null
}

/**
 * Trailing numeric id from a Trismegistos or GeoNames-style URI —
 * zero-stripped, not verbatim: this inscription corpus's `ref` URLs carry
 * zero-padded Trismegistos ids ('.../place/014437'), while `edh_findspots`
 * (`08-edh-findspots.ts`, parsed from a different URL shape in the geography
 * dump) stores the same id unpadded ('14437') — confirmed live, a naive
 * verbatim join against a fresh import matched 0 of 5 real records that
 * plainly shared a findspot. `Number()` round-trips safely here since every
 * value matched is already digits-only.
 */
export const trailingId = (uri: string | null): string | null => {
  if (!uri) return null
  const match = /\/(\d+)\/?$/.exec(uri)
  return match ? String(Number(match[1])) : null
}

/** e.g. 'http://www.geonames.org/countries/it/' → 'IT'. */
export const countryCodeFromGeonamesUri = (uri: string | null): string | null => {
  if (!uri) return null
  const match = /\/countries\/([a-z]{2})\/?$/i.exec(uri)
  return match ? match[1]!.toUpperCase() : null
}

/** '0071' / '0130' → 71 / 130 — the source zero-pads to four digits. */
export const parseYear = (raw: string | null): number | null => {
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : null
}

interface ParsedInscription {
  edhId: string
  trismegistosTextId: string | null
  title: string
  inscriptionType: string | null
  objectType: string | null
  material: string | null
  decorated: boolean
  decorationNote: string | null
  heightCm: number | null
  widthCm: number | null
  depthCm: number | null
  letterHeightCm: string | null
  originPlaceName: string | null
  originTrismegistosId: string | null
  provinceName: string | null
  notBefore: number | null
  notAfter: number | null
  datingMethod: string | null
  findModernPlace: string | null
  findModernCountryCode: string | null
  textLanguage: string | null
  textDiplomatic: string | null
  textEdition: InscriptionEditionLine[] | null
  commentary: string | null
  bibliography: string[] | null
  sourceUrl: string
}

/**
 * Walks a TEI `<div type="edition">`'s `<ab>` in document order, splitting
 * into lines at `<lb>` and reading `<expan><abbr>…</abbr><ex>…</ex></expan>`
 * as a token carrying both the as-carved abbreviation and its expansion.
 * Anything else inside `<ab>` (`<gap>`, `<supplied>`, `<unclear>` — real TEI
 * apparatus this project does not yet render specially) falls through to its
 * own text content, so no text is lost, but damage/restoration markup is not
 * distinguished from plain text yet — a known simplification, not a guess at
 * behaviour this pass didn't actually implement.
 */
export const parseEditionAb = (ab: Element): InscriptionEditionLine[] => {
  const lines: InscriptionEditionLine[] = []
  // 0 until the first `<lb>` is seen — EpiDoc's `<lb n="N"/>` marks the
  // *start* of line N, not a separator between two accumulated lines, so
  // flushing before a line number has ever been assigned must produce
  // nothing. Treating it as a separator instead (flush, then increment) was
  // this function's first version, and it silently numbered every line one
  // higher than the source: `<lb n="1"/>` sits before any content at all, so
  // "flush (nothing to flush) then move to line 2" put the inscription's
  // real first line under `line: 2` — caught by reading a real imported
  // row's `text_edition` back, not by inspecting this code in isolation.
  let currentLine = 0
  let tokens: InscriptionEditionToken[] = []

  const flush = (): void => {
    if (currentLine > 0 && tokens.length > 0) lines.push({ line: currentLine, tokens })
    tokens = []
  }

  // Content can appear before any `<lb>` at all — a short inscription with
  // no line breaks, or stray text ahead of the first explicit marker. Either
  // counts as line 1 rather than being dropped by `flush`'s `currentLine > 0`
  // guard, which exists for the *other* direction (nothing accumulated yet).
  const ensureLineStarted = (): void => {
    if (currentLine === 0) currentLine = 1
  }

  const pushText = (raw: string): void => {
    const value = raw.replace(/\s+/g, ' ').trim()
    if (!value) return
    ensureLineStarted()
    tokens.push({ text: value })
  }

  const walk = (node: XmlNode): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      pushText(node.nodeValue ?? '')
      return
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return

    const element = node as Element
    const tag = element.tagName.toLowerCase()

    if (tag === 'lb') {
      flush()
      const explicitN = Number(element.getAttribute('n'))
      currentLine = Number.isFinite(explicitN) && explicitN > 0 ? explicitN : currentLine + 1
      return
    }
    if (tag === 'expan') {
      const abbr = text(firstChildByTag(element, 'abbr'))
      const expansion = text(firstChildByTag(element, 'ex'))
      if (abbr) {
        ensureLineStarted()
        tokens.push({ text: abbr, abbr, expansion: expansion ?? undefined })
      }
      return
    }

    Array.from(element.childNodes).forEach(walk)
  }

  Array.from(ab.childNodes).forEach(walk)
  flush()
  return lines
}

export const diplomaticText = (lines: InscriptionEditionLine[]): string | null => {
  if (lines.length === 0) return null
  return lines.map((line) => line.tokens.map((token) => token.text).join(' ')).join('\n')
}

const parseInscriptionXml = (xml: string, edhId: string): ParsedInscription | null => {
  const doc = new DOMParser({
    errorHandler: () => {
      /* EDH's own corpus carries the occasional malformed entity; skip the
         record rather than let xmldom's default handler throw for the whole
         batch — reported via the null return and counted by the caller. */
    },
  }).parseFromString(xml, 'text/xml')

  const titleEl = firstChildByTag(doc, 'title')
  const title = text(titleEl)
  if (!title) return null

  const idnos = Array.from(doc.getElementsByTagName('idno'))
  const tmId = idnos.find((el) => attr(el, 'type') === 'TM')
  const sourceUriEl = idnos.find((el) => attr(el, 'type') === 'URI')
  const sourceUrl =
    text(sourceUriEl) ?? `https://edh-www.adw.uni-heidelberg.de/edh/inschrift/${edhId}`

  const objectTypeEl = firstChildByTag(doc, 'objectType')
  const materialEl = firstChildByTag(doc, 'material')
  const decorationEl = Array.from(doc.getElementsByTagName('rs')).find(
    (el) => attr(el, 'type') === 'decoration',
  )
  const decorationLabel = text(decorationEl ?? null)
  const decorated = !!decorationLabel && !NO_DECORATION_LABELS.has(decorationLabel.toLowerCase())

  const heightEls = doc.getElementsByTagName('dimensions')
  const objectDimensions = heightEls.item(0)
  const letterDimensions = heightEls.item(1)

  const numeric = (el: Element | null, tag: string): number | null => {
    const value = text(el ? firstChildByTag(el, tag) : null)
    if (!value) return null
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const typeTermEl = Array.from(doc.getElementsByTagName('term')).at(0)

  const placeNames = Array.from(doc.getElementsByTagName('origPlace')).at(0)
    ? Array.from(
        (Array.from(doc.getElementsByTagName('origPlace')).at(0) as Element).getElementsByTagName(
          'placeName',
        ),
      )
    : []
  const provinceNameEl = placeNames.find((el) => attr(el, 'type') === 'provinceItalicRegion')
  const originPlaceEl = placeNames.find((el) => attr(el, 'type') !== 'provinceItalicRegion')
  const originTrismegistosId =
    trailingId(attr(originPlaceEl ?? null, 'ref')) ??
    trailingId(attr(provinceNameEl ?? null, 'ref'))

  const origDateEl = firstChildByTag(doc, 'origDate')
  const notBefore = parseYear(attr(origDateEl, 'notBefore-custom'))
  const notAfter = parseYear(attr(origDateEl, 'notAfter-custom'))
  const datingMethodUrl = attr(origDateEl, 'datingMethod')

  const provenanceEl = Array.from(doc.getElementsByTagName('provenance')).find(
    (el) => attr(el, 'type') === 'found',
  )
  const provenancePlaces = provenanceEl
    ? Array.from(provenanceEl.getElementsByTagName('placeName'))
    : []
  const findModernPlaceEl = provenancePlaces.find((el) => !attr(el, 'type'))
  const findCountryEl = provenancePlaces.find((el) => attr(el, 'type') === 'modernCountry')

  const editionDiv = Array.from(doc.getElementsByTagName('div')).find(
    (el) => attr(el, 'type') === 'edition',
  )
  const ab = editionDiv ? firstChildByTag(editionDiv, 'ab') : null
  const editionLines = ab ? parseEditionAb(ab) : []

  const bibliography = Array.from(doc.getElementsByTagName('bibl'))
    .map((el) => text(el))
    .filter((value): value is string => value !== null)

  const commentaryDiv = Array.from(doc.getElementsByTagName('div')).find(
    (el) => attr(el, 'type') === 'commentary',
  )
  const commentary = commentaryDiv ? text(firstChildByTag(commentaryDiv, 'p')) : null

  return {
    edhId,
    trismegistosTextId: text(tmId ?? null),
    title,
    inscriptionType: normaliseVocabTerm(text(typeTermEl ?? null), INSCRIPTION_TYPE_LABELS),
    objectType: normaliseVocabTerm(text(objectTypeEl), OBJECT_TYPE_LABELS),
    material: text(materialEl),
    decorated,
    decorationNote: decorated ? decorationLabel : null,
    heightCm: numeric(objectDimensions, 'height'),
    widthCm: numeric(objectDimensions, 'width'),
    depthCm: numeric(objectDimensions, 'depth'),
    letterHeightCm: text(letterDimensions ? firstChildByTag(letterDimensions, 'height') : null),
    originPlaceName: text(originPlaceEl ?? null),
    originTrismegistosId,
    provinceName: text(provinceNameEl ?? null),
    notBefore,
    notAfter,
    datingMethod: datingMethodUrl ? (datingMethodUrl.split('/').pop() ?? null) : null,
    findModernPlace: text(findModernPlaceEl ?? null),
    findModernCountryCode: countryCodeFromGeonamesUri(attr(findCountryEl ?? null, 'ref')),
    textLanguage: attr(editionDiv ?? null, 'xml:lang'),
    textDiplomatic: diplomaticText(editionLines),
    textEdition: editionLines.length > 0 ? editionLines : null,
    commentary,
    bibliography: bibliography.length > 0 ? bibliography : null,
    sourceUrl,
  }
}

/**
 * `sql(rows, ...columns)` uses each object's own keys as literal SQL column
 * identifiers — postgres.js applies no camelCase→snake_case transform for
 * this `sql` client, the same reason every other script in this pipeline
 * writes snake_case by hand rather than relying on one. `toRow` is the one
 * place `ParsedInscription`'s camelCase fields cross that boundary.
 */
const INSERT_COLUMNS = [
  'edh_id',
  'trismegistos_text_id',
  'title',
  'inscription_type',
  'object_type',
  'material',
  'decorated',
  'decoration_note',
  'height_cm',
  'width_cm',
  'depth_cm',
  'letter_height_cm',
  'origin_place_name',
  'origin_trismegistos_id',
  'province_name',
  'not_before',
  'not_after',
  'dating_method',
  'find_modern_place',
  'find_modern_country_code',
  'text_language',
  'text_diplomatic',
  'text_edition',
  'commentary',
  'bibliography',
  'source_url',
] as const

const toRow = (record: ParsedInscription) => ({
  edh_id: record.edhId,
  trismegistos_text_id: record.trismegistosTextId,
  title: record.title,
  inscription_type: record.inscriptionType,
  object_type: record.objectType,
  material: record.material,
  decorated: record.decorated,
  decoration_note: record.decorationNote,
  height_cm: record.heightCm,
  width_cm: record.widthCm,
  depth_cm: record.depthCm,
  letter_height_cm: record.letterHeightCm,
  origin_place_name: record.originPlaceName,
  origin_trismegistos_id: record.originTrismegistosId,
  province_name: record.provinceName,
  not_before: record.notBefore,
  not_after: record.notAfter,
  dating_method: record.datingMethod,
  find_modern_place: record.findModernPlace,
  find_modern_country_code: record.findModernCountryCode,
  text_language: record.textLanguage,
  text_diplomatic: record.textDiplomatic,
  text_edition: record.textEdition
    ? sql.json(record.textEdition as unknown as Parameters<typeof sql.json>[0])
    : null,
  commentary: record.commentary,
  bibliography: record.bibliography,
  source_url: record.sourceUrl,
})

const insertBatch = async (batch: ParsedInscription[]): Promise<void> => {
  const rows = batch.map(toRow)

  await sql`
    INSERT INTO inscriptions ${sql(rows, ...INSERT_COLUMNS)}
    ON CONFLICT (edh_id) DO UPDATE SET
      trismegistos_text_id = EXCLUDED.trismegistos_text_id,
      title = EXCLUDED.title,
      inscription_type = EXCLUDED.inscription_type,
      object_type = EXCLUDED.object_type,
      material = EXCLUDED.material,
      decorated = EXCLUDED.decorated,
      decoration_note = EXCLUDED.decoration_note,
      height_cm = EXCLUDED.height_cm,
      width_cm = EXCLUDED.width_cm,
      depth_cm = EXCLUDED.depth_cm,
      letter_height_cm = EXCLUDED.letter_height_cm,
      origin_place_name = EXCLUDED.origin_place_name,
      origin_trismegistos_id = EXCLUDED.origin_trismegistos_id,
      province_name = EXCLUDED.province_name,
      not_before = EXCLUDED.not_before,
      not_after = EXCLUDED.not_after,
      dating_method = EXCLUDED.dating_method,
      find_modern_place = EXCLUDED.find_modern_place,
      find_modern_country_code = EXCLUDED.find_modern_country_code,
      text_language = EXCLUDED.text_language,
      text_diplomatic = EXCLUDED.text_diplomatic,
      text_edition = EXCLUDED.text_edition,
      commentary = EXCLUDED.commentary,
      bibliography = EXCLUDED.bibliography,
      source_url = EXCLUDED.source_url
  `
}

/** Second pass: `inscriptions` carries no coordinates of its own in the
 *  source — resolved from `edh_findspots` by the shared Trismegistos id,
 *  the same join `verifySiteAgainstEdh` already relies on. */
/**
 * `edh_findspots.trismegistos_id` is **not unique** — confirmed live against
 * the real geography dump: 2,210 of 8,234 distinct ids (27%) resolve to more
 * than one distinct coordinate, one pair over 6 km apart. A plain join
 * against a non-unique key lets Postgres pick an arbitrary matching row —
 * caught only by checking a specific inscription's resolved position by hand
 * and finding it 6 km from the site it should have sat 200 m from, not by
 * any error or type failure. `HAVING count(DISTINCT geom) = 1` resolves only
 * the unambiguous 73%; the rest keep a null `geom` rather than a confidently
 * wrong one, the same "don't guess" restraint this project already applies
 * to `sites.country_code` when a coastal point resolves to no country at all.
 */
const resolveGeometry = async (): Promise<void> => {
  const findspots = await sql<{ trismegistosId: string; lon: number; lat: number }[]>`
    SELECT trismegistos_id AS "trismegistosId",
           ST_X((array_agg(geom))[1]) AS lon, ST_Y((array_agg(geom))[1]) AS lat
    FROM edh_findspots
    WHERE trismegistos_id IS NOT NULL
    GROUP BY trismegistos_id
    HAVING count(DISTINCT geom) = 1
  `
  console.log(`\nResolving geometry against ${findspots.length} unambiguous EDH findspots…`)

  const BATCH_SIZE = 1000
  for (let start = 0; start < findspots.length; start += BATCH_SIZE) {
    const batch = findspots.slice(start, start + BATCH_SIZE)
    await sql`
      UPDATE inscriptions
      SET geom = ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
      FROM unnest(
        ${batch.map((row) => row.trismegistosId)}::text[],
        ${batch.map((row) => row.lon)}::double precision[],
        ${batch.map((row) => row.lat)}::double precision[]
      ) AS v(trismegistos_id, lon, lat)
      WHERE inscriptions.origin_trismegistos_id = v.trismegistos_id
    `
  }

  const [row] = await sql<{ count: string }[]>`
    SELECT count(*) FROM inscriptions WHERE geom IS NOT NULL
  `
  console.log(`${row?.count ?? 0} inscriptions now carry a resolved findspot.`)
}

interface ArchiveGuardResult {
  proceed: boolean
  /** Null when this run must not become a baseline — see `IMPORT_LIMIT` below. */
  record: RecordImportRunInput | null
}

/**
 * Refuses an archive that no longer resembles the last one.
 *
 * Counted in files served rather than inscriptions parsed, because that is the
 * measurement of the *upstream*: the malformed count is reported separately,
 * and a run where it jumps is a parser or source problem rather than a volume
 * one. Whatever is compared has to be what gets recorded, or the next run is
 * judged against a different quantity than it measures.
 *
 * `IMPORT_LIMIT` deliberately truncates the run, so a limited import is not a
 * measurement of anything and must never become the baseline a later full run
 * is judged against — `IMPORT_LIMIT=200` followed by an ordinary run would read
 * as a 400-fold growth and be refused. Such a run is left unguarded and
 * unrecorded rather than recorded with a caveat nothing later reads.
 */
const guardArchive = async (fileCount: number): Promise<ArchiveGuardResult> => {
  const checksum = checksumOfSource(await readFile(ARCHIVE_PATH))

  if (Number.isFinite(IMPORT_LIMIT)) {
    console.log('· IMPORT_LIMIT is set: skipping the import guard and not recording a baseline.\n')
    return { proceed: true, record: null }
  }

  const proceed = await guardImport({
    sql,
    source: SOURCE_ID,
    rowCount: fileCount,
    checksum,
    dryRun: isDryRun(process.argv),
  })

  console.log()
  return { proceed, record: { source: SOURCE_ID, rowCount: fileCount, checksum } }
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Importing EDH inscriptions — CC BY-SA 4.0, epigraphic-database-heidelberg/data.\n')

  await downloadArchive()
  await extractInscriptions()

  console.log('Listing extracted files…')
  const files = (await listXmlFiles(EXTRACT_DIR))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, IMPORT_LIMIT)
  console.log(`${files.length} inscription files to import.`)

  const guard = await guardArchive(files.length)
  if (!guard.proceed) {
    await sql.end()
    return
  }

  let parsed = 0
  let malformed = 0
  const BATCH_SIZE = 200
  let batch: ParsedInscription[] = []

  for (const file of files) {
    const edhId = file.slice(file.lastIndexOf('/') + 1).replace(/\.xml$/, '')
    const xml = await readFile(file, 'utf8')

    let record: ParsedInscription | null
    try {
      record = parseInscriptionXml(xml, edhId)
      if (!record) console.warn(`  ~ ${edhId}: no <title>, skipped`)
    } catch (error) {
      // A recoverable issue (a stray malformed entity) goes through the
      // parser's own `errorHandler` and returns null above; a genuinely
      // unparseable file (found live at HD-number ~69,700 of 79,206: "missing
      // root element") throws instead — xmldom's `errorHandler` runs before
      // that throw, it does not suppress it. One bad file in 79,206 is not
      // worth losing the whole run for, so it's caught here and counted the
      // same way, rather than crashing `main` three-quarters of the way in.
      record = null
      console.warn(`  ~ ${edhId}: unparseable XML (${(error as Error).message}), skipped`)
    }
    if (!record) {
      malformed += 1
      continue
    }

    batch.push(record)
    parsed += 1

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch)
      console.log(`· inscriptions ${parsed}/${files.length}`)
      batch = []
    }
  }
  if (batch.length > 0) await insertBatch(batch)

  console.log(`\n${parsed} inscriptions imported, ${malformed} malformed and skipped.`)

  // After the write, never before: a run that dies partway must not leave a
  // baseline claiming rows it never wrote.
  if (guard.record) await recordImportRun(sql, guard.record)

  await resolveGeometry()

  // Rides the shared atlas cache generation, same as every other imported
  // reference layer (`ports.ts`, `battles.ts`) — a moderator's approval
  // bumps `data-version` instead, this table has nothing to do with that
  // clock. Cleared rather than incremented first: an unset key already
  // reads as 1, so the first increment alone would leave the prefix where
  // it was (see `05-antiquity-atlas.ts`'s own note on this).
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    const stale = await redis.keys('inscription:v*')
    if (stale.length > 0) await redis.del(...stale)
    console.log(
      `\nAtlas cache generation is now ${version}; ${stale.length} stale inscription tiles dropped.`,
    )
  } catch (error) {
    console.warn(
      `\nInscriptions imported, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous tiles.`,
    )
  } finally {
    redis.disconnect()
  }

  console.log(
    '\nNext: pnpm exec tsx scripts/verify-concordances.ts (unaffected by this table, but the',
  )
  console.log(
    'usual next step after an EDH-sourced import) and pnpm tiles:warm once served on the map.',
  )

  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
