/**
 * Imports the Tabula Peutingeriana's places and roads, reconstructed to real
 * coordinates by the OmnesViae project (René Voorburg), from
 * `omnesviae.org/data/omnesviae.json` — a JSON-LD document, not documented
 * anywhere on the site itself. Fetched raw and inspected directly rather than
 * trusting the marketing page, which describes it only as "a high resolution
 * copy of the tabula peutingerina": the real file is 1.4 MB, 6,846 `@graph`
 * entries, two `@type`s.
 *
 * `Place` (3,323 rows) carries a classical `label`, an optional `modern` name
 * and, for 2,574 of them, real `lat`/`lng` — the rest are names the map
 * itself gives no coordinate for (unidentified places, or rivers with no
 * point to plot) and are skipped, the same way this project already drops
 * Pleiades' unlocated rows on the Barrington import.
 *
 * `TravelAction` (3,523 rows) is a `from`/`to` place pair plus a distance in
 * Roman miles, and three flags worth keeping: `isReconstructed` (a gap filled
 * from the Itinerarium Antonini rather than read off the manuscript, 39
 * legs), `overWater` (a sea crossing, 3 legs) and `crossesRiver` (a river's
 * own name, 206 legs — not a boolean). 2,403 legs have both endpoints
 * geolocated; the rest are dropped for the same reason as unlocated places.
 *
 * **This dataset states no licence anywhere** — not in the JSON-LD's
 * `@context`, not on omnesviae.org, not confirmed on its Codeberg repository.
 * Running this import is safe (nothing is served to a visitor by it — see
 * `NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED` in `nuxt.config.ts`), but
 * turning that flag on in a real deployment needs Voorburg's explicit yes
 * first, the same courtesy this project already extends to Åhlfeldt (DARE)
 * and EOX. See CLAUDE.md's "The Tabula Peutingeriana network" section.
 *
 *   pnpm import:tabula-peutingeriana
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import postgres from 'postgres'

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
  { max: 1 },
)

const CACHE_DIR = join(process.cwd(), '.import')
const SOURCE_URL = 'https://omnesviae.org/data/omnesviae.json'
const BATCH_SIZE = 500

const exists = async (path: string): Promise<boolean> =>
  stat(path)
    .then(() => true)
    .catch(() => false)

const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url, {
    headers: { 'user-agent': 'Vestigian/1.0 (+https://vestigian.org; one-time research import)' },
  })
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(target),
  )

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024)} KB`)
  return target
}

interface OmnesViaePlace {
  '@id': string
  '@type': 'Place'
  label: string
  modern?: string
  symbol?: string
  lat?: number
  lng?: number
}

interface OmnesViaeTravelAction {
  '@id': string
  '@type': 'TravelAction'
  from: { '@id': string }[]
  to: { '@id': string }[]
  dist?: number
  isReconstructed?: boolean
  overWater?: boolean
  crossesMountains?: boolean
  crossesRiver?: string
}

type OmnesViaeEntry = OmnesViaePlace | OmnesViaeTravelAction

interface OmnesViaeDocument {
  '@graph': OmnesViaeEntry[]
}

interface PlaceRow {
  sourceId: string
  label: string
  modernName: string | null
  symbol: string | null
  lat: number
  lng: number
}

interface RoadRow {
  sourceId: string
  fromSourceId: string
  toSourceId: string
  distanceRomanMiles: number | null
  isReconstructed: boolean
  overWater: boolean
  crossesMountains: boolean
  crossesRiver: string | null
}

const parsePlaces = (graph: OmnesViaeEntry[]): PlaceRow[] =>
  graph
    .filter((entry): entry is OmnesViaePlace => entry['@type'] === 'Place')
    .filter((place) => typeof place.lat === 'number' && typeof place.lng === 'number')
    .map((place) => ({
      sourceId: place['@id'],
      label: place.label,
      modernName: place.modern ?? null,
      symbol: place.symbol ?? null,
      lat: place.lat!,
      lng: place.lng!,
    }))

/**
 * 6 of 3,523 `@id` values are duplicated in the source itself — two distance
 * readings filed under the same from/to pair, since `@id` is generated from
 * the two place ids and carries no reading-variant suffix. `source_id` is
 * this table's own unique key (for re-import joins), so the pair is
 * deduplicated here, keeping whichever reading actually carries a distance.
 */
const parseRoads = (graph: OmnesViaeEntry[], locatedIds: Set<string>): RoadRow[] => {
  const bySourceId = new Map<string, RoadRow>()

  for (const entry of graph) {
    if (entry['@type'] !== 'TravelAction') continue
    const action = entry
    const fromSourceId = action.from[0]!['@id']
    const toSourceId = action.to[0]!['@id']
    if (!locatedIds.has(fromSourceId) || !locatedIds.has(toSourceId)) continue

    const row: RoadRow = {
      sourceId: action['@id'],
      fromSourceId,
      toSourceId,
      distanceRomanMiles: typeof action.dist === 'number' ? action.dist : null,
      isReconstructed: action.isReconstructed === true,
      overWater: action.overWater === true,
      crossesMountains: action.crossesMountains === true,
      crossesRiver: action.crossesRiver ?? null,
    }

    const existing = bySourceId.get(row.sourceId)
    if (!existing || (existing.distanceRomanMiles === null && row.distanceRomanMiles !== null)) {
      bySourceId.set(row.sourceId, row)
    }
  }

  return [...bySourceId.values()]
}

const insertPlaceBatch = async (rows: PlaceRow[]): Promise<void> => {
  await sql`
    INSERT INTO tabula_peutingeriana_places (source_id, label, modern_name, symbol, geom)
    SELECT v.source_id, v.label, v.modern_name, v.symbol, ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)
    FROM unnest(
      ${rows.map((row) => row.sourceId)}::text[],
      ${rows.map((row) => row.label)}::text[],
      ${rows.map((row) => row.modernName)}::text[],
      ${rows.map((row) => row.symbol)}::text[],
      ${rows.map((row) => row.lat)}::double precision[],
      ${rows.map((row) => row.lng)}::double precision[]
    ) AS v(source_id, label, modern_name, symbol, lat, lng)
    ON CONFLICT (source_id) DO UPDATE SET
      label = EXCLUDED.label,
      modern_name = EXCLUDED.modern_name,
      symbol = EXCLUDED.symbol,
      geom = EXCLUDED.geom
  `
}

/**
 * Roads reference places by `source_id`, resolved to the real primary key
 * inside the query itself — a join, not a second round trip per row.
 */
const insertRoadBatch = async (rows: RoadRow[]): Promise<void> => {
  await sql`
    INSERT INTO tabula_peutingeriana_roads (
      source_id, from_place_id, to_place_id, distance_roman_miles,
      is_reconstructed, over_water, crosses_mountains, crosses_river, geom
    )
    SELECT
      v.source_id, fp.id, tp.id, v.distance_roman_miles,
      v.is_reconstructed, v.over_water, v.crosses_mountains, v.crosses_river,
      ST_MakeLine(fp.geom, tp.geom)
    FROM unnest(
      ${rows.map((row) => row.sourceId)}::text[],
      ${rows.map((row) => row.fromSourceId)}::text[],
      ${rows.map((row) => row.toSourceId)}::text[],
      ${rows.map((row) => row.distanceRomanMiles)}::integer[],
      ${sql.array(rows.map((row) => row.isReconstructed))}::boolean[],
      ${sql.array(rows.map((row) => row.overWater))}::boolean[],
      ${sql.array(rows.map((row) => row.crossesMountains))}::boolean[],
      ${rows.map((row) => row.crossesRiver)}::text[]
    ) AS v(
      source_id, from_source_id, to_source_id, distance_roman_miles,
      is_reconstructed, over_water, crosses_mountains, crosses_river
    )
    JOIN tabula_peutingeriana_places fp ON fp.source_id = v.from_source_id
    JOIN tabula_peutingeriana_places tp ON tp.source_id = v.to_source_id
    ON CONFLICT (source_id) DO UPDATE SET
      from_place_id = EXCLUDED.from_place_id,
      to_place_id = EXCLUDED.to_place_id,
      distance_roman_miles = EXCLUDED.distance_roman_miles,
      is_reconstructed = EXCLUDED.is_reconstructed,
      over_water = EXCLUDED.over_water,
      crosses_mountains = EXCLUDED.crosses_mountains,
      crosses_river = EXCLUDED.crosses_river,
      geom = EXCLUDED.geom
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Importing the Tabula Peutingeriana network — licence unconfirmed, feature-gated.\n')

  const jsonPath = await fetchCached(SOURCE_URL, 'omnesviae.json')
  const doc = JSON.parse(await readFile(jsonPath, 'utf8')) as OmnesViaeDocument
  const graph = doc['@graph']

  const places = parsePlaces(graph)
  const locatedIds = new Set(places.map((place) => place.sourceId))
  const roads = parseRoads(graph, locatedIds)

  console.log(
    `${places.length} geolocated places, ${roads.length} road segments with both ends located.\n`,
  )

  for (let offset = 0; offset < places.length; offset += BATCH_SIZE) {
    const batch = places.slice(offset, offset + BATCH_SIZE)
    await insertPlaceBatch(batch)
    console.log(`· places ${Math.min(offset + BATCH_SIZE, places.length)}/${places.length}`)
  }

  for (let offset = 0; offset < roads.length; offset += BATCH_SIZE) {
    const batch = roads.slice(offset, offset + BATCH_SIZE)
    await insertRoadBatch(batch)
    console.log(`· roads ${Math.min(offset + BATCH_SIZE, roads.length)}/${roads.length}`)
  }

  const [placeCount] = await sql<
    { count: string }[]
  >`SELECT count(*)::text FROM tabula_peutingeriana_places`
  const [roadCount] = await sql<
    { count: string }[]
  >`SELECT count(*)::text FROM tabula_peutingeriana_roads`
  console.log(`\n${placeCount?.count ?? 0} places, ${roadCount?.count ?? 0} roads in the database.`)
  console.log(
    'Nothing is served until NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED=true is set — see CLAUDE.md.',
  )

  await sql.end()
}

await main()
