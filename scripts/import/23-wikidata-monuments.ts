/**
 * Roman-period monuments from Wikidata — theatres, amphitheatres, villas,
 * aqueducts, bridges, temples, forts, baths, fora and mithraea.
 *
 * **Licence:** Wikidata's structured data is CC0 1.0 — "Wikidata requires a CC0
 * license" (wikidata.org/wiki/Wikidata:Licensing, fetched 3 Oct 2026), the same
 * licence `13-battles.ts` already relies on. No attribution is owed, though the
 * map credits Wikidata anyway.
 *
 * **Which items.** One row per Wikidata item that has a coordinate and whose
 * `instance of` (P31) is *exactly* one of ten classes. The class ids were found
 * with `wbsearchentities`, not remembered: Roman theatre Q19757, Roman
 * amphitheatre Q7362268, Roman villa Q918230, Roman aqueduct Q13218676, Roman
 * bridge Q1223230, Roman temple Q867143, castrum Q88205, thermae Q6581615,
 * forum Q1062780, mithraeum Q1151014. Exact classes only: walking subclasses
 * (`P31/P279?`) was tried against the public endpoint and timed out after 60 s,
 * while the exact set answers in seconds. The cost is items typed with a more
 * specific subclass; the gain is a query that finishes. One query per class
 * keeps each one small enough to finish at all.
 *
 * **A coordinate is not always a coordinate.** A first count of the exact
 * classes said ~6,060 items "with coordinates". 2,563 of the 3,445 Roman-villa
 * rows are Wikidata's *unknown value* for P625 — the property is present but
 * holds a blank node (`.well-known/genid/…`), not a point — so the query counts
 * them and the parser rightly discards them. What is imported is the **3,440**
 * items with a real WKT point, which is the number to quote.
 *
 * An item that is an instance of more than one of these classes is filed under
 * the first in the list above — an order chosen so the more specific building
 * wins over the more generic one.
 *
 * Wikidata coordinates are WGS 84 and arrive as WKT, `Point(lon lat)` —
 * longitude first, the opposite of how most people write them, which is why
 * the parse is a tested function rather than an inline split.
 *
 * Not the Roman state's own places (those are Pleiades, already imported) and
 * not contributed records: this layer sits in its own table, drawn as its own
 * overlay, never joined to `sites`.
 *
 *   pnpm import:wikidata-monuments
 *   pnpm import:wikidata-monuments -- --dry-run
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'
import { refreshAtlasCache } from './atlas-cache'
import { checksumOfSource, guardImport, isDryRun, recordImportRun } from './guard'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'wikidata-monuments')
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'
const SOURCE_ID = 'wikidata:roman-monuments'
const BATCH_SIZE = 500

/**
 * West, south, east, north of the Roman world and its edges. Wikidata's "forum"
 * class includes the Portuguese-language *fórum*, a courthouse, and a bath in
 * Ethiopia turned up under "thermae": a live run put three items outside this
 * box (Brazil, Ethiopia, Iran), all wrong for an atlas of the Roman world.
 */
export const ROMAN_WORLD_BOUNDS = { west: -15, south: 20, east: 50, north: 62 } as const

export const isInRomanWorld = (point: { lon: number; lat: number }): boolean =>
  point.lon >= ROMAN_WORLD_BOUNDS.west &&
  point.lon <= ROMAN_WORLD_BOUNDS.east &&
  point.lat >= ROMAN_WORLD_BOUNDS.south &&
  point.lat <= ROMAN_WORLD_BOUNDS.north

export type MonumentKind =
  | 'theatre'
  | 'amphitheatre'
  | 'villa'
  | 'aqueduct'
  | 'bridge'
  | 'temple'
  | 'fort'
  | 'bath'
  | 'forum'
  | 'mithraeum'

/** In priority order: an item typed as several is filed under the first. */
export const MONUMENT_CLASSES: readonly { kind: MonumentKind; classId: string }[] = [
  { kind: 'amphitheatre', classId: 'Q7362268' },
  { kind: 'theatre', classId: 'Q19757' },
  { kind: 'aqueduct', classId: 'Q13218676' },
  { kind: 'bridge', classId: 'Q1223230' },
  { kind: 'mithraeum', classId: 'Q1151014' },
  { kind: 'temple', classId: 'Q867143' },
  { kind: 'bath', classId: 'Q6581615' },
  { kind: 'forum', classId: 'Q1062780' },
  { kind: 'fort', classId: 'Q88205' },
  { kind: 'villa', classId: 'Q918230' },
]

const monumentQuery = (classId: string): string => `
  SELECT ?item ?itemLabel ?coord WHERE {
    ?item wdt:P31 wd:${classId} ; wdt:P625 ?coord .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,de,fr,es,it,nl,pt,ca". }
  }
`

export interface MonumentBinding {
  item: { value: string }
  itemLabel?: { value: string }
  coord: { value: string }
}

export interface MonumentRow {
  wikidataId: string
  name: string
  kind: MonumentKind
  lon: number
  lat: number
}

/** `Point(6.9603 50.9375)` → longitude first, latitude second. Null for anything else. */
export const parsePointWkt = (wkt: string): { lon: number; lat: number } | null => {
  const match = /^Point\(([^\s()]+)\s+([^\s()]+)\)$/i.exec(wkt.trim())
  if (!match) return null

  const lon = Number(match[1])
  const lat = Number(match[2])
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lon, lat }
}

/** The `Q123` out of `http://www.wikidata.org/entity/Q123`. */
export const wikidataIdFrom = (uri: string): string | null => /\/(Q\d+)$/.exec(uri)?.[1] ?? null

/**
 * Folds bindings into one row per item. A binding whose label is just the item
 * id (Wikidata's fallback when no label exists in any requested language) is
 * dropped: "Q123456" is not a name a reader can use, and inventing one would be
 * worse than leaving the monument off.
 */
export const parseMonumentBindings = (
  bindings: readonly MonumentBinding[],
  kind: MonumentKind,
  existing: Map<string, MonumentRow>,
): void => {
  for (const binding of bindings) {
    const wikidataId = wikidataIdFrom(binding.item.value)
    const name = binding.itemLabel?.value.trim()
    const point = parsePointWkt(binding.coord.value)
    if (!wikidataId || !name || !point || !isInRomanWorld(point)) continue
    if (name === wikidataId || /^Q\d+$/.test(name)) continue
    if (existing.has(wikidataId)) continue

    existing.set(wikidataId, { wikidataId, name: name.slice(0, 240), kind, ...point })
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const fetchClass = async (classId: string): Promise<string> => {
  const target = join(CACHE_DIR, `${classId}.json`)
  if (await exists(target)) return readFile(target, 'utf8')

  process.stdout.write(`  ↓ ${classId} … `)
  const url = new URL(SPARQL_ENDPOINT)
  url.searchParams.set('query', monumentQuery(classId))
  // Wikimedia's User-Agent policy refuses anonymous-looking clients with a 403.
  const response = await fetch(url, {
    headers: {
      accept: 'application/sparql-results+json',
      'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)',
    },
  })
  if (!response.ok) throw new Error(`Wikidata answered ${response.status} for ${classId}`)

  const body = await response.text()
  await writeFile(target, body)
  console.log(`${Math.round(body.length / 1024)} KB`)
  await wait(2000)
  return body
}

const insertBatch = async (rows: MonumentRow[]): Promise<void> => {
  await sql`
    INSERT INTO antiquity_monuments (wikidata_id, name, kind, geom)
    SELECT
      v.wikidata_id, v.name, v.kind::antiquity_monument_kind,
      ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
    FROM unnest(
      ${rows.map((row) => row.wikidataId)}::text[],
      ${rows.map((row) => row.name)}::text[],
      ${rows.map((row) => row.kind)}::text[],
      ${rows.map((row) => String(row.lon))}::text[],
      ${rows.map((row) => String(row.lat))}::text[]
    ) AS v(wikidata_id, name, kind, lon, lat)
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Wikidata Roman monuments — CC0 1.0.\n')

  const rows = new Map<string, MonumentRow>()
  const hash: string[] = []

  for (const { kind, classId } of MONUMENT_CLASSES) {
    const body = await fetchClass(classId)
    hash.push(body)
    const parsed = JSON.parse(body) as { results: { bindings: MonumentBinding[] } }
    const before = rows.size
    parseMonumentBindings(parsed.results.bindings, kind, rows)
    console.log(`    ${kind}: ${rows.size - before} of ${parsed.results.bindings.length} rows kept`)
  }

  const monuments = [...rows.values()]
  console.log(`${monuments.length} monuments parsed.`)

  const checksum = checksumOfSource(hash.join('\n'))
  const proceed = await guardImport({
    sql,
    source: SOURCE_ID,
    rowCount: monuments.length,
    checksum,
    dryRun: isDryRun(process.argv),
  })
  if (!proceed) {
    await sql.end()
    return
  }

  await sql`TRUNCATE antiquity_monuments RESTART IDENTITY`
  for (let start = 0; start < monuments.length; start += BATCH_SIZE) {
    await insertBatch(monuments.slice(start, start + BATCH_SIZE))
  }

  await sql`ANALYZE antiquity_monuments`
  await recordImportRun(sql, { source: SOURCE_ID, rowCount: monuments.length, checksum })

  const kinds = await sql<{ kind: string; count: number }[]>`
    SELECT kind::text, count(*)::int AS count FROM antiquity_monuments GROUP BY 1 ORDER BY 2 DESC
  `
  console.log(kinds.map((row) => `${row.kind} ${row.count}`).join(', '))

  await refreshAtlasCache(['reference:monuments:*'])
  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
