/**
 * The Atlas of Hillforts of Britain and Ireland — Ian Ralston and Gary Lock, with
 * the Universities of Oxford, Edinburgh and University College Cork. 4,147 enclosed
 * hilltop and promontory sites in England, Scotland, Wales, Northern Ireland, the
 * Republic of Ireland and the Isle of Man.
 *
 * **Licence, read from the source:** the Archaeology Data Service record
 * (doi:10.5284/1118744, "Spreadsheets and a Document on the Atlas of Hillforts of
 * Britain and Ireland", Ralston & Lock 2024) states "This work is licensed under a
 * Creative Commons Attribution 4.0 International License" (fetched 4 Oct 2026). The
 * ADS's separate "Hillforts Primer" analysis record is CC BY-SA 4.0 — that is a
 * different dataset and is not used here.
 *
 * **Why a Roman atlas wants it.** The atlas says of itself that it "is not an Atlas of
 * 'Iron Age Hillforts'": 192 of its sites carry dating evidence for AD 50–400, 87 for
 * AD 400–800, and many more were reoccupied under Rome. It is the other half of the
 * frontier — the native settlement pattern the Roman army met in Britain.
 *
 * **Source and access.** The five CSVs are public downloads on the ADS
 * (`/catalogue/adsdata/arch-6508-1/dissemination/*.csv`), and only the 15 MB main table
 * is used. The ADS answers an honest User-Agent; the atlas's own site
 * (`hillforts.arch.ox.ac.uk`) timed out from here, so nothing links to it.
 *
 * **What is read.** 4,147 rows, 4,147 distinct atlas numbers, every row with WGS 84
 * `Longitude`/`Latitude` (checked: none missing, none outside the British Isles), the
 * atlas's `Reliability of Data` (3,669 confirmed, 436 unconfirmed, 42 with irreconciled
 * issues), its seven hillfort-type flags, its seven dated-period flags (the eighth,
 * "Unknown", is the absence of one and is not stored), total enclosed area in hectares
 * (340 blank) and altitude (32 blank). The atlas's own OSGB36 and IRENET95 grid
 * references are ignored in favour of its WGS 84 columns. The long free-text fields are
 * not kept — see the table's docstring.
 *
 *   pnpm import:hillforts-atlas
 *   pnpm import:hillforts-atlas -- --dry-run
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'
import { refreshAtlasCache } from './atlas-cache'
import { checksumOfSource, guardImport, isDryRun, recordImportRun } from './guard'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'hillforts')
const SOURCE_URL =
  'https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-6508-1/dissemination/Hillfort-atlas-main-table.csv'
const SOURCE_ID = 'ads:atlas-of-hillforts:1118744'
const BATCH_SIZE = 500

export type HillfortReliability = 'confirmed' | 'unconfirmed' | 'irreconciled'

/** The atlas's yes/no type columns, in the order they are listed in its data dictionary. */
export const TYPE_COLUMNS: Readonly<Record<string, string>> = {
  'Hillfort Type: Contour Fort': 'contour',
  'Hillfort Type: Partial Contour Fort': 'partial-contour',
  'Hillfort Type: Promontory Fort': 'promontory',
  'Hillfort Type: Hillslope Fort': 'hillslope',
  'Hillfort Type: Level Terrain Fort': 'level-terrain',
  'Hillfort Type: Marsh Fort': 'marsh',
  'Hillfort Type: Multiple Enclosure': 'multiple-enclosure',
}

/**
 * The dated-period flags. The key carries the span, so the interface formats it with the
 * same BC/AD helper everything else uses and needs no translated period names.
 */
export const PERIOD_COLUMNS: Readonly<Record<string, string>> = {
  'Dating Evidence: Pre 1200BC': 'pre-1200bc',
  'Dating Evidence: 1200BC - 800BC': '1200-800bc',
  'Dating Evidence: 800BC - 400BC': '800-400bc',
  'Dating Evidence: 400BC - AD50': '400bc-ad50',
  'Dating Evidence: AD50 - AD400': 'ad50-400',
  'Dating Evidence: AD400 - AD800': 'ad400-800',
  'Dating Evidence: Post AD800': 'post-ad800',
}

export interface HillfortRow {
  atlasNumber: string
  name: string
  country: string
  reliability: HillfortReliability
  types: string[]
  datedPeriods: string[]
  areaHectares: number | null
  altitudeMetres: number | null
  lon: number
  lat: number
}

export type HillfortRecord = Record<string, string>

/** An unfamiliar value is a changed vocabulary, not something to file under a default. */
export const reliabilityOf = (value: string): HillfortReliability => {
  const normalised = value.trim().toLowerCase()
  if (normalised === 'confirmed') return 'confirmed'
  if (normalised === 'unconfirmed') return 'unconfirmed'
  if (normalised === 'irreconciled issues') return 'irreconciled'
  throw new Error(`Unknown Atlas of Hillforts reliability: ${JSON.stringify(value)}`)
}

const keysSetIn = (record: HillfortRecord, columns: Readonly<Record<string, string>>): string[] =>
  Object.entries(columns).flatMap(([column, key]) => (record[column] === 'Yes' ? [key] : []))

/** Blank is "not recorded", which is not zero: it becomes null. */
export const numberOrNull = (value: string | undefined): number | null => {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Null for a row that cannot be placed or named — never repaired. */
export const parseHillfortRecord = (record: HillfortRecord): HillfortRow | null => {
  const atlasNumber = record['Atlas Number']?.trim()
  const name = record['Display Name']?.trim()
  const lon = numberOrNull(record['Longitude'])
  const lat = numberOrNull(record['Latitude'])

  if (!atlasNumber || !name || lon === null || lat === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null

  return {
    atlasNumber,
    name: name.slice(0, 240),
    country: (record['Country'] ?? '').trim().slice(0, 40),
    reliability: reliabilityOf(record['Reliability of Data'] ?? ''),
    types: keysSetIn(record, TYPE_COLUMNS),
    datedPeriods: keysSetIn(record, PERIOD_COLUMNS),
    areaHectares: numberOrNull(record['Total Enclosed Area (ha)']),
    altitudeMetres: (() => {
      const altitude = numberOrNull(record['Altitude (m)'])
      return altitude === null ? null : Math.round(altitude)
    })(),
    lon,
    lat,
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

const downloadTable = async (path: string): Promise<void> => {
  if (await exists(path)) return

  process.stdout.write('  ↓ Hillfort-atlas-main-table.csv … ')
  const response = await fetch(SOURCE_URL, {
    headers: { 'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)' },
  })
  if (!response.ok || !response.body) throw new Error(`${SOURCE_URL} answered ${response.status}`)

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path),
  )
  const { size } = await stat(path)
  console.log(`${(size / 1024 / 1024).toFixed(1)} MB`)
}

const insertBatch = async (rows: HillfortRow[]): Promise<void> => {
  await sql`
    INSERT INTO antiquity_hillforts
      (atlas_number, name, country, reliability, types, dated_periods, area_hectares, altitude_metres, geom)
    SELECT
      e->>'atlasNumber', e->>'name', e->>'country', (e->>'reliability')::hillfort_reliability,
      ARRAY(SELECT jsonb_array_elements_text(e->'types')),
      ARRAY(SELECT jsonb_array_elements_text(e->'datedPeriods')),
      (e->>'areaHectares')::numeric, (e->>'altitudeMetres')::int,
      ST_SetSRID(ST_MakePoint((e->>'lon')::double precision, (e->>'lat')::double precision), 4326)
    FROM jsonb_array_elements(${sql.json(rows as unknown as postgres.JSONValue)}) AS e
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Atlas of Hillforts of Britain and Ireland — CC BY 4.0, Archaeology Data Service.\n')

  const path = join(CACHE_DIR, 'Hillfort-atlas-main-table.csv')
  await downloadTable(path)

  const raw = await readFile(path)
  const records = parse(raw.toString('utf8').replace(/^\uFEFF/, ''), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as HillfortRecord[]

  const rows = records.flatMap((record) => parseHillfortRecord(record) ?? [])
  const skipped = records.length - rows.length
  console.log(`${rows.length} hillforts parsed from ${records.length} rows (${skipped} skipped).`)

  const proceed = await guardImport({
    sql,
    source: SOURCE_ID,
    // Rows served, not rows kept — see the note in `12-edh-inscriptions.ts`.
    rowCount: records.length,
    checksum: checksumOfSource(raw),
    dryRun: isDryRun(process.argv),
  })
  if (!proceed) {
    await sql.end()
    return
  }

  await sql`TRUNCATE antiquity_hillforts RESTART IDENTITY`
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insertBatch(rows.slice(start, start + BATCH_SIZE))
  }
  await sql`ANALYZE antiquity_hillforts`
  await recordImportRun(sql, {
    source: SOURCE_ID,
    rowCount: records.length,
    checksum: checksumOfSource(raw),
  })

  const [summary] = await sql<{ total: number; confirmed: number; roman: number; sized: number }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE reliability = 'confirmed')::int AS confirmed,
           count(*) FILTER (WHERE 'ad50-400' = ANY(dated_periods))::int AS roman,
           count(area_hectares)::int AS sized
    FROM antiquity_hillforts
  `
  console.log(
    `${summary?.total} rows: ${summary?.confirmed} confirmed, ${summary?.roman} with AD 50–400 evidence, ${summary?.sized} with an enclosed area.`,
  )

  await refreshAtlasCache(['reference:hillforts:*'])
  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
