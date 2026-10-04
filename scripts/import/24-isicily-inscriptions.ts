/**
 * I.Sicily — the inscriptions of ancient Sicily, in every language they were
 * written in (Greek, Latin, Elymian, Sikel, Punic, Oscan, Hebrew).
 * `github.com/ISicily/ISicily`, University of Oxford / ERC Crossreads, one
 * EpiDoc TEI file per inscription.
 *
 * **Licence is stated inside every file** (`<availability><licence target=…>`),
 * and is read per record rather than assumed for the corpus: of the 5,136 files
 * fetched on 3 Oct 2026, 5,130 name CC BY 4.0 and **six name CC BY-NC 4.0**.
 * Both are kept with their own value in `isicily_inscriptions.licence`; a file
 * naming anything else is skipped and counted, because an unrecognised licence
 * is never published.
 *
 * **Photographs are deliberately not imported.** The text is CC BY 4.0, but each
 * file's `<graphic>` carries the caption "I.Sicily with the permission of the
 * Assessorato Regionale dei Beni Culturali e dell'Identità Siciliana …; photo
 * J. Prag" — a permission granted to the project, not a licence to anyone who
 * takes the files. Italian cultural-heritage reproduction is regulated
 * separately from copyright (Codice dei beni culturali), so the photograph's
 * status cannot be read off the TEI's licence element. The records link to
 * I.Sicily's own page, where the photograph lives under its own terms. (The
 * image URLs also answer HTTP 200 with an HTML body, the same soft-404 shape
 * `import-pipeline.md` records for vici.org, so a download would not even have
 * proved the bytes were an image.)
 *
 * **What the coordinates are.** Each file's `<origPlace><geo>` is the modern
 * settlement the stone is attributed to (`<placeName type="modern">` with a
 * GeoNames ref), not an excavated findspot: 5,009 of 5,136 records carry one that
 * parses (the rest hold `...`, a museum note, or nothing), and 194 of the
 * coordinates lie outside Sicily's own bounding box (Aeolian islands, Malta,
 * mainland museums) — kept, because the file says so, but shown as an
 * approximate place. Years are traditional counts, negative for BCE, read from
 * `notBefore-custom`/`notAfter-custom` — the file's own machine-readable dating.
 *
 * Source is the repository tarball (9 MB), not 5,000 requests: the
 * `inscriptions/` tree is extracted and the 27 `signacula/` files, which are
 * stamps on objects rather than inscriptions on stone, are left out.
 *
 *   pnpm import:isicily-inscriptions
 *   pnpm import:isicily-inscriptions -- --dry-run
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { DOMParser, type Document, type Element, type Node as XmlNode } from '@xmldom/xmldom'
import postgres from 'postgres'
import * as tar from 'tar'
import { requireDatabaseUrl } from '../../server/database/database-url'
import { refreshAtlasCache } from './atlas-cache'
import { checksumOfSource, guardImport, isDryRun, recordImportRun } from './guard'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'isicily')
const ARCHIVE_PATH = join(CACHE_DIR, 'isicily.tar.gz')
const EXTRACT_DIR = join(CACHE_DIR, 'inscriptions')
const SOURCE_URL = 'https://codeload.github.com/ISicily/ISicily/tar.gz/refs/heads/master'
const SOURCE_ID = 'github:isicily'
const BATCH_SIZE = 200

export interface IsicilyRow {
  isicilyId: string
  title: string
  language: string | null
  inscriptionFunction: string | null
  objectType: string | null
  material: string | null
  dateText: string | null
  notBefore: number | null
  notAfter: number | null
  placeName: string | null
  ancientPlaceName: string | null
  pleiadesId: string | null
  geonamesUrl: string | null
  repository: string | null
  provenance: string | null
  edition: string | null
  translation: string | null
  trismegistosId: string | null
  edcsId: string | null
  edrId: string | null
  licence: 'CC-BY-4.0' | 'CC-BY-NC-4.0'
  sourceUrl: string
  lon: number | null
  lat: number | null
}

// An XML namespace identifier, never requested: it must match the files byte for byte.
// eslint-disable-next-line sonarjs/no-clear-text-protocols
const TEI_NAMESPACE = 'http://www.tei-c.org/ns/1.0'

const elementsByTag = (node: Element | Document, tag: string): Element[] =>
  Array.from(node.getElementsByTagNameNS(TEI_NAMESPACE, tag))

const firstByTag = (node: Element | Document, tag: string): Element | null =>
  elementsByTag(node, tag)[0] ?? null

const attribute = (node: Element | null | undefined, name: string): string | null =>
  node?.getAttribute(name) || null

const squash = (value: string | null | undefined): string | null => {
  const flattened = value?.replace(/\s+/g, ' ').trim()
  return flattened || null
}

const textOf = (node: Element | null | undefined): string | null => squash(node?.textContent)

const limit = (value: string | null, maximum: number): string | null =>
  value === null ? null : value.slice(0, maximum)

/** The only two licences this corpus states; anything else is refused by the caller. */
export const licenceFromUrl = (url: string | null): IsicilyRow['licence'] | null => {
  // Compared without the scheme: the files write both `http://` and `https://`, and the
  // licence is the same either way.
  const target = url
    ?.trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/$/, '')
  if (target === 'creativecommons.org/licenses/by/4.0') return 'CC-BY-4.0'
  if (target === 'creativecommons.org/licenses/by-nc/4.0') return 'CC-BY-NC-4.0'
  return null
}

/** `<geo>37.49, 14.06</geo>` is latitude first, the reverse of GeoJSON. */
export const parseGeo = (raw: string | null): { lon: number; lat: number } | null => {
  const parts = raw?.split(',').map((part) => part.trim())
  if (parts?.length !== 2) return null

  const lat = Number(parts[0])
  const lon = Number(parts[1])
  if (!parts[0] || !parts[1] || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lon, lat }
}

/** `0051` → 51, `-0300` → -300. Null for anything that is not a plain year. */
export const parseCustomYear = (raw: string | null): number | null => {
  if (!raw || !/^-?\d{1,4}$/.test(raw.trim())) return null
  return Number(raw.trim())
}

/** The numeric tail of a Pleiades or GeoNames reference. */
export const trailingNumber = (uri: string | null): string | null => {
  const tail = uri
    ?.replace(/\/$/, '')
    .replace(/\.html$/, '')
    .split('/')
    .pop()
  return tail && /^\d+$/.test(tail) ? tail : null
}

/**
 * The edition as plain text in Leiden convention: one line of the stone per
 * line, `<expan><abbr>man</abbr><ex>ibus</ex></expan>` as `man(ibus)`,
 * `<supplied>` as `[…]`, `<gap>` as `[---]`. Everything else contributes its
 * text. Plain text on purpose: it is rendered as text, never as markup.
 */
export const editionToText = (division: Element): string | null => {
  const lines: string[] = []
  let current = ''

  const flush = (): void => {
    const line = current.replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
    current = ''
  }

  const walk = (node: XmlNode): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      current += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return

    const element = node as Element
    const tag = element.localName

    if (tag === 'lb') {
      flush()
      return
    }
    if (tag === 'expan') {
      const abbreviation = textOf(firstByTag(element, 'abbr')) ?? ''
      const expansion = textOf(firstByTag(element, 'ex'))
      current += expansion ? `${abbreviation}(${expansion})` : abbreviation
      return
    }
    if (tag === 'gap') {
      current += '[---]'
      return
    }
    if (tag === 'supplied') {
      current += `[${squash(element.textContent) ?? ''}]`
      return
    }
    if (tag === 'note' || tag === 'app') return

    Array.from(element.childNodes).forEach(walk)
  }

  Array.from(division.childNodes).forEach(walk)
  flush()
  return lines.length > 0 ? lines.join('\n') : null
}

const divisions = (document: Document, type: string): Element[] =>
  elementsByTag(document, 'div').filter((division) => division.getAttribute('type') === type)

const idnoOfType = (document: Document, type: string): string | null => {
  const idno = elementsByTag(document, 'idno').find((node) => node.getAttribute('type') === type)
  return squash(idno?.textContent)
}

/**
 * Parses one EpiDoc file. Returns the reason for refusing it instead of a row
 * when it cannot be published — a file name that is not an I.Sicily id, a
 * missing title, or a licence this import does not recognise.
 */
export const parseIsicilyXml = (
  xml: string,
  fileName: string,
): { row: IsicilyRow } | { skipped: 'no-id' | 'no-title' | 'unknown-licence' } => {
  const document = new DOMParser({ onError: () => undefined }).parseFromString(xml, 'text/xml')

  // The id is the *file name*, not the file's own `<idno type="filename">`: four
  // files (ISic001733, 002094, 020858, 030302) carry a copy-pasted idno naming a
  // different record, which made the unique key collide on first import. The file
  // name is also what I.Sicily's own `/inscription/<id>` URLs use.
  const isicilyId = /^(ISic\d+)\.xml$/.exec(fileName)?.[1]
  if (!isicilyId) return { skipped: 'no-id' }

  const title = textOf(firstByTag(firstByTag(document, 'titleStmt') ?? document, 'title'))
  if (!title) return { skipped: 'no-title' }

  const licence = licenceFromUrl(attribute(firstByTag(document, 'licence'), 'target'))
  if (!licence) return { skipped: 'unknown-licence' }

  const origPlace = firstByTag(document, 'origPlace')
  const placeNames = origPlace ? elementsByTag(origPlace, 'placeName') : []
  const ancient = placeNames.find((node) => node.getAttribute('type') === 'ancient')
  const modern = placeNames.find((node) => node.getAttribute('type') === 'modern')
  const position = parseGeo(textOf(origPlace ? firstByTag(origPlace, 'geo') : null))

  const origDate = firstByTag(document, 'origDate')
  const whenYear = parseCustomYear(attribute(origDate, 'when-custom'))
  const notBefore = parseCustomYear(attribute(origDate, 'notBefore-custom')) ?? whenYear
  const notAfter = parseCustomYear(attribute(origDate, 'notAfter-custom')) ?? whenYear

  const primary = divisions(document, 'edition').find(
    (division) => division.getAttribute('subtype') === 'primary',
  )
  const english = divisions(document, 'translation').find(
    (division) => (division.getAttribute('xml:lang') ?? '').toLowerCase() === 'en',
  )

  const functionTerm = elementsByTag(document, 'term').find((term) =>
    (term.getAttribute('ana') ?? '').startsWith('#function.'),
  )
  const edrRaw = idnoOfType(document, 'EDR')

  const found = elementsByTag(document, 'provenance').find(
    (node) => node.getAttribute('type') === 'found' && textOf(node),
  )

  return {
    row: {
      isicilyId,
      title,
      language: limit(attribute(firstByTag(document, 'textLang'), 'mainLang'), 8),
      inscriptionFunction: limit(
        (attribute(functionTerm, 'ana') ?? '').replace('#function.', '') || null,
        60,
      ),
      objectType: limit(textOf(firstByTag(document, 'objectType')), 80),
      material: limit(textOf(firstByTag(document, 'material')), 80),
      dateText: textOf(origDate),
      notBefore,
      notAfter,
      placeName: limit(textOf(modern), 160),
      ancientPlaceName: limit(textOf(ancient), 160),
      pleiadesId: limit(trailingNumber(attribute(ancient, 'ref')), 24),
      geonamesUrl: limit(attribute(modern, 'ref'), 300),
      repository: limit(textOf(firstByTag(document, 'repository')), 240),
      provenance: textOf(found),
      edition: primary ? editionToText(primary) : null,
      translation: english ? textOf(english) : null,
      trismegistosId: limit(idnoOfType(document, 'TM'), 24),
      edcsId: limit(idnoOfType(document, 'EDCS'), 24),
      edrId: limit(edrRaw, 24),
      licence,
      sourceUrl: `https://sicily.classics.ox.ac.uk/inscription/${isicilyId}`,
      lon: position?.lon ?? null,
      lat: position?.lat ?? null,
    },
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const downloadArchive = async (): Promise<void> => {
  if (await exists(ARCHIVE_PATH)) {
    console.log('Archive already downloaded, reusing it.')
    return
  }

  process.stdout.write('  ↓ ISicily/ISicily (repository tarball) … ')
  const response = await fetch(SOURCE_URL, {
    headers: { 'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)' },
  })
  if (!response.ok || !response.body) throw new Error(`${SOURCE_URL} answered ${response.status}`)

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(ARCHIVE_PATH),
  )
  const { size } = await stat(ARCHIVE_PATH)
  console.log(`${(size / 1024 / 1024).toFixed(1)} MB`)
}

/** Only `inscriptions/`: `signacula/` holds stamps on objects, not inscriptions on stone. */
const extractInscriptions = async (): Promise<void> => {
  await mkdir(EXTRACT_DIR, { recursive: true })
  await tar.x({
    file: ARCHIVE_PATH,
    cwd: EXTRACT_DIR,
    strip: 2,
    filter: (path) => /^[^/]+\/inscriptions\/ISic\d+\.xml$/.test(path),
  })
}

const insertBatch = async (rows: IsicilyRow[]): Promise<void> => {
  await sql`
    INSERT INTO isicily_inscriptions (
      isicily_id, title, language, inscription_function, object_type, material,
      date_text, not_before, not_after, place_name, ancient_place_name, pleiades_id,
      geonames_url, repository, provenance, edition, translation,
      trismegistos_id, edcs_id, edr_id, licence, source_url, geom
    )
    SELECT
      e->>'isicilyId', e->>'title', e->>'language', e->>'inscriptionFunction',
      e->>'objectType', e->>'material', e->>'dateText',
      (e->>'notBefore')::int, (e->>'notAfter')::int, e->>'placeName',
      e->>'ancientPlaceName', e->>'pleiadesId', e->>'geonamesUrl', e->>'repository',
      e->>'provenance', e->>'edition', e->>'translation',
      e->>'trismegistosId', e->>'edcsId', e->>'edrId', e->>'licence', e->>'sourceUrl',
      CASE WHEN e->>'lon' IS NULL THEN NULL
           ELSE ST_SetSRID(ST_MakePoint((e->>'lon')::double precision, (e->>'lat')::double precision), 4326)
      END
    FROM jsonb_array_elements(${sql.json(rows as unknown as postgres.JSONValue)}) AS e
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Importing I.Sicily — CC BY 4.0 (six records CC BY-NC 4.0), github.com/ISicily.\n')

  await downloadArchive()
  await extractInscriptions()

  const files = (await readdir(EXTRACT_DIR)).filter((name) => name.endsWith('.xml')).sort()
  console.log(`${files.length} EpiDoc files extracted.`)

  const rows: IsicilyRow[] = []
  const skipped: Record<string, number> = {}
  for (const name of files) {
    const result = parseIsicilyXml(await readFile(join(EXTRACT_DIR, name), 'utf8'), name)
    if ('row' in result) rows.push(result.row)
    else skipped[result.skipped] = (skipped[result.skipped] ?? 0) + 1
  }
  console.log(`${rows.length} inscriptions parsed; skipped: ${JSON.stringify(skipped)}.`)

  const checksum = checksumOfSource(await readFile(ARCHIVE_PATH))
  const proceed = await guardImport({
    sql,
    source: SOURCE_ID,
    // Files served, not rows parsed — see the note in `12-edh-inscriptions.ts`.
    rowCount: files.length,
    checksum,
    dryRun: isDryRun(process.argv),
  })
  if (!proceed) {
    await sql.end()
    return
  }

  await sql`TRUNCATE isicily_inscriptions RESTART IDENTITY`
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insertBatch(rows.slice(start, start + BATCH_SIZE))
  }
  await sql`ANALYZE isicily_inscriptions`
  await recordImportRun(sql, { source: SOURCE_ID, rowCount: files.length, checksum })

  const [summary] = await sql<
    { total: number; located: number; translated: number; noncommercial: number }[]
  >`
    SELECT count(*)::int AS total,
           count(geom)::int AS located,
           count(translation)::int AS translated,
           count(*) FILTER (WHERE licence = 'CC-BY-NC-4.0')::int AS noncommercial
    FROM isicily_inscriptions
  `
  console.log(
    `${summary?.total} rows: ${summary?.located} located, ${summary?.translated} with an English translation, ${summary?.noncommercial} CC BY-NC.`,
  )

  await refreshAtlasCache(['reference:isicily:*'])
  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
