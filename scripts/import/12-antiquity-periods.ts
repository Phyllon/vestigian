/**
 * The empire's territorial extent at three dates — the "period scrubber" on
 * the Barrington sheet.
 *
 * Source: AWMC's own `Cultural-Data/political_shading/` release —
 * github.com/AWMC/geodata, the same repo and the same `AWMC_RAW` base
 * `05-antiquity-atlas.ts` already fetches from. ODbL 1.0, stated in that
 * repo's own `LICENSE.txt` and `README.md` with no folder-level carve-out.
 *
 * Two secondary mirrors of this same AWMC data found during research —
 * DAI's `iDAI.geoserver` and Project MERCURY — both tag it CC-BY-NC instead.
 * The primary source wins: AWMC's GitHub repo is the one it actively
 * maintains ("the GeoJSONs continue to provide the most up-to-date data"),
 * and its licence statement is unambiguous and covers the whole repo. The
 * secondary tags are stale or simply wrong.
 *
 * `political_shading/` actually ships six Roman-period files. Three are
 * genuinely usable extent polygons; three were downloaded and inspected by
 * hand and turned out to have nothing to import:
 *
 *   roman_empire_bce_60.geojson              74 Polygon fragments — used
 *   roman_empire_ce_117_extent.geojson       112 Polygon fragments — used
 *   roman_empire_ce_200_extent.geojson       112 Polygon fragments — used.
 *                                             The same file `06-limes.ts`
 *                                             fetches transiently to derive
 *                                             the frontier line and
 *                                             explicitly discards ("storing
 *                                             them would put a fourth copy
 *                                             of the empire's outline in a
 *                                             database that already has
 *                                             three"). This script is that
 *                                             fourth copy, deliberately: the
 *                                             reason not to store it was
 *                                             that nothing needed it stored
 *                                             yet, and a genuine multi-period
 *                                             feature is now that reason.
 *   roman_empire_ce_200_provinces.geojson    LineString topology, but its
 *                                             PROVINCE10/PROVINCE_1 fields
 *                                             are opaque ArcInfo polygon
 *                                             adjacency codes (confirmed: 19
 *                                             distinct numeric pairs, no
 *                                             name anywhere in the file or
 *                                             published alongside it) — not
 *                                             imported, nothing to label.
 *   roman_empire_provinces post_diocletian.geojson   96 features, every
 *                                             single one carrying an
 *                                             identical `Id: 0` — checked
 *                                             all 96, not just the first —
 *                                             not imported.
 *   roman_senatorial_provinces.geojson       8 features, same defect (every
 *                                             one `Id: 0`) — not imported.
 *
 * Unlike `06-limes.ts`'s frontier derivation, **no mainland-span filter is
 * applied here.** That filter exists specifically to keep tiny archipelago
 * fragments from corrupting `ST_Boundary` when deriving a frontier *line* —
 * it is not a general defence against bad geometry, and applying it here
 * would drop real Roman territory (Sardinia, Sicily, Cyprus) from a map
 * whose whole point is to draw the empire's actual extent. `ST_MakeValid`
 * is enough, matching how the water import already handles ordinary
 * geometry validity.
 *
 * One row per source polygon fragment, never dissolved into one shape per
 * period — the same convention `antiquity_lines` already uses, letting the
 * map style union them visually per tile rather than the import doing it.
 *
 *   pnpm import:antiquity-periods
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Redis } from 'ioredis'
import postgres from 'postgres'

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
  { max: 1 },
)

const CACHE_DIR = join(process.cwd(), '.import', 'atlas-periods')
const AWMC_RAW = 'https://raw.githubusercontent.com/AWMC/geodata/master'

interface PeriodImport {
  year: number
  label: string
  path: string
}

const PERIOD_IMPORTS: PeriodImport[] = [
  {
    year: -60,
    label: '60 BCE',
    path: 'Cultural-Data/political_shading/roman_empire_bce_60/roman_empire_bce_60.geojson',
  },
  {
    year: 117,
    label: '117 CE',
    path: 'Cultural-Data/political_shading/roman_empire_ce_117_extent/roman_empire_ce_117_extent.geojson',
  },
  {
    year: 200,
    label: '200 CE',
    path: 'Cultural-Data/political_shading/roman_empire_ce_200_extent/roman_empire_ce_200_extent.geojson',
  },
]

interface GeoJsonFeature {
  type: string
  properties: Record<string, unknown> | null
  geometry: { type: string; coordinates: unknown } | null
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

/** Same shape as `05-antiquity-atlas.ts`'s `fetchCached` — kept local rather
 *  than shared, since `scripts/` has no shared-utility module for either
 *  script to import from without pulling in Nitro auto-imports. */
const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  const sink = createWriteStream(target)
  await pipeline(source, sink)

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024)} KB`)
  await wait(250)
  return target
}

const readFeatures = async (path: string): Promise<GeoJsonFeature[]> => {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { features?: GeoJsonFeature[] }
  return (parsed.features ?? []).filter((feature) => feature.geometry !== null)
}

const insertPeriodExtents = async (
  rows: { periodYear: number; geometry: string }[],
): Promise<void> => {
  for (let start = 0; start < rows.length; start += 250) {
    const batch = rows.slice(start, start + 250)
    await sql`
      INSERT INTO antiquity_period_extents (period_year, geom)
      SELECT
        v.period_year::int,
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(v.geometry), 4326))
      FROM unnest(
        ${batch.map((row) => String(row.periodYear))}::text[],
        ${batch.map((row) => row.geometry)}::text[]
      ) AS v(period_year, geometry)
    `
  }
}

const importPeriodExtents = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_period_extents RESTART IDENTITY`
  let total = 0

  for (const period of PERIOD_IMPORTS) {
    const fileName = period.path.split('/').pop()!
    const path = await fetchCached(`${AWMC_RAW}/${period.path}`, fileName)
    const features = await readFeatures(path)

    await insertPeriodExtents(
      features.map((feature) => ({
        periodYear: period.year,
        geometry: JSON.stringify(feature.geometry),
      })),
    )

    console.log(`  ${period.label}: ${features.length} fragments`)
    total += features.length
  }

  return total
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('Antiquity period extents — AWMC political_shading (ODbL 1.0)\n')

  const total = await importPeriodExtents()
  console.log(`\n${total} extent fragments across ${PERIOD_IMPORTS.length} periods.`)

  await sql`ANALYZE antiquity_period_extents`

  // Rides the atlas cache generation, same as `06-limes.ts` — this data
  // changes on the same clock (a rebuild of the antiquity import), not its
  // own, and reader-facing tiles are already keyed to that counter.
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    const stale = await redis.keys('atlas:v*period*')
    if (stale.length > 0) await redis.del(...stale)
    console.log(
      `\nAtlas cache generation is now ${version}; ${stale.length} stale period tiles dropped.`,
    )
  } catch (error) {
    console.warn(
      `\nPeriod extents imported, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous sheet.`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
