/**
 * Attic Inscriptions Online (AIO) — a second, smaller epigraphic corpus,
 * genuinely separate from `12-edh-inscriptions.ts`'s Roman-world EDH mirror
 * rather than an overlapping copy: the sample records checked before
 * writing this were 4th–1st century BC Athenian decrees, well before EDH's
 * own Roman-imperial scope even starts.
 *
 * **AIO's REST API is real but thin — confirmed live, not assumed.**
 * `atticinscriptions.com/api/` serves a genuine Swagger spec with two
 * endpoints: a paginated list (`list_all_inscriptions.json`, confirmed
 * **3,412** records across 35 pages of 100) and a per-record endpoint. But
 * the per-record JSON carries only seven fields — `url`, `aio_key`,
 * `references`, `translation_title`, `translation_epidoc` (the English
 * translation as base64 EpiDoc), `translators`, and a generic
 * `"IPR": "Creative Commons"` string — checked across a dozen records
 * spanning different translators and source volumes, always the same
 * shape, never a Greek edition despite the API description's "Greek text
 * (where present)" claim. The metadata this table actually needs —
 * monument type, inscription type, a parsed date, and critically a
 * **Pleiades URI per findspot** — exists only in each inscription's own
 * rendered HTML page, never in the JSON. This import fetches both per
 * record: the JSON for the clean translation text, the HTML for
 * everything else.
 *
 * **Licence, checked properly rather than trusted from the vague IPR
 * field**: every inscription's HTML page carries a real
 * `<a rel="license" href="http://creativecommons.org/licenses/by-sa/3.0/…">`
 * — CC BY-SA 3.0, confirmed on records from four different translators and
 * source volumes (IG II³ 1, IG II², SEG, Raubitschek), not one sample.
 *
 * **Geometry resolves through the same identifier space the Barrington
 * sheet's own places already live in.** A findspot is given as a Pleiades
 * URI (`https://pleiades.stoa.org/places/579920`); `pleiadesIdFromUri`
 * extracts the trailing numeric id exactly the way `05-antiquity-atlas.ts`
 * already does, joined against `antiquityPlaces.pleiadesId` — confirmed
 * live that both a five-digit and a newer nine-digit sample id already
 * resolve there. No new geocoding scheme, no Trismegistos join.
 *
 * **The translation body is parsed from the rendered HTML, not the raw
 * EpiDoc XML the API returns.** AIO's own markup
 * (`.insline`/`.aio_place`/`.translit`/`.inslineno`) is simpler and more
 * reliable to read than re-deriving the same structure from nested XML —
 * the same "read what the site already renders safely" call already made
 * for the column-relief plate numbers and the AWMC minor-feature codes.
 * Parsed into a flat, typed segment list; never rendered with `v-html`.
 *
 * **Politeness**: one request every `AIO_REQUEST_DELAY_MS` (default 200ms)
 * — `robots.txt` only disallows `_preview/` paths, but ~6,800 requests
 * (JSON + HTML per record) to a small academic site over a fast loop would
 * still be inconsiderate. A full run takes on the order of 25–30 minutes.
 *
 *   pnpm import:attic-inscriptions
 *   IMPORT_LIMIT=50 pnpm import:attic-inscriptions
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cheerio from 'cheerio'
import type { Cheerio, CheerioAPI } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import postgres from 'postgres'
import { refreshAtlasCache } from './atlas-cache'
import type {
  AtticFindspot,
  AtticFootnote,
  AtticImageCredit,
  AtticPlaceRef,
  AtticReference,
  AtticTranslationSegment,
} from '../../server/database/schema'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'attic-inscriptions')
const SITE_ORIGIN = 'https://www.atticinscriptions.com'
const USER_AGENT = 'Vestigian-atlas-import/1.0 (contact: project maintainer)'
const IMPORT_LIMIT = Number(process.env.IMPORT_LIMIT ?? Number.POSITIVE_INFINITY)
const REQUEST_DELAY_MS = Number(process.env.AIO_REQUEST_DELAY_MS ?? 200)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const fetchText = async (url: string): Promise<string> => {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.text()
}

const readCache = async (path: string): Promise<string | null> => {
  if (!existsSync(path)) return null
  return readFile(path, 'utf8')
}

/** Fetches through a local cache file — resumable, and considerate of a
 *  small academic site's bandwidth on a re-run. */
const fetchCached = async (cachePath: string, url: string): Promise<string> => {
  const cached = await readCache(cachePath)
  if (cached !== null) return cached

  const body = await fetchText(url)
  await writeFile(cachePath, body, 'utf8')
  await sleep(REQUEST_DELAY_MS)
  return body
}

interface InscriptionRef {
  aioKey: string
  path: string
}

const fetchAllInscriptionRefs = async (): Promise<InscriptionRef[]> => {
  const refs: InscriptionRef[] = []
  let page = 1

  for (;;) {
    const cachePath = join(CACHE_DIR, `list-page-${page}.json`)
    const body = await fetchCached(
      cachePath,
      `${SITE_ORIGIN}/inscription/list_all_inscriptions.json?page=${page}`,
    )
    const data = JSON.parse(body) as {
      count: number
      next: string | null
      inscriptions: { aio_key: string; url: string }[]
    }

    for (const item of data.inscriptions) {
      // 'www.atticinscriptions.com/inscription/IGII31/292' → 'IGII31/292'
      const path = item.url.replace(/^.*\/inscription\//, '')
      refs.push({ aioKey: item.aio_key, path })
    }

    if (!data.next) break
    page += 1
  }

  return refs
}

/** The last path segment of a Pleiades URI — the same extraction
 *  `05-antiquity-atlas.ts`'s own `pleiadesId` helper applies to AWMC's data,
 *  reused here against a different source that happens to name places the
 *  same way. */
export const pleiadesIdFromUri = (uri: string | null | undefined): string | null => {
  if (!uri) return null
  const id = uri.split('/').findLast(Boolean)
  return id && /^\d+$/.test(id) ? id : null
}

/**
 * AIO's own dating is Athenian archon-year notation ('352/1 BC', a civil
 * year spanning two modern ones) or a plain year ('39/8 BC', '229 AD'),
 * never a structured field — this is a best-effort reduction to a
 * `notBefore`/`notAfter` range for filtering, not a claim of precision the
 * raw `dateText` field doesn't already carry more honestly.
 */
export const parseAtticDate = (
  raw: string | null,
): { notBefore: number | null; notAfter: number | null } => {
  if (!raw) return { notBefore: null, notAfter: null }
  const trimmed = raw.trim()
  const isBc = /BC/i.test(trimmed)

  // The two `\d+` runs cannot overlap or backtrack against each other — the
  // literal `/` between them anchors where the first one must end.
  // eslint-disable-next-line sonarjs/super-linear-regex
  const splitYear = /(\d+)\/(\d+)/.exec(trimmed)
  if (splitYear) {
    const first = Number(splitYear[1])
    // '352/1 BC' is short for '352/351 BC' — the second figure only carries
    // the final digit(s) of the archon year, not a full number of its own.
    const secondDigits = splitYear[2]!.length
    const secondFull =
      Math.floor(first / 10 ** secondDigits) * 10 ** secondDigits + Number(splitYear[2])
    const second = secondFull < first ? secondFull : secondFull - 10 ** secondDigits
    // BC: a smaller magnitude is chronologically *later* (352 BC precedes
    // 351 BC), so the earlier calendar figure (`first`) is `notBefore` only
    // once negated — negating first, not second, is the actual lower bound.
    const [notBefore, notAfter] = isBc ? [-first, -second] : [first, second]
    return { notBefore, notAfter }
  }

  const singleYear = /(\d+)/.exec(trimmed)
  if (singleYear) {
    const year = Number(singleYear[1])
    const value = isBc ? -year : year
    return { notBefore: value, notAfter: value }
  }

  return { notBefore: null, notAfter: null }
}

/** Reads a `.ins_type_info` block's own leading label ("Monument type:",
 *  "Images:", …) — the set of blocks present varies per record, so each is
 *  identified by its own text rather than by position. */
const typeInfoBlocks = ($: CheerioAPI): Cheerio<Element>[] =>
  $('.ins_type_info')
    .toArray()
    .map((el) => $(el as Element))

const blockText = ($block: Cheerio<Element>): string => $block.text().replace(/\s+/g, ' ').trim()

/** Strips a block's own leading label ("Original location:") before
 *  reading its place link — `blockText` alone would carry the label into
 *  what is meant to be just the place's display text. */
const parsePlaceRef = (
  $block: Cheerio<Element>,
  $: CheerioAPI,
  labelPattern: RegExp,
): AtticPlaceRef | null => {
  const link = $block.find('a').first()
  if (link.length === 0) return null
  const href = link.attr('href') ?? null
  const text = blockText($block).replace(labelPattern, '').trim()
  return text ? { text, pleiadesId: pleiadesIdFromUri(href) } : null
}

const parseFindspots = ($: CheerioAPI, blocks: Cheerio<Element>[]): AtticFindspot[] => {
  // Not `startsWith` — a multi-fragment record's block reads
  // "Fragment a - Findspot: Eleusis … Fragment b - Findspot: Eleusis …",
  // with "Findspot:" only ever appearing after a fragment label, never first.
  const block = blocks.find((b) => blockText(b).includes('Findspot:'))
  if (!block) return []

  // A record with fragments from several places repeats "Fragment a -
  // Findspot: Eleusis <a>…</a> (EM 10052) Fragment b - Findspot: …" as one
  // run of text and place links with no element boundary between entries —
  // the place name is a plain text node just *before* its link, not inside
  // it (the link's own content is only an icon span), so this walks the
  // block's child nodes in order rather than just collecting every `<a>`.
  const findspots: AtticFindspot[] = []
  let currentLabel: string | null = null
  let pendingPlaceName: string | null = null

  block.contents().each((_, node) => {
    if (node.type === 'text') {
      const raw = node.data
      const fragmentMatch = /Fragment\s+\S+/i.exec(raw)
      if (fragmentMatch) currentLabel = fragmentMatch[0].trim()
      const findspotMatch = /Findspot:\s*([^(]*)/i.exec(raw)
      if (findspotMatch) pendingPlaceName = (findspotMatch[1] ?? '').trim()
      return
    }
    if (node.type === 'tag' && node.tagName === 'a' && pendingPlaceName !== null) {
      const href = $(node as Element).attr('href') ?? null
      findspots.push({
        text: pendingPlaceName,
        pleiadesId: pleiadesIdFromUri(href),
        label: currentLabel,
      })
      pendingPlaceName = null
    }
  })

  return findspots
}

/** Only ever seen carrying one photo collection per record in the samples
 *  checked while building this — a genuinely mixed-collection block would
 *  have every link credited to the same (wrong) collection name, a known
 *  simplification rather than an attempt at full generality for a shape
 *  not actually observed. */
const parseImageCredits = (blocks: Cheerio<Element>[], $: CheerioAPI): AtticImageCredit[] => {
  const block = blocks.find((b) => blockText(b).startsWith('Images:'))
  if (!block) return []
  const collectionText = blockText(block)
    .replace(/^Images:\s*/, '')
    .split('-')[0]!
    .trim()
  return block
    .find('a')
    .toArray()
    .map((el) => ({ collection: collectionText, url: $(el as Element).attr('href') ?? '' }))
    .filter((credit) => credit.url)
}

const parseFootnotes = ($: CheerioAPI): AtticFootnote[] =>
  $('.ins_notes .note')
    .toArray()
    .map((el) => {
      const $note = $(el)
      const number = Number($note.attr('id')?.replace('note-', ''))
      const noteClone = $note.clone()
      noteClone.find('a').first().remove()
      return {
        number,
        text: noteClone
          .text()
          .replace(/^\s*\]?\s*/, '')
          .trim(),
      }
    })
    .filter((note): note is AtticFootnote => Number.isFinite(note.number) && note.text.length > 0)

/** Walks `#inscription .insline` spans, the source's own per-line
 *  translation markup, into a flat typed segment list — never `v-html`'d,
 *  every segment is a plain object the Vue template branches on. */
const parseTranslationEdition = ($: CheerioAPI): AtticTranslationSegment[] => {
  const segments: AtticTranslationSegment[] = []
  const lines = $('#inscription .insline')

  lines.each((index, lineEl) => {
    if (index > 0) segments.push({ type: 'break' })

    const walk = (node: AnyNode): void => {
      if (node.type === 'text') {
        const text = node.data.replace(/\s+/g, ' ')
        if (text) segments.push({ type: 'text', text })
        return
      }
      if (node.type !== 'tag') return

      const $node = $(node)
      if (node.attribs.class?.includes('inslineno')) {
        segments.push({ type: 'lineNumber', text: $node.text().trim() })
        return
      }
      if (node.attribs.class?.includes('aio_place')) {
        segments.push({
          type: 'place',
          text: $node.text().trim(),
          pleiadesId: pleiadesIdFromUri(node.attribs.href) ?? undefined,
        })
        return
      }
      if (node.attribs.class?.includes('translit')) {
        segments.push({ type: 'gloss', text: $node.text().trim() })
        return
      }
      if (node.tagName === 'sup') {
        const number = Number($node.text().replace(/[[\]]/g, ''))
        if (Number.isFinite(number)) segments.push({ type: 'note', number })
        return
      }

      node.children.forEach(walk)
    }

    lineEl.children.forEach(walk)
  })

  return segments
}

interface ParsedAtticInscription {
  aioKey: string
  title: string
  primarySource: string | null
  dateText: string | null
  notBefore: number | null
  notAfter: number | null
  monumentType: string | null
  inscriptionType: string | null
  translators: string[] | null
  translationEdition: AtticTranslationSegment[] | null
  footnotes: AtticFootnote[] | null
  originalLocation: AtticPlaceRef | null
  findspots: AtticFindspot[] | null
  imageCredits: AtticImageCredit[] | null
  references: AtticReference[] | null
  sourceUrl: string
}

/** AIO's own vocabulary marks an uncertain classification with a trailing
 *  '?' ('Stele?') — checked live against the real corpus, where it
 *  fragmented "Stele" into two facet values for the same underlying type.
 *  Stripped before storage, the same restraint EDH's own
 *  `normaliseVocabTerm` (`12-edh-inscriptions.ts`) already applies to its
 *  German vocabulary terms for the identical reason. */
export const stripUncertainty = (value: string | null): string | null =>
  value ? value.replace(/\?$/, '').trim() || null : null

export const parseAtticHtml = (
  $: CheerioAPI,
  path: string,
): Omit<ParsedAtticInscription, 'aioKey'> => {
  const primarySource = $('#ins_source').text().replace(/\s+/g, ' ').trim() || null
  // Checked live: 93 of a 300-record sample carry a genuinely blank
  // `#ins_title` — a real gap in AIO's own data (an untitled decree
  // fragment still carrying real translation content and a source
  // citation), not a scraping failure. Falls back to the citation at the
  // call site, rather than storing an unusable blank string.
  const title = $('#ins_title').text().trim()
  const dateText = $('#ins_date').text().replace(/Date:/i, '').replace(/\s+/g, ' ').trim() || null
  const { notBefore, notAfter } = parseAtticDate(dateText)

  const blocks = typeInfoBlocks($)
  const monumentBlock = blocks.find((b) => blockText(b).startsWith('Monument type:'))
  const inscriptionTypeBlock = blocks.find((b) => blockText(b).startsWith('Inscription type:'))
  const originalLocationBlock = blocks.find((b) => blockText(b).startsWith('Original location:'))

  const translators = $('.ins_translators')
    .text()
    .replace(/Translation by:\s*/i, '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

  const references: AtticReference[] = $('.ins_alt_source')
    .toArray()
    .map((el) => {
      const $ref = $(el)
      const label = $ref.find('a').first().text().trim() || $ref.text().replace(/\s+/g, ' ').trim()
      const externalLinks = $ref
        .find('a.highlight')
        .toArray()
        .map((a) => $(a).attr('href') ?? '')
        .filter(Boolean)
      return { source: label, reference: label, externalLinks }
    })
    .filter((ref) => ref.source)

  return {
    title,
    primarySource,
    dateText,
    notBefore,
    notAfter,
    monumentType: monumentBlock
      ? stripUncertainty(blockText(monumentBlock).replace(/^Monument type:\s*/, '') || null)
      : null,
    inscriptionType: inscriptionTypeBlock
      ? blockText(inscriptionTypeBlock).replace(/^Inscription type:\s*/, '') || null
      : null,
    translators: translators.length > 0 ? translators : null,
    translationEdition: (() => {
      const segments = parseTranslationEdition($)
      return segments.length > 0 ? segments : null
    })(),
    footnotes: (() => {
      const footnotes = parseFootnotes($)
      return footnotes.length > 0 ? footnotes : null
    })(),
    originalLocation: originalLocationBlock
      ? parsePlaceRef(originalLocationBlock, $, /^Original location:\s*/)
      : null,
    findspots: (() => {
      const findspots = parseFindspots($, blocks)
      return findspots.length > 0 ? findspots : null
    })(),
    imageCredits: (() => {
      const credits = parseImageCredits(blocks, $)
      return credits.length > 0 ? credits : null
    })(),
    references: references.length > 0 ? references : null,
    sourceUrl: `${SITE_ORIGIN}/inscription/${path}`,
  }
}

const parseAtticInscription = async (
  ref: InscriptionRef,
): Promise<ParsedAtticInscription | null> => {
  const safeName = ref.path.replaceAll('/', '_')
  const htmlPath = join(CACHE_DIR, `${safeName}.html`)
  const html = await fetchCached(htmlPath, `${SITE_ORIGIN}/inscription/${ref.path}`)
  const $ = cheerio.load(html)

  if ($('#ins_title').length === 0) return null

  const parsed = parseAtticHtml($, ref.path)
  return {
    aioKey: ref.aioKey,
    ...parsed,
    title: parsed.title || parsed.primarySource || ref.aioKey,
  }
}

const INSERT_COLUMNS = [
  'aio_key',
  'title',
  'primary_source',
  'date_text',
  'not_before',
  'not_after',
  'monument_type',
  'inscription_type',
  'translators',
  'translation_edition',
  'footnotes',
  'original_location',
  'findspots',
  'image_credits',
  'references',
  'source_url',
] as const

const toRow = (record: ParsedAtticInscription) => ({
  aio_key: record.aioKey,
  title: record.title,
  primary_source: record.primarySource,
  date_text: record.dateText,
  not_before: record.notBefore,
  not_after: record.notAfter,
  monument_type: record.monumentType,
  inscription_type: record.inscriptionType,
  translators: record.translators,
  translation_edition: record.translationEdition
    ? sql.json(record.translationEdition as unknown as Parameters<typeof sql.json>[0])
    : null,
  footnotes: record.footnotes
    ? sql.json(record.footnotes as unknown as Parameters<typeof sql.json>[0])
    : null,
  original_location: record.originalLocation
    ? sql.json(record.originalLocation as unknown as Parameters<typeof sql.json>[0])
    : null,
  findspots: record.findspots
    ? sql.json(record.findspots as unknown as Parameters<typeof sql.json>[0])
    : null,
  image_credits: record.imageCredits
    ? sql.json(record.imageCredits as unknown as Parameters<typeof sql.json>[0])
    : null,
  references: record.references
    ? sql.json(record.references as unknown as Parameters<typeof sql.json>[0])
    : null,
  source_url: record.sourceUrl,
})

const insertBatch = async (batch: ParsedAtticInscription[]): Promise<void> => {
  const rows = batch.map(toRow)

  await sql`
    INSERT INTO attic_inscriptions ${sql(rows, ...INSERT_COLUMNS)}
    ON CONFLICT (aio_key) DO UPDATE SET
      title = EXCLUDED.title,
      primary_source = EXCLUDED.primary_source,
      date_text = EXCLUDED.date_text,
      not_before = EXCLUDED.not_before,
      not_after = EXCLUDED.not_after,
      monument_type = EXCLUDED.monument_type,
      inscription_type = EXCLUDED.inscription_type,
      translators = EXCLUDED.translators,
      translation_edition = EXCLUDED.translation_edition,
      footnotes = EXCLUDED.footnotes,
      original_location = EXCLUDED.original_location,
      findspots = EXCLUDED.findspots,
      image_credits = EXCLUDED.image_credits,
      "references" = EXCLUDED."references",
      source_url = EXCLUDED.source_url
  `
}

/** First resolvable findspot's Pleiades id → `antiquityPlaces.geom` — the
 *  same "denormalise once at import" call `12-edh-inscriptions.ts` makes
 *  for its own Trismegistos join. */
const resolveGeometry = async (): Promise<void> => {
  const rows = await sql<{ id: number; lon: number; lat: number }[]>`
    UPDATE attic_inscriptions ai
    SET geom = ST_SetSRID(ST_MakePoint(ST_X(ap.geom), ST_Y(ap.geom)), 4326)
    FROM antiquity_places ap
    WHERE ap.pleiades_id = COALESCE(
      (SELECT f->>'pleiadesId' FROM jsonb_array_elements(ai.findspots) AS f
       WHERE f->>'pleiadesId' IS NOT NULL LIMIT 1),
      ai.original_location->>'pleiadesId'
    )
    AND ai.geom IS NULL
    RETURNING ai.id, ST_X(ai.geom) AS lon, ST_Y(ai.geom) AS lat
  `

  const [count] = await sql<{ count: string }[]>`
    SELECT count(*) FROM attic_inscriptions WHERE geom IS NOT NULL
  `
  console.log(
    `${rows.length} newly resolved; ${count?.count ?? 0} inscriptions now carry a findspot.`,
  )
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Importing Attic Inscriptions Online — CC BY-SA 3.0, atticinscriptions.com.\n')

  console.log('Listing all inscriptions…')
  const refs = (await fetchAllInscriptionRefs()).slice(0, IMPORT_LIMIT)
  console.log(`${refs.length} inscriptions to import.\n`)

  let parsed = 0
  let skipped = 0
  const BATCH_SIZE = 100
  let batch: ParsedAtticInscription[] = []

  for (const ref of refs) {
    let record: ParsedAtticInscription | null
    try {
      record = await parseAtticInscription(ref)
      if (!record) console.warn(`  ~ ${ref.aioKey}: no #ins_title, skipped`)
    } catch (error) {
      record = null
      console.warn(`  ~ ${ref.aioKey}: ${(error as Error).message}, skipped`)
    }
    if (!record) {
      skipped += 1
      continue
    }

    batch.push(record)
    parsed += 1

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch)
      console.log(`· inscriptions ${parsed}/${refs.length}`)
      batch = []
    }
  }
  if (batch.length > 0) await insertBatch(batch)

  console.log(`\n${parsed} inscriptions imported, ${skipped} skipped.`)

  await resolveGeometry()

  await refreshAtlasCache(['attic-inscription:v*'])

  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
