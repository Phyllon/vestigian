/**
 * Builds the frontier: the named sectors of the limes, the stretches that make
 * them up, and nothing else.
 *
 * ## Where the line comes from
 *
 * There is no open dataset of "the limes" as a followable line. There is a
 * dataset of where the empire ended, and that is the same thing: AWMC publishes
 * the extent of the empire at 200 CE as polygons, ODbL 1.0, in the same
 * repository this project already reads for coastline and roads. The boundary
 * of that polygon, minus the sea, is the land frontier.
 *
 * Measured against the real data rather than assumed: over Europe and the
 * Mediterranean the derivation yields **5,123 km in 11 continuous runs**, and
 * over the whole empire about 12,000 km. UNESCO describes the frontier as
 * "over 5,000 km". The runs come out as the things they should be — 1,331 km
 * of Danube from Raetia to Pannonia, 555 km of Rhine from Nijmegen to Mainz,
 * 460 km of Obergermanisch-Raetischer Limes, 90 km of Hadrian's Wall.
 *
 * The built works come from AWMC's `walls` layer, already imported by
 * `05-antiquity-atlas.ts` as `antiquity_lines.kind = 'wall'`. Those 92 features
 * are the real barriers — Hadrian's Wall, the Antonine Wall, the ORL in five
 * sections, the Sarmatian ramparts, the Fossatum Africae — and they carry no
 * names at all, which is what `shared/utils/limes.ts` exists to supply.
 *
 * ## The one number worth arguing about
 *
 * `COAST_BUFFER_METRES` is 6,000. Subtracting a buffer around the ancient
 * shoreline is what separates the land frontier from the coast, and the width
 * is a trade with no correct answer: smaller and the Rhine delta merges into
 * the North Sea, larger and Hadrian's Wall starts eroding from its western end.
 * It also drops any frontier that genuinely ran along a shore, which is a real
 * loss and is the reason this is a constant with a comment rather than a
 * literal in a query.
 *
 * ## Cost
 *
 * One download (~570 KB) and about a minute of PostGIS. Everything else is
 * already on disk. Run it after `pnpm import:atlas`, which writes the coastline
 * and the walls this reads.
 *
 *   pnpm import:limes
 */
import { mkdir, readFile, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Redis } from 'ioredis'
import postgres from 'postgres'
import { LIMES_SECTORS, claimLimesSectors } from '../../shared/utils/limes'
import type { LimesSegmentKind } from '../../shared/types'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'atlas')
const AWMC_RAW = 'https://raw.githubusercontent.com/AWMC/geodata/master'

/**
 * 200 CE, the Severan frontier, rather than Trajan's 117.
 *
 * It is the one date at which Hadrian's Wall, the Upper German and Raetian
 * limes and the whole Danube line were simultaneously garrisoned. Trajan's
 * maximum includes Mesopotamia and Armenia, held for months, and drawing those
 * as frontier would put a red line through country no fort was ever built in.
 */
const EXTENT_FILE = 'roman_empire_ce_200_extent.geojson'
const EXTENT_URL = `${AWMC_RAW}/Cultural-Data/political_shading/roman_empire_ce_200_extent/${EXTENT_FILE}`

/** See the header. Metres, around the ancient shoreline, subtracted from the boundary. */
const COAST_BUFFER_METRES = 6000

/**
 * AWMC's extent is 112 polygons, most of them islands a fraction of a degree
 * across. Only the mainland masses carry frontier; the rest add coastline the
 * buffer then has to remove one island at a time.
 *
 * Measured from the coordinates rather than read from `Shape_Area`, which is
 * the obvious thing to use and is wrong: in the 200 CE file Britain's polygon
 * carries `Shape_Area: 0.0`, so filtering on it silently dropped the whole
 * British frontier and the import reported success. A polygon's own extent
 * cannot lie about itself.
 */
const MAINLAND_SPAN_DEGREES = 2

/**
 * Runs shorter than this are dropped. Below about 25 km a run is not a stretch
 * of frontier but an artefact of the coast buffer clipping the boundary into
 * fragments around an estuary.
 */
const MIN_RUN_METRES = 25000

interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

interface DerivedStretch {
  kind: LimesSegmentKind
  certain: boolean
  bounds: Bounds
  geojson: string
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`)

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(target),
  )
  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024)} KB`)
  return target
}

/**
 * The mainland extent as one MultiPolygon, ready for ST_GeomFromGeoJSON.
 *
 * Assembled in TypeScript rather than by unioning 112 rows in Postgres because
 * nothing else needs the polygons: they are read once, turned into a boundary,
 * and thrown away. Storing them would put a fourth copy of the empire's outline
 * in a database that already has three.
 */
const spansDegrees = (coordinates: unknown, minimum: number): boolean => {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      west = Math.min(west, node[0])
      east = Math.max(east, node[0])
      south = Math.min(south, node[1])
      north = Math.max(north, node[1])
      return
    }
    for (const child of node) walk(child)
  }

  walk(coordinates)
  return Math.max(east - west, north - south) >= minimum
}

const readMainlandExtent = async (path: string): Promise<string> => {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as {
    features?: { geometry?: { coordinates: unknown } }[]
  }

  const mainland = (parsed.features ?? []).filter((feature) =>
    spansDegrees(feature.geometry?.coordinates, MAINLAND_SPAN_DEGREES),
  )

  console.log(`  Mainland polygons: ${mainland.length} of ${parsed.features?.length ?? 0}`)
  return JSON.stringify({
    type: 'MultiPolygon',
    coordinates: mainland.map((feature) => feature.geometry?.coordinates),
  })
}

/**
 * The land frontier: the boundary of the empire with the coast taken out of it,
 * merged into continuous runs.
 *
 * The `ST_LineMerge` is what turns a soup of boundary fragments into runs long
 * enough to name, and the `ST_CollectionExtract(…, 2)` is not optional —
 * `ST_Difference` against a buffer returns a GeometryCollection that can hold
 * stray points where the boundary grazes the buffer's edge.
 */
const deriveFrontier = async (extentGeoJson: string): Promise<DerivedStretch[]> => {
  process.stdout.write('  Deriving the land frontier … ')
  const started = Date.now()

  const rows = await sql<
    { geojson: string; west: number; south: number; east: number; north: number }[]
  >`
    WITH extent AS (
      SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${extentGeoJson}), 4326)) AS g
    ),
    edge AS (SELECT ST_Boundary(g) AS g FROM extent),
    coast AS (
      SELECT ST_Buffer(ST_Union(l.geom)::geography, ${COAST_BUFFER_METRES})::geometry AS g
      FROM antiquity_lines l, extent e
      WHERE l.kind = 'shoreline' AND l.geom && ST_Envelope(e.g)
    ),
    land AS (
      SELECT ST_CollectionExtract(ST_Difference(edge.g, coast.g), 2) AS g FROM edge, coast
    ),
    runs AS (SELECT (ST_Dump(ST_LineMerge(g))).geom AS g FROM land)
    SELECT ST_AsGeoJSON(g) AS geojson,
           ST_XMin(g) AS west, ST_YMin(g) AS south, ST_XMax(g) AS east, ST_YMax(g) AS north
    FROM runs
    WHERE ST_Length(g::geography) > ${MIN_RUN_METRES}
  `

  console.log(`${rows.length} runs in ${Math.round((Date.now() - started) / 1000)}s`)

  return rows.map((row) => ({
    // Which of 'river' or 'notional' it becomes is the claiming sector's to
    // say — see `frontierKind` in the gazetteer. Marked 'notional' until then.
    kind: 'notional' as LimesSegmentKind,
    certain: true,
    bounds: { west: row.west, south: row.south, east: row.east, north: row.north },
    geojson: row.geojson,
  }))
}

/** The built barriers, already imported by `05-antiquity-atlas.ts`. */
const readBarriers = async (): Promise<DerivedStretch[]> => {
  const rows = await sql<
    {
      geojson: string
      certain: boolean
      west: number
      south: number
      east: number
      north: number
    }[]
  >`
    SELECT ST_AsGeoJSON(geom) AS geojson, certain,
           ST_XMin(geom) AS west, ST_YMin(geom) AS south,
           ST_XMax(geom) AS east, ST_YMax(geom) AS north
    FROM antiquity_lines
    WHERE kind = 'wall'
  `

  console.log(`  AWMC wall linework: ${rows.length} features`)
  return rows.map((row) => ({
    kind: 'barrier' as LimesSegmentKind,
    certain: row.certain,
    bounds: { west: row.west, south: row.south, east: row.east, north: row.north },
    geojson: row.geojson,
  }))
}

interface ClaimedSegment {
  slug: string
  kind: LimesSegmentKind
  certain: boolean
  geojson: string
  /** GeoJSON MultiPolygon of the ground an earlier sector already claimed, or null. */
  exclude: string | null
}

const boundsToPolygon = (bounds: Bounds): number[][][] => [
  [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
    [bounds.west, bounds.south],
  ],
]

/**
 * Assigns each stretch to the sectors that claim it, clipped to each one's
 * bounds and minus whatever an earlier sector already took.
 *
 * Both halves matter. Clipping rather than assigning whole is what lets one
 * 1,331 km run of Danube be divided between Noricum-Pannonia and Moesia instead
 * of landing entirely in whichever the gazetteer lists first. Subtracting the
 * earlier claims is what stops the overlaps being drawn twice — see
 * `claimLimesSectors`, which is where the rule lives.
 */
const claimStretches = (
  stretches: DerivedStretch[],
): { claimed: ClaimedSegment[]; unclaimed: DerivedStretch[] } => {
  const claimed: ClaimedSegment[] = []
  const unclaimed: DerivedStretch[] = []

  for (const stretch of stretches) {
    const claims = claimLimesSectors({ kind: stretch.kind, bounds: stretch.bounds })

    if (claims.length === 0) {
      unclaimed.push(stretch)
      continue
    }

    for (const claim of claims) {
      claimed.push({
        slug: claim.sector.slug,
        // A built work stays a barrier; a derived stretch becomes whatever the
        // claiming sector says the frontier physically was there.
        kind: stretch.kind === 'barrier' ? 'barrier' : claim.sector.frontierKind,
        certain: stretch.certain,
        geojson: stretch.geojson,
        exclude:
          claim.excludes.length === 0
            ? null
            : JSON.stringify({
                type: 'MultiPolygon',
                coordinates: claim.excludes.map(boundsToPolygon),
              }),
      })
    }
  }

  return { claimed, unclaimed }
}

/**
 * Writes one sector: the row derived from its stretches, then the stretches.
 *
 * The sector has to be inserted before its segments can reference it, and its
 * geometry columns are NOT NULL, so both statements clip the same stretches
 * against the same envelope — `clipped` below is written once and composed into
 * each. Inserting a placeholder geometry first was the obvious alternative and
 * does not work: `ST_Multi` of an empty MultiLineString is a GeometryCollection,
 * which the column type rejects.
 *
 * `path_geom` is the longest single run after merging everything the sector
 * holds. A sector is not always continuous — the Fossatum Africae is several
 * separate ditches — so there is no honest way to make one line out of all of
 * it. Taking the longest gives `ST_LineLocatePoint` something real to measure
 * against, and an installation too far from it simply does not enter the roll.
 */
const writeSector = async (slug: string, segments: ClaimedSegment[]): Promise<number> => {
  const definition = LIMES_SECTORS.find((sector) => sector.slug === slug)
  if (!definition) throw new Error(`no definition for ${slug}`)

  const { west, south, east, north } = definition.bounds
  const geometries = segments.map((segment) => segment.geojson)
  const kinds = segments.map((segment) => segment.kind)
  const certainties = segments.map((segment) => segment.certain)
  const excludes = segments.map((segment) => segment.exclude)

  const clipped = sql`
    clipped AS (
      SELECT v.kind::limes_segment_kind AS kind,
             v.certain::boolean AS certain,
             ST_CollectionExtract(
               ST_Difference(
                 ST_Intersection(
                   ST_SetSRID(ST_GeomFromGeoJSON(v.geometry), 4326),
                   ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
                 ),
                 /*
                  * The ground an earlier sector already took.
                  *
                  * Unioned first: the gazetteer's rectangles overlap each other
                  * — the Fossatum Africae and the Limes Tripolitanus share a
                  * strip at 9 E — and a MultiPolygon whose parts overlap is
                  * invalid, which GEOS reports as a side location conflict
                  * rather than as bad input.
                  *
                  * Empty geometry rather than NULL, because ST_Difference
                  * against NULL is NULL: the stretch would vanish instead of
                  * surviving whole.
                  */
                 COALESCE(
                   ST_UnaryUnion(ST_SetSRID(ST_GeomFromGeoJSON(v.exclude), 4326)),
                   ST_GeomFromText('POLYGON EMPTY', 4326)
                 )
               ), 2) AS geom
      FROM unnest(
        ${geometries}::text[], ${kinds}::text[], ${certainties.map(String)}::text[],
        ${excludes}::text[]
      ) AS v(geometry, kind, certain, exclude)
    ),
    kept AS (SELECT * FROM clipped WHERE NOT ST_IsEmpty(geom))
  `

  const inserted = await sql<{ id: number; length_metres: number }[]>`
    WITH ${clipped},
    shape AS (SELECT ST_Union(geom) AS geom FROM kept),
    -- Merged per stretch, never across the union.
    --
    -- ST_Union nodes every crossing, and a sector's stretches cross constantly:
    -- Hadrian's Wall is the derived province edge plus ten pieces of AWMC wall
    -- linework running alongside and through it. Merging the noded result gave
    -- a four-point line that went thirty-five kilometres west and came back,
    -- and every fort on the wall then located to the same point on it. Merging
    -- each stretch on its own and taking the longest gives a line that is
    -- actually a course.
    runs AS (SELECT (ST_Dump(ST_LineMerge(geom))).geom AS geom FROM kept),
    longest AS (SELECT geom FROM runs ORDER BY ST_Length(geom::geography) DESC LIMIT 1)
    INSERT INTO limes_sectors (
      slug, name, latin_name, summary, pleiades_id, min_year, max_year,
      length_metres, geom, path_geom, bbox
    )
    SELECT ${slug}, ${definition.name}, ${definition.latinName}, ${definition.summary},
           ${definition.pleiadesId}, ${definition.minYear}, ${definition.maxYear},
           round(ST_Length((SELECT geom FROM shape)::geography))::int,
           ST_Multi((SELECT geom FROM shape)),
           (SELECT geom FROM longest),
           -- Padded so a sector fitted to this envelope is not drawn hard
           -- against the edge of the viewport.
           ST_Envelope(ST_Buffer((SELECT geom FROM shape), 0.15))
    WHERE EXISTS (SELECT 1 FROM kept)
      AND (SELECT geom FROM longest) IS NOT NULL
    RETURNING id, length_metres
  `

  // Every stretch clipped to nothing: a sector whose bounds the gazetteer got
  // wrong, or one whose geometry the coast buffer removed entirely.
  if (inserted.length === 0) return 0
  const sector = inserted[0]!

  await sql`
    WITH ${clipped}
    INSERT INTO limes_segments (sector_id, kind, certain, geom)
    SELECT ${sector.id}, kind, certain, ST_Multi(geom) FROM kept
  `

  return sector.length_metres
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('The limes — derived from AWMC (ODbL 1.0)\n')

  const [walls] = await sql<{ count: number }[]>`
    SELECT count(*)::int FROM antiquity_lines WHERE kind = 'shoreline'
  `
  if (!walls || walls.count === 0) {
    throw new Error('No coastline in antiquity_lines. Run `pnpm import:atlas` first.')
  }

  const extentPath = await fetchCached(EXTENT_URL, EXTENT_FILE)
  const extent = await readMainlandExtent(extentPath)

  const stretches = [...(await deriveFrontier(extent)), ...(await readBarriers())]
  const { claimed, unclaimed } = claimStretches(stretches)

  await sql`TRUNCATE limes_sectors, limes_segments RESTART IDENTITY CASCADE`

  console.log('')
  let total = 0
  for (const definition of LIMES_SECTORS) {
    const segments = claimed.filter((segment) => segment.slug === definition.slug)
    if (segments.length === 0) {
      console.log(`  ${definition.name}: nothing claimed`)
      continue
    }
    const length = await writeSector(definition.slug, segments)
    total += length
    console.log(
      `  ${definition.name}: ${Math.round(length / 1000)} km, ${segments.length} stretches`,
    )
  }

  /**
   * Reported, never dropped silently. The gazetteer is hand-written and the
   * bounds in it are the only editorial input to this whole feature, so
   * anything it failed to claim has to be visible — the same posture the
   * `pmeta_extids` allowlist parser takes.
   *
   * Some of this is expected and correct: about 2,200 km of southern Egyptian
   * desert edge, which was a provincial boundary and not a frontier system, and
   * the city and isthmus walls in AWMC's `walls` layer. See the note in
   * `shared/utils/limes.ts`.
   */
  if (unclaimed.length > 0) {
    console.log(`\n  Unclaimed, and left undrawn (${unclaimed.length}):`)
    for (const stretch of unclaimed) {
      const { west, south, east, north } = stretch.bounds
      console.log(
        `    ${stretch.kind.padEnd(9)} ${west.toFixed(1)},${south.toFixed(1)} → ${east.toFixed(1)},${north.toFixed(1)}`,
      )
    }
  }

  await sql`ANALYZE limes_sectors, limes_segments`
  console.log(`\n  Frontier drawn: ${Math.round(total / 1000)} km`)

  /**
   * The limes rides the atlas generation rather than getting a third counter.
   * Both change only when an import runs, and a reader who rebuilt the atlas
   * has almost certainly rebuilt this too.
   */
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    const stale = [...(await redis.keys('atlas:v*')), ...(await redis.keys('limes:v*'))]
    if (stale.length > 0) await redis.del(...stale)
    console.log(`  Atlas cache generation is now ${version}; ${stale.length} stale tiles dropped.`)
  } catch (error) {
    console.warn(
      `\n  Frontier rebuilt, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous sheet.`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
