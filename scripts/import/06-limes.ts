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
import postgres from 'postgres'
import { refreshAtlasCache } from './atlas-cache'
import { LIMES_SECTORS, claimLimesSectors } from '../../shared/utils/limes'
import type { LimesSegmentKind, LimesSource } from '../../shared/types'
import { TRACED_LIMES_SOURCES } from '../../shared/types'
import { readTracedStretches } from './limes-traces'
import type { TraceStretch } from './limes-traces'
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
 * Narrow gaps in the extent, in degrees, closed before the boundary is taken.
 * About 6–9 km, depending on latitude.
 *
 * AWMC's extent is 112 separate polygons, not one shape, and the ones that
 * abut do not abut cleanly: seams and slivers a few kilometres wide run between
 * provinces. The boundary of that multipolygon includes every seam, so the map
 * drew straight chords across the Alps and the Balkans, pairs of near-parallel
 * lines on either side of a sliver, and a 100 km-long spike in Swabia that a
 * sector then claimed as river. None of it is frontier. Dissolving the polygons
 * and closing gaps narrower than this (dilate, then erode by the same amount)
 * leaves the outer edge untouched and removes the seams; measured against the
 * real data, 0.03° left the Swabian spike and 0.08° removed it. Wider than
 * about 0.15° would start bridging real bays and river mouths.
 */
const EXTENT_SEAM_DEGREES = 0.08

/**
 * A derived stretch this close to the middle of a built work of the same sector
 * is dropped, and the work is drawn instead.
 *
 * The extent is hand-generalised and AWMC's wall linework is surveyed, so where
 * both describe one frontier — Hadrian's Wall, the Antonine Wall, the Raetian
 * limes — they run kilometres apart and the sheet showed two lines where there
 * is one. The surveyed one wins; the derived line carries on wherever no work
 * does. 25 km is what it takes to catch the Upper German limes, where the
 * extent follows the later, straighter Jüngerer Limes about 20 km from the
 * surveyed Neckar–Odenwald line; the 8 km that sufficed for Hadrian's Wall left
 * that pair doubled.
 */
const PARALLEL_BUFFER_METRES = 25000

/**
 * Within this distance of either end of a work the derived line is kept. The
 * point of the derived line is to join the works up — the Rhine runs into the
 * start of the Upper German limes — and cutting a whole parallel-zone radius off
 * each end would leave a gap in the frontier at every junction.
 */
const WORK_END_CLEARANCE_METRES = 10000

/**
 * What survives of a derived stretch after the parallel part is cut away must
 * still be this long, or it is a stub left where the cut was made.
 */
const MIN_FRAGMENT_METRES = 10000

/**
 * A traced line is only drawn where no higher-priority trace lies within this
 * reach, so two traces of one wall draw as one line. OpenHistoricalMap gets a
 * wider reach because it sometimes closes a bend with a straight chord a
 * kilometre or more off the course the other sources agree on; a chord is not
 * a second work.
 */
const TRACE_DEDUPE_METRES = 1000
const TRACE_DEDUPE_OHM_METRES = 2500

/**
 * AWMC's own wall linework is dropped within this reach of any traced line (a
 * wall, or a river the wall follows, as at the Main) in the same sector. The offsets measured against survey data were a median 0.3–0.6 km
 * with excursions to ~5 km (the ORL), so anything nearer than 6 km is the same
 * wall drawn worse. Further away it is a different work — the Cumbrian coast
 * milefortlets, the Fossatum Africae — and stays, drawn dashed as approximate.
 */
const AWMC_SUPPRESS_METRES = 6000

/** What is left of an AWMC wall after that cut must still be this long, or it is a stub. */
const MIN_AWMC_FRAGMENT_METRES = 2000

/**
 * A derived river is dropped within this reach of the traced river centreline of
 * the same sector, and a traced river is kept only this close to the derived
 * frontier. The second half is what stops the Danube upstream of the frontier
 * (Ulm to Eining) and the Rhine inside the empire from being drawn as frontier:
 * the derived edge says *where* the frontier is, the river centreline says
 * exactly *where on the river*.
 */
const RIVER_REACH_METRES = 8000

/**
 * A wall whose two ends meet within this fraction of its own length encloses
 * ground; it does not divide anything. AWMC's `walls` layer holds one such: the
 * Langmauer near Trier, a ~55 km circuit round an estate, which the sector
 * bounds around the Moselle swept in and which drew as a box among the
 * frontier works.
 */
const ENCLOSURE_GAP_RATIO = 0.05

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
  source: LimesSource
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
      SELECT ST_Buffer(
        ST_Buffer(
          ST_UnaryUnion(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${extentGeoJson}), 4326))),
          ${EXTENT_SEAM_DEGREES}::float8
        ),
        -${EXTENT_SEAM_DEGREES}::float8
      ) AS g
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
    source: 'extent' as LimesSource,
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
      AND ST_Distance(
            ST_StartPoint(ST_GeometryN(geom, 1)),
            ST_EndPoint(ST_GeometryN(geom, ST_NumGeometries(geom)))
          ) >= ${ENCLOSURE_GAP_RATIO}::float8 * ST_Length(geom)
  `

  console.log(`  AWMC wall linework: ${rows.length} features (enclosures left out)`)
  return rows.map((row) => ({
    kind: 'barrier' as LimesSegmentKind,
    source: 'awmc' as LimesSource,
    certain: row.certain,
    bounds: { west: row.west, south: row.south, east: row.east, north: row.north },
    geojson: row.geojson,
  }))
}

interface ClaimedSegment {
  slug: string
  kind: LimesSegmentKind
  source: LimesSource
  /** Lower wins among traced sources; 99 for the approximate ones, which never compete. */
  priority: number
  /** See `TraceStretch.exclusive`. */
  exclusive: boolean
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
): { claimed: ClaimedSegment[]; unclaimed: DerivedStretch[]; omitted: number } => {
  const claimed: ClaimedSegment[] = []
  const unclaimed: DerivedStretch[] = []
  let omitted = 0

  for (const stretch of stretches) {
    const claims = claimLimesSectors({ kind: stretch.kind, bounds: stretch.bounds })

    if (claims.length === 0) {
      unclaimed.push(stretch)
      continue
    }

    for (const claim of claims) {
      // A sector the gazetteer says is drawn from traced lines alone does not
      // take the approximate ones: the generalised line would sit beside the
      // real one as a second, wrong, frontier.
      const omit =
        (stretch.source === 'extent' && claim.sector.drawsExtent === false) ||
        (stretch.source === 'awmc' && claim.sector.drawsAwmcWalls === false)
      if (omit) {
        omitted += 1
        continue
      }

      claimed.push({
        slug: claim.sector.slug,
        // A built work stays a barrier; a derived stretch becomes whatever the
        // claiming sector says the frontier physically was there.
        kind: stretch.kind === 'barrier' ? 'barrier' : claim.sector.frontierKind,
        source: stretch.source,
        priority: 99,
        exclusive: false,
        certain: stretch.certain,
        geojson: stretch.geojson,
        exclude: excludeOf(claim.excludes),
      })
    }
  }

  return { claimed, unclaimed, omitted }
}

const excludeOf = (bounds: Bounds[]): string | null =>
  bounds.length === 0
    ? null
    : JSON.stringify({ type: 'MultiPolygon', coordinates: bounds.map(boundsToPolygon) })

/**
 * A trace belongs to the sectors it was chosen for, in the order listed — not
 * to whichever sector's rectangle it happens to cross. The Danube centreline
 * runs through half the gazetteer's boxes, and most of them are not frontier.
 * Overlap between the listed sectors is subtracted exactly as it is for the
 * derived stretches: the later one leaves the earlier one's rectangle alone.
 */
const boundsOfSector = (slug: string): Bounds | undefined =>
  LIMES_SECTORS.find((sector) => sector.slug === slug)?.bounds

const claimTraced = (traces: TraceStretch[]): ClaimedSegment[] =>
  traces.flatMap((trace) =>
    trace.sectors.map((slug, index): ClaimedSegment => {
      const earlier = trace.sectors
        .slice(0, index)
        .map(boundsOfSector)
        .filter((bounds): bounds is Bounds => bounds !== undefined)
      return {
        slug,
        kind: trace.kind,
        source: trace.source,
        priority: trace.priority,
        exclusive: trace.exclusive === true,
        certain: true,
        geojson: trace.geojson,
        exclude: excludeOf(earlier),
      }
    }),
  )

/**
 * Cuts each trace down to the part that is frontier: inside its `clip` box where
 * it has one, and — for a river with no box — only where it lies within reach of
 * the derived frontier (see {@link RIVER_REACH_METRES}). Done in PostGIS on the
 * merged lines because the Danube alone is ~2,700 km of vertices.
 */
const refineTraces = async (
  traces: TraceStretch[],
  derived: DerivedStretch[],
): Promise<TraceStretch[]> => {
  const frontier = derived
    .filter((stretch) => stretch.source === 'extent')
    .map((stretch) => stretch.geojson)

  const refined: TraceStretch[] = []
  for (const trace of traces) {
    let geojson = trace.geojson

    if (trace.clip) {
      const { west, south, east, north } = trace.clip
      const [row] = await sql<{ geojson: string | null }[]>`
        SELECT ST_AsGeoJSON(
                 ST_CollectionExtract(
                   ST_Intersection(
                     ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
                     ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
                   ),
                   2
                 )
               ) AS geojson
      `
      if (!row?.geojson) {
        console.log(`  ${trace.label}: nothing inside its box — skipped`)
        continue
      }
      geojson = row.geojson
    }

    if (trace.maskToFrontier) {
      const [row] = await sql<{ geojson: string | null }[]>`
        WITH reach AS (
          SELECT ST_Buffer(
                   ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326))::geography,
                   ${RIVER_REACH_METRES}
                 )::geometry AS geom
          FROM unnest(${frontier}::text[]) AS g
        )
        SELECT ST_AsGeoJSON(
                 ST_CollectionExtract(
                   ST_Intersection(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326), reach.geom),
                   2
                 )
               ) AS geojson
        FROM reach
      `
      if (!row?.geojson) {
        console.log(`  ${trace.label}: nothing within reach of the frontier — skipped`)
        continue
      }
      geojson = row.geojson
    }

    refined.push({ ...trace, geojson })
  }
  return refined
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
  const sources = segments.map((segment) => segment.source)
  const priorities = segments.map((segment) => segment.priority)
  const exclusives = segments.map((segment) => segment.exclusive)
  const excludes = segments.map((segment) => segment.exclude)
  const traced = [...TRACED_LIMES_SOURCES]

  const clipped = sql`
    clipped AS (
      SELECT v.kind::limes_segment_kind AS kind,
             v.certain::boolean AS certain,
             v.source,
             v.priority::int AS priority,
             v.exclusive::boolean AS exclusive,
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
        ${sources}::text[], ${priorities.map(String)}::text[], ${exclusives.map(String)}::text[],
        ${excludes}::text[]
      ) AS v(geometry, kind, certain, source, priority, exclusive, exclude)
    ),
    nonempty AS (SELECT * FROM clipped WHERE NOT ST_IsEmpty(geom)),

    -- ## Traced lines: one line per work, best source first.
    --
    -- Each is cut back by the buffer of every traced line ranked above it, so
    -- two traces of one wall draw once. Ranking is by priority, then by length
    -- (a longer trace is the more complete one). OpenHistoricalMap's reach is
    -- wider: see TRACE_DEDUPE_OHM_METRES.
    traced_ranked AS (
      SELECT *, row_number() OVER (ORDER BY priority, ST_Length(geom::geography) DESC) AS rank
      FROM nonempty WHERE source = ANY(${traced}::text[])
    ),
    traced_kept AS (
      SELECT t.kind, t.certain, t.source,
             CASE WHEN t.exclusive THEN t.geom ELSE ST_CollectionExtract(
               ST_Difference(
                 t.geom,
                 COALESCE(
                   (SELECT ST_Union(
                             ST_Buffer(
                               higher.geom::geography,
                               CASE WHEN t.source = 'ohm'
                                    THEN ${TRACE_DEDUPE_OHM_METRES}::float8
                                    ELSE ${TRACE_DEDUPE_METRES}::float8 END
                             )::geometry
                           )
                    FROM traced_ranked higher WHERE higher.rank < t.rank),
                   ST_GeomFromText('POLYGON EMPTY', 4326)
                 )
               ), 2) END AS geom
      FROM traced_ranked t
    ),

    -- ## AWMC walls: only where nothing traced stands within reach.
    awmc_kept AS (
      SELECT n.kind, n.certain, n.source,
             ST_CollectionExtract(
               ST_Difference(
                 n.geom,
                 COALESCE(
                   (SELECT ST_Union(ST_Buffer(t.geom::geography, ${AWMC_SUPPRESS_METRES})::geometry)
                    FROM traced_kept t WHERE NOT ST_IsEmpty(t.geom)),
                   ST_GeomFromText('POLYGON EMPTY', 4326)
                 )
               ), 2) AS geom
      FROM nonempty n WHERE n.source = 'awmc'
    ),

    -- ## The derived frontier: only where nothing better describes the ground.
    --
    -- Ground beside the middle of this sector's built works (their buffer, less
    -- the clearance round each end), and ground within reach of its traced
    -- river. NULL when there is none, hence the COALESCE: ST_Difference against
    -- NULL is NULL.
    works AS (
      SELECT ST_Difference(
               ST_Buffer(u.geom::geography, ${PARALLEL_BUFFER_METRES})::geometry,
               ST_Buffer(
                 ST_Boundary(ST_LineMerge(u.geom))::geography,
                 ${WORK_END_CLEARANCE_METRES}
               )::geometry
             ) AS geom
      FROM (
        SELECT ST_Union(geom) AS geom FROM (
          SELECT geom FROM traced_kept WHERE kind = 'barrier' AND NOT ST_IsEmpty(geom)
          UNION ALL
          SELECT geom FROM awmc_kept WHERE NOT ST_IsEmpty(geom)
        ) b
      ) u
    ),
    rivers AS (
      SELECT ST_Buffer(ST_Union(geom)::geography, ${RIVER_REACH_METRES})::geometry AS geom
      FROM traced_kept WHERE kind = 'river' AND NOT ST_IsEmpty(geom)
    ),
    extent_kept AS (
      SELECT n.kind, n.certain, n.source,
             ST_CollectionExtract(
               ST_Difference(
                 ST_Difference(
                   n.geom,
                   COALESCE((SELECT geom FROM works), ST_GeomFromText('POLYGON EMPTY', 4326))
                 ),
                 COALESCE((SELECT geom FROM rivers), ST_GeomFromText('POLYGON EMPTY', 4326))
               ), 2) AS geom
      FROM nonempty n WHERE n.source = 'extent'
    ),

    parts AS (
      SELECT kind, certain, source, (ST_Dump(geom)).geom AS geom
      FROM (
        SELECT * FROM traced_kept
        UNION ALL SELECT * FROM awmc_kept
        UNION ALL SELECT * FROM extent_kept
      ) u
      WHERE NOT ST_IsEmpty(geom)
    ),
    kept AS (
      SELECT kind, certain, source, ST_Multi(ST_Collect(geom)) AS geom
      FROM parts
      WHERE source = ANY(${traced}::text[])
         OR ST_Length(geom::geography) >=
            CASE source WHEN 'awmc' THEN ${MIN_AWMC_FRAGMENT_METRES}::float8 ELSE ${MIN_FRAGMENT_METRES}::float8 END
      GROUP BY kind, certain, source
    )
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
    INSERT INTO limes_segments (sector_id, kind, certain, source, geom)
    SELECT ${sector.id}, kind, certain, source, ST_Multi(geom) FROM kept
  `

  return sector.length_metres
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('The limes — traced from OSM / OHM / vici.org, filled from AWMC (ODbL 1.0)\n')

  const [walls] = await sql<{ count: number }[]>`
    SELECT count(*)::int FROM antiquity_lines WHERE kind = 'shoreline'
  `
  if (!walls || walls.count === 0) {
    throw new Error('No coastline in antiquity_lines. Run `pnpm import:atlas` first.')
  }

  const extentPath = await fetchCached(EXTENT_URL, EXTENT_FILE)
  const extent = await readMainlandExtent(extentPath)

  const derived = [...(await deriveFrontier(extent)), ...(await readBarriers())]
  const traces = await refineTraces(await readTracedStretches(sql), derived)
  const { claimed: claimedDerived, unclaimed, omitted } = claimStretches(derived)
  const claimed = [...claimedDerived, ...claimTraced(traces)]
  console.log(
    `  Traced: ${traces.length} stretches; ${omitted} approximate ones left out where a sector is drawn from traced lines alone`,
  )

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
    const bySource = await sql<{ source: string; km: number }[]>`
      SELECT g.source, round((sum(ST_Length(g.geom::geography)) / 1000)::numeric)::int AS km
      FROM limes_segments g JOIN limes_sectors s ON s.id = g.sector_id
      WHERE s.slug = ${definition.slug} GROUP BY g.source ORDER BY 2 DESC
    `
    const breakdown = bySource.map((row) => row.source + ' ' + row.km).join(', ')
    console.log(`  ${definition.name}: ${Math.round(length / 1000)} km — ${breakdown}`)
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
  await refreshAtlasCache(['atlas:v*', 'limes:v*'])

  await sql.end()
}

await main()
