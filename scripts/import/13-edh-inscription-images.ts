/**
 * Imports metadata for the Epigraphic Database Heidelberg's photographs —
 * `image_metadata/**\/*.xml` in the same `epigraphic-database-heidelberg/data`
 * tarball `12-edh-inscriptions.ts` already downloads, CIDOC-CRM RDF, one file
 * per photograph.
 *
 * **No image bytes are ever mirrored by this script — checked exhaustively,
 * not sampled, before writing a line of it.** Every one of the 43,199 real
 * records (one of 43,200 files is empty) names the identical Europeana
 * rights code `rr-f`: fetched Europeana's own page for it directly —
 * "Rights Reserved – Free Access... This digital object is protected by
 * copyright... all other acts of reproduction and communication to the
 * public are subject to the licensing conditions attached to the digital
 * object" — a statement Europeana itself has since retired in favour of
 * "In Copyright". Not CC BY-SA like the text corpus. This import therefore
 * only ever records metadata and a link-out to EDH's own Fotothek page;
 * `isOpenRightsStatement` still runs a real per-record check rather than
 * hardcoding `mirrored: false`, so a future EDH addition under a genuine
 * open licence would be picked up without this file changing — the same
 * discipline `11-column-reliefs.ts` applies to Commons' `Copyrighted` field.
 *
 * The join to `inscriptions` is by EDH id, read from each record's own
 * `P128.carries > E34.Inscription > P1.is_identified_by > E42.Identifier` —
 * present on 26,266 of 43,199 records (61%, checked directly against the
 * extracted corpus). A record with no such id, or one naming an inscription
 * this project never imported (5 EDH files were malformed and skipped by
 * `12-edh-inscriptions.ts`), is skipped: `inscription_id` is `NOT NULL`
 * here, and there is no meaning to a photograph row attached to nothing.
 *
 *   pnpm import:edh-inscription-images
 *   IMPORT_LIMIT=200 pnpm import:edh-inscription-images
 */
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { DOMParser, type Document, type Element } from '@xmldom/xmldom'
import { Redis } from 'ioredis'
import postgres from 'postgres'
import * as tar from 'tar'

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
  { max: 1 },
)

/** Shared with `12-edh-inscriptions.ts` — same tarball, no reason to fetch it twice. */
const CACHE_DIR = join(process.cwd(), '.import', 'edh-inscriptions')
const ARCHIVE_PATH = join(CACHE_DIR, 'data.tar.gz')
const EXTRACT_DIR = join(CACHE_DIR, 'image_metadata')
const SOURCE_URL = 'https://codeload.github.com/epigraphic-database-heidelberg/data/tar.gz/master'

const IMPORT_LIMIT = Number(process.env.IMPORT_LIMIT ?? Number.POSITIVE_INFINITY)

/**
 * Genuinely open licences only — checked against real vocabulary this
 * codebase already normalises elsewhere (`vici-licences.ts`,
 * `COMMONS_LICENCE_ALIASES` in `11-column-reliefs.ts`), not invented for
 * this file. Nothing in the corpus has matched this once, by design: it
 * exists so a real change upstream is caught, not to make one up.
 */
const OPEN_RIGHTS_PATTERN = /creativecommons\.org|public[\s-]?domain|\bcc0\b/i

export const isOpenRightsStatement = (targetUri: string | null, text: string | null): boolean =>
  OPEN_RIGHTS_PATTERN.test(targetUri ?? '') || OPEN_RIGHTS_PATTERN.test(text ?? '')

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

const extractImageMetadata = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  if (existsSync(EXTRACT_DIR)) {
    console.log('Archive already extracted, reusing it.')
    return
  }

  console.log('Extracting image_metadata/ from the tarball…')
  await tar.extract({
    file: ARCHIVE_PATH,
    cwd: CACHE_DIR,
    strip: 1,
    filter: (path) => path.includes('/image_metadata/') && path.endsWith('.xml'),
  })
}

const listXmlFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.xml'))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
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
 * The rights statement's own direct text, not the nested actor/name element
 * it wraps — `<E30.Right>TEXT<P75B.is_possesed_by>...name...</P75B...>` mixes
 * both in one element, and a plain `textContent` read would concatenate the
 * photographer's name onto the end of the rights sentence with no separator.
 */
export const directText = (node: Element | null | undefined): string | null => {
  if (!node) return null
  const parts: string[] = []
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) parts.push(child.nodeValue ?? '')
  }
  const value = parts.join(' ').replace(/\s+/g, ' ').trim()
  return value || null
}

interface ParsedImage {
  edhPhotoId: string
  sourceUrl: string
  rightsStatement: string
  rightsHolder: string | null
  mirrored: boolean
  inscriptionEdhId: string | null
}

export const parseImageXml = (xml: string, fallbackId: string): ParsedImage | null => {
  const doc = new DOMParser({ errorHandler: () => {} }).parseFromString(xml, 'text/xml')

  // Every element in this document carries an explicit `crm:` prefix
  // (`<crm:E30.Right>`, not a default, unprefixed namespace the way the
  // inscription TEI files in `12-edh-inscriptions.ts` are written) —
  // `getElementsByTagName` matches the tag as written, prefix included.
  // Confirmed live: a first version using bare names ('E30.Right') matched
  // nothing at all, silently — every one of a 100-file dry run came back
  // "no rights statement", not an error, since a missing element and an
  // empty one both just read as `null` text.
  const idnos = Array.from(doc.getElementsByTagName('crm:E42.Identifier'))
  const plainIdEl = idnos.find((el) => !attr(el, 'type') && text(el))
  const uriIdEl = idnos.find((el) => attr(el, 'type') === 'URI')
  const edhPhotoId = text(plainIdEl) ?? fallbackId
  const sourceUrl = text(uriIdEl) ?? `https://edh-www.adw.uni-heidelberg.de/edh/foto/${edhPhotoId}`

  const rightEl = firstChildByTag(doc, 'crm:E30.Right')
  const rightsStatement = directText(rightEl)
  if (!rightsStatement) return null

  const actorEl = firstChildByTag(doc, 'crm:E39.Actor')
  const rightsHolder = text(actorEl)

  const inscriptionIdEl = Array.from(doc.getElementsByTagName('crm:E34.Inscription')).at(0)
  const inscriptionEdhId = inscriptionIdEl
    ? text(firstChildByTag(inscriptionIdEl, 'crm:E42.Identifier'))
    : null

  return {
    edhPhotoId,
    sourceUrl,
    rightsStatement,
    rightsHolder,
    mirrored: isOpenRightsStatement(attr(rightEl, 'target'), rightsStatement),
    inscriptionEdhId,
  }
}

type ImageFileOutcome =
  | { kind: 'imported'; row: ParsedImage & { inscriptionId: number }; openLicence: boolean }
  | { kind: 'no-rights-statement' }
  | { kind: 'no-inscription-link' }

/** One file's worth of the decision `main`'s loop otherwise had to make
 *  inline — pulled out so the loop itself stays a plain tally. */
const readImageFile = async (
  file: string,
  inscriptionIdByEdhId: Map<string, number>,
): Promise<ImageFileOutcome> => {
  const fallbackId = file.slice(file.lastIndexOf('/') + 1).replace(/\.xml$/, '')
  const xml = await readFile(file, 'utf8')

  let record: ParsedImage | null
  try {
    record = parseImageXml(xml, fallbackId)
  } catch {
    record = null
  }
  if (!record) return { kind: 'no-rights-statement' }

  const inscriptionId = record.inscriptionEdhId
    ? inscriptionIdByEdhId.get(record.inscriptionEdhId)
    : undefined
  if (!inscriptionId) return { kind: 'no-inscription-link' }

  return { kind: 'imported', row: { ...record, inscriptionId }, openLicence: record.mirrored }
}

const insertBatch = async (batch: (ParsedImage & { inscriptionId: number })[]): Promise<void> => {
  const rows = batch.map((image) => ({
    inscription_id: image.inscriptionId,
    edh_photo_id: image.edhPhotoId,
    rights_statement: image.rightsStatement,
    rights_holder: image.rightsHolder,
    mirrored: image.mirrored,
    storage_key: null,
    source_url: image.sourceUrl,
  }))

  await sql`
    INSERT INTO inscription_images ${sql(
      rows,
      'inscription_id',
      'edh_photo_id',
      'rights_statement',
      'rights_holder',
      'mirrored',
      'storage_key',
      'source_url',
    )}
    ON CONFLICT (edh_photo_id) DO UPDATE SET
      inscription_id = EXCLUDED.inscription_id,
      rights_statement = EXCLUDED.rights_statement,
      rights_holder = EXCLUDED.rights_holder,
      mirrored = EXCLUDED.mirrored,
      source_url = EXCLUDED.source_url
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log(
    'Importing EDH photograph metadata — link-out only, no image bytes are mirrored ' +
      '(every record checked is "Rights Reserved", not an open licence).\n',
  )

  await downloadArchive()
  await extractImageMetadata()

  console.log('Listing extracted files, and every inscription id already imported…')
  const files = (await listXmlFiles(EXTRACT_DIR))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, IMPORT_LIMIT)

  const inscriptionIdByEdhId = new Map<string, number>()
  for (const row of await sql<
    { id: number; edhId: string }[]
  >`SELECT id, edh_id AS "edhId" FROM inscriptions`) {
    inscriptionIdByEdhId.set(row.edhId, row.id)
  }
  console.log(
    `${files.length} photograph files to read, ${inscriptionIdByEdhId.size} known inscriptions.\n`,
  )

  let imported = 0
  let noRightsStatement = 0
  let noInscriptionLink = 0
  let openLicenceFound = 0
  const BATCH_SIZE = 500
  let batch: (ParsedImage & { inscriptionId: number })[] = []

  for (const file of files) {
    const outcome = await readImageFile(file, inscriptionIdByEdhId)

    if (outcome.kind === 'no-rights-statement') {
      noRightsStatement += 1
      continue
    }
    if (outcome.kind === 'no-inscription-link') {
      noInscriptionLink += 1
      continue
    }

    if (outcome.openLicence) openLicenceFound += 1
    batch.push(outcome.row)
    imported += 1

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch)
      console.log(`· inscription_images ${imported}`)
      batch = []
    }
  }
  if (batch.length > 0) await insertBatch(batch)

  console.log(
    `\n${imported} photograph records imported (linked to a known inscription). ` +
      `${noInscriptionLink} had no usable inscription link, ${noRightsStatement} carried no rights statement at all.`,
  )
  console.log(
    openLicenceFound > 0
      ? `${openLicenceFound} record(s) carried a genuinely open rights statement — review before deciding whether to mirror bytes for them.`
      : 'No record carried an open rights statement, as expected — nothing was mirrored, every row links out to EDH instead.',
  )

  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })
  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    console.log(`\nAtlas cache generation is now ${version}.`)
  } catch (error) {
    console.warn(
      `\nImages imported, but the cache generation could not be bumped (${(error as Error).message}).`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
