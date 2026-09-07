/**
 * Ancient ports and harbours worldwide, from Arthur de Graauw's Catalogue
 * of Ancient Ports.
 *
 * Source: `ancientportsantiques.com`, licensed CC BY 4.0 (stated in the
 * page footer, linking the real Creative Commons legal text). The
 * catalogue's own Read me sheet adds a second citation that has to travel
 * alongside the CC BY credit: "de Graauw, A. et al. 2014. 'Geodatabase of
 * Ancient Ports and Harbors,' DARMC Scholarly Data Series, Harvard
 * University" — the same data, also deposited there.
 *
 * The actual workbook, not just the page, was downloaded and inspected
 * before this import was written:
 * `.../wp-content/uploads/Documents/GE/AncientPorts.xlsx`, sheet `PLACES`,
 * 6,007 data rows, all carrying coordinates — a row missing either is
 * skipped rather than defaulted to 0/0, in case a future edition of the
 * workbook adds one. `NB` is the workbook's own row id, kept as text since
 * it is sometimes fractional (Excel's own sub-numbering for related
 * entries, e.g. "1.1"). `FOUNDATION` is imported as free text, never
 * parsed into a year: the source mixes single years, BCE ranges like
 * "-10000 to -5000", and blanks, and coercing that into a number would
 * misrepresent the ranges as false precision.
 *
 * `NAME_MOD` does double duty in the source — a modern place name when an
 * ancient `NAME` exists, or the only descriptive text there is when it
 * doesn't (e.g. "Alta, BA rock carvings showing many ships" for a Bronze
 * Age Norwegian site with no ancient name recorded). `title` therefore
 * reads `NAME || NAME_MOD`, and `modernName` is only populated when both
 * columns are present and differ — never duplicating the title back into
 * itself.
 *
 * Roughly 30 more single/two-letter flag columns exist in the source
 * (period flags, feature-type codes decoded on the workbook's own "Key to
 * codes" sheet) and are deliberately not imported here — real data, left
 * in the workbook for a future pass to add, not silently discarded from
 * anywhere that isn't fully reproducible.
 *
 *   pnpm import:ports
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Redis } from 'ioredis'
import postgres from 'postgres'
import { read, utils } from 'xlsx'

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
  { max: 1 },
)

const CACHE_DIR = join(process.cwd(), '.import', 'ports')
const WORKBOOK_URL =
  'https://www.ancientportsantiques.com/wp-content/uploads/Documents/GE/AncientPorts.xlsx'

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Same shape as `13-battles.ts`'s `fetchCached` — kept local for the same
 *  reason: `scripts/` has no shared-utility module either script can
 *  import from without pulling in Nitro auto-imports. */
const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url, {
    headers: { 'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)' },
  })
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  const sink = createWriteStream(target)
  await pipeline(source, sink)

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024)} KB`)
  return target
}

interface PortRow {
  sourceRowId: string
  title: string
  modernName: string | null
  country: string | null
  foundation: string | null
  pleiadesUrl: string | null
  wikipediaUrl: string | null
  lat: number
  lon: number
}

type CellValue = string | number | boolean | Date | null

const cell = (row: CellValue[], index: number): string | null => {
  const value = row[index]
  if (value === undefined || value === null || value === '') return null
  return String(value).trim()
}

/**
 * Reads the `PLACES` sheet as raw rows (`header: 1`) and resolves columns
 * by the header row's own text rather than a hardcoded index — the sheet's
 * column order is real data pulled from a spreadsheet someone else
 * maintains, not something this import controls.
 */
const parsePlacesSheet = (buffer: Buffer): PortRow[] => {
  const workbook = read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets.PLACES
  if (!sheet) throw new Error('AncientPorts.xlsx has no PLACES sheet')

  const rows = utils.sheet_to_json<CellValue[]>(sheet, { header: 1, defval: null })
  const header = rows[0]?.map((value) => String(value ?? '').trim()) ?? []
  const columnIndex = (name: string): number => {
    const index = header.indexOf(name)
    if (index === -1) throw new Error(`AncientPorts.xlsx PLACES sheet has no "${name}" column`)
    return index
  }

  const indices = {
    nb: columnIndex('NB'),
    name: columnIndex('NAME'),
    nameMod: columnIndex('NAME_MOD'),
    country: columnIndex('COUNTRY'),
    latitude: columnIndex('LATITUDE'),
    longitude: columnIndex('LONGITUDE'),
    foundation: columnIndex('FOUNDATION'),
    pleiades: columnIndex('PLEIADES'),
    wikipedia: columnIndex('WIKIPEDIA'),
  }

  const result: PortRow[] = []
  for (const row of rows.slice(1)) {
    const lat = cell(row, indices.latitude)
    const lon = cell(row, indices.longitude)
    if (lat === null || lon === null) continue

    const name = cell(row, indices.name)
    const nameMod = cell(row, indices.nameMod)

    result.push({
      sourceRowId: cell(row, indices.nb) ?? String(result.length + 1),
      title: name ?? nameMod ?? 'Untitled port',
      modernName: name && nameMod && name !== nameMod ? nameMod : null,
      country: cell(row, indices.country),
      foundation: cell(row, indices.foundation),
      pleiadesUrl: cell(row, indices.pleiades),
      wikipediaUrl: cell(row, indices.wikipedia),
      lat: Number(lat),
      lon: Number(lon),
    })
  }
  return result
}

const insertPorts = async (rows: PortRow[]): Promise<void> => {
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500)
    await sql`
      INSERT INTO antiquity_ports
        (source_row_id, title, modern_name, country, foundation, pleiades_url, wikipedia_url, geom)
      SELECT
        v.source_row_id, v.title, v.modern_name, v.country, v.foundation, v.pleiades_url,
        v.wikipedia_url,
        ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
      FROM unnest(
        ${batch.map((row) => row.sourceRowId)}::text[],
        ${batch.map((row) => row.title)}::text[],
        ${batch.map((row) => row.modernName)}::text[],
        ${batch.map((row) => row.country)}::text[],
        ${batch.map((row) => row.foundation)}::text[],
        ${batch.map((row) => row.pleiadesUrl)}::text[],
        ${batch.map((row) => row.wikipediaUrl)}::text[],
        ${batch.map((row) => String(row.lon))}::text[],
        ${batch.map((row) => String(row.lat))}::text[]
      ) AS v(
        source_row_id, title, modern_name, country, foundation, pleiades_url, wikipedia_url,
        lon, lat
      )
      ON CONFLICT (source_row_id) DO NOTHING
    `
  }
}

const importPorts = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_ports RESTART IDENTITY`

  const path = await fetchCached(WORKBOOK_URL, 'AncientPorts.xlsx')
  const rows = parsePlacesSheet(await readFile(path))

  await insertPorts(rows)
  return rows.length
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('Ancient ports — Catalogue of Ancient Ports, Arthur de Graauw (CC BY 4.0)\n')

  const total = await importPorts()
  console.log(`${total} ports imported.`)

  await sql`ANALYZE antiquity_ports`

  // Rides the atlas cache generation, same as every other antiquity_* import.
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    const stale = await redis.keys('port:v*')
    if (stale.length > 0) await redis.del(...stale)
    console.log(
      `\nAtlas cache generation is now ${version}; ${stale.length} stale port tiles dropped.`,
    )
  } catch (error) {
    console.warn(
      `\nPorts imported, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous sheet.`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
