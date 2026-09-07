/**
 * The Roman state's extent as a dated series — the data behind the period
 * scrubber on the Barrington sheet.
 *
 * Source: OpenHistoricalMap, via its own Overpass instance. **CC0 1.0**,
 * confirmed by fetching `openhistoricalmap.org/copyright` directly rather
 * than assuming OHM inherits OpenStreetMap's ODbL — it does not, and the
 * difference matters: this is the only borrowed geodata in the atlas that
 * carries no share-alike obligation at all. The page's one carve-out is that
 * individual elements may set `license=*` for CC BY / CC BY-SA content; of
 * the 87 Roman-state boundary relations, exactly two set that tag and both
 * say `CC0-1.0`, so nothing imported here is encumbered.
 *
 * OHM models these as `type=boundary`, `boundary=administrative`,
 * `admin_level=2`, `border_type=empire`, one relation per interval, tagged
 * `start_date`/`end_date`. Four state names cover the Roman sequence:
 *
 *   Res Publica Romana            20 slices  -509 .. -27
 *   Imperium Romanum              19 slices   -27 .. 395
 *   Imperium Romanum Occidentale  12 slices   395 .. 476
 *   Imperium Romanum Orientale    36 slices   395 .. 1453
 *
 * **Cutoff: slices beginning before 476**, the deposition of Romulus
 * Augustulus — the same "end of antiquity" line `13-battles.ts` already
 * draws at year 500, moved to the exact event because here there is an exact
 * event to move it to. That keeps the Eastern empire's first slice (395–476,
 * contemporaneous with the West) and drops the 35 Byzantine slices that
 * follow, which belong to a different atlas than this one. 52 slices import.
 *
 * **Dates are traditional BCE counts, not astronomical ones.** OHM's
 * `-0509` is 509 BCE, not 510 — verified against slices whose historical
 * dates are not in dispute (`-0264..-0241` the First Punic War, `-0146` the
 * fall of Carthage and Corinth, `-0027` the settlement that makes Augustus
 * princeps). This is the opposite of Wikidata's convention, where
 * `13-battles.ts` has to convert; getting it backwards here would shift the
 * entire Republic by a year, so it was checked rather than assumed.
 *
 * Relations are assembled into MultiPolygons with `osmtogeojson` (MIT), not
 * by stitching member ways by hand: the 106–114 CE slice alone has 1,071
 * outer ways and 83,599 coordinates, and ring assembly with islands is
 * exactly the well-solved problem this project's conventions say to borrow
 * rather than rewrite. Each relation also carries an `admin_centre` node
 * (Rome), which converts to a Point feature and is skipped.
 *
 *   pnpm import:empire-extents
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import osmtogeojson from 'osmtogeojson'
import postgres from 'postgres'
import Redis from 'ioredis'

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
  { max: 1 },
)

const CACHE_DIR = join(process.cwd(), '.import', 'ohm')
const OVERPASS_URL = 'https://overpass-api.openhistoricalmap.org/api/interpreter'

/** The deposition of Romulus Augustulus — see the file docstring. */
const ANTIQUITY_END_YEAR = 476

const STATE_NAMES = [
  'Res Publica Romana',
  'Imperium Romanum',
  'Imperium Romanum Occidentale',
  'Imperium Romanum Orientale',
]

/** Relations per Overpass request. Whole-empire boundaries are large — the
 *  geometry for four of them is already tens of megabytes — and OHM is a
 *  small volunteer-run instance, so this stays deliberately modest. */
const RELATIONS_PER_REQUEST = 4

interface OverpassElement {
  type: string
  id: number
  tags?: Record<string, string>
}

interface EmpireSlice {
  ohmRelationId: number
  stateName: string
  startYear: number
  endYear: number
  endEvent: string | null
  geometry: string
}

/**
 * OHM writes dates as ISO-like strings that may carry a month and day
 * (`0476-10-04`, `0641-04`, `-0509`). Only the year is kept: a slice is a
 * span of political control, and the scrubber steps between spans, so a
 * precision the interface never shows would be stored for nothing.
 */
const yearFromOhmDate = (value: string | undefined): number | null => {
  if (!value) return null
  const match = /^(-?)(\d{1,4})/.exec(value.trim())
  if (!match) return null
  const year = Number(match[2])
  if (!Number.isFinite(year)) return null
  return match[1] === '-' ? -year : year
}

const overpass = async (query: string): Promise<{ elements: OverpassElement[] }> => {
  const response = await fetch(OVERPASS_URL, { method: 'POST', body: query })
  if (!response.ok) {
    throw new Error(`Overpass returned ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as { elements: OverpassElement[] }
}

/** Cached because the geometry payload is large and this script is expected
 *  to be re-run while the rest of the pipeline is being worked on. */
const overpassCached = async (query: string, fileName: string): Promise<unknown> => {
  const path = join(CACHE_DIR, fileName)
  const cached = await readFile(path, 'utf8').catch(() => null)
  if (cached) return JSON.parse(cached)

  const data = await overpass(query)
  await writeFile(path, JSON.stringify(data))
  return data
}

/** Every Roman-state boundary relation OHM holds, tags only — cheap enough
 *  to re-request, and it decides which heavy geometry requests follow. */
const fetchSliceIndex = async (): Promise<OverpassElement[]> => {
  const names = STATE_NAMES.join('|')
  const query = `[out:json][timeout:120];
(
  relation["name"~"^(${names})$"]["type"="boundary"];
);
out tags;`

  const { elements } = await overpass(query)
  return elements
}

const inScope = (element: OverpassElement): boolean => {
  const start = yearFromOhmDate(element.tags?.start_date)
  const end = yearFromOhmDate(element.tags?.end_date)
  return start !== null && end !== null && start < ANTIQUITY_END_YEAR
}

/** What `osmtogeojson` actually hands back — its own return type is the
 *  umbrella `GeoJSONObject`, which carries no `features`. */
interface ConvertedFeature {
  geometry: { type: string; coordinates: unknown }
  properties?: { id?: number; tags?: Record<string, string> }
}

/**
 * One converted GeoJSON feature to one row, or null for anything that is not
 * a dated boundary polygon — the `admin_centre` node every relation carries,
 * and (defensively) a relation whose dates do not parse.
 */
const sliceFromFeature = (feature: ConvertedFeature): EmpireSlice | null => {
  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return null

  // osmtogeojson 2.x nests the OSM tags under `properties.tags` and puts the
  // bare numeric id in `properties.id`; the 3.x beta flattens both onto
  // `properties` instead. Pinned to the stable 2.x, so read 2.x's shape —
  // reading the other one yields undefined names and no error.
  const tags = feature.properties?.tags ?? {}
  const relationId = Number(feature.properties?.id)
  const startYear = yearFromOhmDate(tags.start_date)
  const endYear = yearFromOhmDate(tags.end_date)
  if (!Number.isFinite(relationId) || startYear === null || endYear === null) return null

  // A single-ring Polygon and a MultiPolygon both have to land in a
  // MultiPolygon column, so the wrapping happens here rather than in 52
  // round trips through `ST_Multi`.
  const geometry =
    feature.geometry.type === 'MultiPolygon'
      ? feature.geometry
      : { type: 'MultiPolygon', coordinates: [feature.geometry.coordinates] }

  return {
    ohmRelationId: relationId,
    stateName: String(tags.name ?? ''),
    startYear,
    endYear,
    endEvent: tags.end_event ? String(tags.end_event) : null,
    geometry: JSON.stringify(geometry),
  }
}

const fetchSliceGeometry = async (elements: OverpassElement[]): Promise<EmpireSlice[]> => {
  const slices: EmpireSlice[] = []

  for (let start = 0; start < elements.length; start += RELATIONS_PER_REQUEST) {
    const batch = elements.slice(start, start + RELATIONS_PER_REQUEST)
    const ids = batch.map((element) => element.id)
    const query = `[out:json][timeout:180];
rel(id:${ids.join(',')});
out geom;`

    const data = await overpassCached(query, `empire-${ids[0]}.json`)
    const collection = osmtogeojson(data as Parameters<typeof osmtogeojson>[0]) as unknown as {
      features: ConvertedFeature[]
    }

    for (const feature of collection.features) {
      const slice = sliceFromFeature(feature)
      if (slice) slices.push(slice)
    }

    const done = Math.min(start + RELATIONS_PER_REQUEST, elements.length)
    console.log(`  fetched ${done}/${elements.length}`)
  }

  return slices
}

const insertSlices = async (slices: EmpireSlice[]): Promise<void> => {
  for (let start = 0; start < slices.length; start += 10) {
    const batch = slices.slice(start, start + 10)
    await sql`
      INSERT INTO antiquity_empire_extents
        (ohm_relation_id, state_name, start_year, end_year, end_event, geom)
      SELECT
        v.ohm_relation_id::int,
        v.state_name,
        v.start_year::int,
        v.end_year::int,
        v.end_event,
        ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(v.geometry), 4326)))
      FROM unnest(
        ${batch.map((slice) => String(slice.ohmRelationId))}::text[],
        ${batch.map((slice) => slice.stateName)}::text[],
        ${batch.map((slice) => String(slice.startYear))}::text[],
        ${batch.map((slice) => String(slice.endYear))}::text[],
        ${batch.map((slice) => slice.endEvent)}::text[],
        ${batch.map((slice) => slice.geometry)}::text[]
      ) AS v(ohm_relation_id, state_name, start_year, end_year, end_event, geometry)
    `
  }
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('Roman state extents — OpenHistoricalMap (CC0 1.0)\n')

  const index = await fetchSliceIndex()
  const scoped = index.filter(inScope)
  console.log(
    `${index.length} Roman-state boundary relations, ${scoped.length} beginning before ${ANTIQUITY_END_YEAR}.`,
  )

  const slices = await fetchSliceGeometry(scoped)
  slices.sort((a, b) => a.startYear - b.startYear)

  await sql`TRUNCATE antiquity_empire_extents RESTART IDENTITY`
  await insertSlices(slices)
  await sql`ANALYZE antiquity_empire_extents`

  console.log(`\n${slices.length} slices imported.`)
  for (const slice of slices) {
    const span = `${String(slice.startYear).padStart(5)} .. ${String(slice.endYear).padStart(5)}`
    const event = slice.endEvent ? ` — ${slice.endEvent}` : ''
    console.log(`  ${span}  ${slice.stateName}${event}`)
  }

  // Rides the shared atlas generation, like every other antiquity import:
  // this data changes on the same clock as the rest of the sheet, and the
  // reader-facing tiles are already keyed to that counter.
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
    console.warn('Could not bump the atlas cache generation:', error)
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
