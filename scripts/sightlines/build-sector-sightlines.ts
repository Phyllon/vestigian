/**
 * What the towers of each frontier sector could do together: whether a signal
 * could pass from tower to tower along the line, which ground is overlooked by
 * at least one tower and by three or more, and which stretches of the line no
 * tower watches. Written to `limes_sector_sightlines` for the sector panel.
 *
 * It is a script and not a request because it is a viewshed from every tower and
 * a sight line between every pair within range: for the Upper German Limes about
 * 240 towers, a thousand sight lines and a million grid cells — a couple of
 * minutes, not the seconds a reader will wait. The per-tower answer a reader
 * opens (`/api/sites/:id/sightlines`) is the same calculation; this adds them up.
 *
 *   pnpm sightlines:build                       every sector with two or more towers
 *   pnpm sightlines:build limes-raeticus        one sector, or several, by slug
 *
 * Needs the terrain: `NUXT_PUBLIC_BASEMAP_TERRAIN_URL` (the mirror) or, when it
 * is empty, Mapterhorn's own tiles. Run it again after `pnpm import:limes`, after
 * the tower records change in bulk, or when `SIGHTLINE_MODEL_VERSION` moves; the
 * panel prints when the answer was worked out and from how many towers.
 * See `.claude/rules/sightlines.md`.
 */
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'
import { loadTerrainField } from '../../server/utils/terrain'
import type { TerrainField } from '../../server/utils/terrain'
import type {
  BoundingBox,
  LonLat,
  SectorWatchBlind,
  SectorWatchBreak,
  SectorWatchSummary,
  SectorWatchTower,
  SightlineVariant,
} from '../../shared/types'
import { SIGHTLINE_VARIANTS } from '../../shared/types'
import { samplePolyline } from '../../shared/utils/elevation-profile'
import {
  SEEN_GRID_BIN_METRES,
  SEEN_GRID_COLUMNS,
  SIGHTLINE_MODEL_VERSION,
  SIGHTLINE_RADIUS_METRES,
  SIGHTLINE_RAY_COUNT,
  SIGHTLINE_STEP_METRES,
  TOWER_HEIGHT_MODEL,
  castSightlines,
  towerEyeHeights,
  traceSightLine,
} from '../../shared/utils/sightline'
import {
  addTowerCoverage,
  componentsOf,
  contiguousRuns,
  foldTwinTowers,
  makeCoverageGrid,
  metresBetweenPositions,
  overlookedBy,
  readChain,
  rectanglesAtLeast,
  rectanglesToWkt,
  spanningEdges,
  unwatchedStretches,
} from '../../shared/utils/sector-watch'
import type { CoverageGrid, TowerCoverage, TowerEdge } from '../../shared/utils/sector-watch'

const sql = postgres(requireDatabaseUrl(), { max: 2 })
const TERRAIN_URL = process.env.NUXT_PUBLIC_BASEMAP_TERRAIN_URL ?? ''

/** How near a tower must be to a sector to count as on it — the same rule as the per-tower endpoint. */
const REACH_METRES = 1_500
/** The farthest apart two towers are tried against each other for a link. */
const LINK_RANGE_METRES = 6_000
const TWIN_THRESHOLD_METRES = 60
const GRID_CELL_METRES = 200
/** A stretch of the line seen by nothing and shorter than this is noise in the terrain model. */
const MINIMUM_BLIND_METRES = 300
const PATH_STEP_METRES = 100
const SIMPLIFY_DEGREES = 0.0007
const METRES_PER_DEGREE_LATITUDE = 111_320

interface SectorRow {
  slug: string
  name: string
  geometry: string
}

interface TowerRow {
  id: number
  slug: string
  title: string
  lon: number
  lat: number
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const percent = (value: number): string => `${Math.round(value * 100)}%`

const boundsAround = (points: readonly LonLat[], marginMetres: number): BoundingBox => {
  const lons = points.map((point) => point.lon)
  const lats = points.map((point) => point.lat)
  const middle = (Math.min(...lats) + Math.max(...lats)) / 2
  const marginLatitude = marginMetres / METRES_PER_DEGREE_LATITUDE
  const marginLongitude = marginLatitude / Math.max(Math.cos((middle * Math.PI) / 180), 0.2)
  return {
    west: Math.min(...lons) - marginLongitude,
    east: Math.max(...lons) + marginLongitude,
    south: Math.min(...lats) - marginLatitude,
    north: Math.max(...lats) + marginLatitude,
  }
}

const loadSectors = async (slugs: readonly string[]): Promise<SectorRow[]> => {
  const rows = await sql<SectorRow[]>`
    SELECT slug, name, ST_AsGeoJSON(geom) AS geometry
    FROM limes_sectors
    ORDER BY slug
  `
  return slugs.length === 0 ? rows : rows.filter((row) => slugs.includes(row.slug))
}

const loadTowers = async (slug: string): Promise<TowerRow[]> =>
  sql<TowerRow[]>`
    SELECT s.id, s.slug, s.title, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat
    FROM limes_sectors ls
    JOIN sites s
      ON s.subcategory = 'watchtower'
     AND s.status = 'approved'
     AND s.geom && ST_Expand(ls.bbox, 0.05)
     AND ST_DWithin(s.geom::geography, ls.geom::geography, ${REACH_METRES})
    WHERE ls.slug = ${slug}
      AND NOT EXISTS (
        SELECT 1 FROM limes_sectors other
        WHERE other.id <> ls.id
          AND ST_Distance(other.geom::geography, s.geom::geography)
            < ST_Distance(ls.geom::geography, s.geom::geography)
      )
    ORDER BY s.id
  `

interface Work {
  id: number
  slug: string
  title: string
  position: LonLat
  coverage: TowerCoverage
}

interface PairResult {
  first: number
  second: number
  distanceMetres: number
  isClear: Record<SightlineVariant, boolean>
}

/**
 * A walk from the westernmost tower to its nearest unvisited neighbour and on,
 * so consecutive towers share most of their terrain tiles: hundreds of towers in
 * a random order would fetch the same tile a dozen times over.
 */
const walkOrder = <T extends { position: LonLat }>(towers: readonly T[]): T[] => {
  const remaining = [...towers].sort((first, second) => first.position.lon - second.position.lon)
  const ordered: T[] = []
  let current = remaining.shift()
  while (current) {
    ordered.push(current)
    const here: T = current
    let nearest = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    remaining.forEach((candidate, index) => {
      const distance = metresBetweenPositions(here.position, candidate.position)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = index
      }
    })
    current = nearest >= 0 ? remaining.splice(nearest, 1)[0] : undefined
  }
  return ordered
}

interface TraceLinksRequest {
  tower: { position: LonLat }
  /** Index of the tower in the list of works. */
  here: number
  ground: number
  field: TerrainField
  /** The towers still to come in the walk: each pair is traced once, from its earlier end. */
  ahead: readonly { id: number; position: LonLat }[]
}

/** Sight lines from one tower to each tower ahead within range, at all three height estimates. */
const traceLinksFrom = (request: TraceLinksRequest): PairResult[] => {
  const { tower, here, ground, field, ahead } = request
  const eyes = towerEyeHeights()
  const results: PairResult[] = []

  for (const other of ahead) {
    const distanceMetres = metresBetweenPositions(tower.position, other.position)
    const otherGround =
      distanceMetres <= LINK_RANGE_METRES
        ? field.elevationAt(other.position.lon, other.position.lat)
        : null
    if (otherGround === null) continue

    const isClear = {} as Record<SightlineVariant, boolean>
    for (const variant of SIGHTLINE_VARIANTS) {
      isClear[variant] = traceSightLine({
        from: tower.position,
        to: other.position,
        fromEyeElevationMetres: ground + eyes[variant],
        toEyeElevationMetres: otherGround + eyes[variant],
        stepMetres: SIGHTLINE_STEP_METRES,
        sampler: field.elevationAt,
        maximumProfilePoints: 2,
      }).isClear
    }
    // `second` is the tower's id for now; resolved to a work index by the caller.
    results.push({ first: here, second: other.id, distanceMetres, isClear })
  }
  return results
}

interface TowerPass {
  works: Work[]
  links: PairResult[]
  skippedTowerCount: number
}

/**
 * First pass: every tower's own viewshed, and its sight lines to the towers that
 * come later in the walk and lie within range, at all three height estimates.
 */
const walkTowers = async (
  ordered: readonly { id: number; slug: string; title: string; position: LonLat }[],
): Promise<TowerPass> => {
  const eyes = towerEyeHeights()
  const gridShape = {
    columns: SEEN_GRID_COLUMNS,
    binMetres: SEEN_GRID_BIN_METRES,
    binCount: SIGHTLINE_RADIUS_METRES / SEEN_GRID_BIN_METRES,
  }
  const works: Work[] = []
  const indexOfId = new Map<number, number>()
  const pairs: PairResult[] = []
  let skippedTowerCount = 0
  const started = Date.now()

  for (let index = 0; index < ordered.length; index++) {
    const tower = ordered[index]!
    const field = await loadTerrainField({
      area: { bounds: boundsAround([tower.position], SIGHTLINE_RADIUS_METRES + 300) },
      terrainUrl: TERRAIN_URL,
    })
    const ground = field.elevationAt(tower.position.lon, tower.position.lat)
    if (ground === null) {
      skippedTowerCount++
      continue
    }

    const cast = castSightlines({
      origin: tower.position,
      originElevationMetres: ground,
      observers: [
        {
          id: 'view',
          eyeHeightMetres: eyes.central,
          targetHeightMetres: TOWER_HEIGHT_MODEL.targetHeightMetres,
          keepGrid: true,
        },
      ],
      radiusMetres: SIGHTLINE_RADIUS_METRES,
      rayCount: SIGHTLINE_RAY_COUNT,
      stepMetres: SIGHTLINE_STEP_METRES,
      sampler: field.elevationAt,
      grid: gridShape,
    })

    const here = works.length
    indexOfId.set(tower.id, here)
    works.push({
      id: tower.id,
      slug: tower.slug,
      title: tower.title,
      position: tower.position,
      coverage: {
        position: tower.position,
        cells: cast.observers.view!.seenCells!,
        shape: gridShape,
      },
    })

    pairs.push(
      ...traceLinksFrom({
        tower,
        here,
        ground,
        field,
        ahead: ordered.slice(index + 1),
      }),
    )

    if ((index + 1) % 25 === 0 || index === ordered.length - 1) {
      const seconds = Math.round((Date.now() - started) / 1000)
      console.log(`  ${index + 1}/${ordered.length} towers, ${pairs.length} pairs, ${seconds}s`)
    }
  }

  const links = pairs
    .map((pair) => ({ ...pair, second: indexOfId.get(pair.second) ?? -1 }))
    .filter((pair) => pair.second >= 0)
  return { works, links, skippedTowerCount }
}

interface ChainResult {
  edges: TowerEdge[]
  gapEdges: TowerEdge[]
  chainCoverage: Record<SightlineVariant, number>
  centralComponents: number[]
  chainLengthMetres: number
  breaks: TowerEdge[]
  clearLinkCounts: number[]
}

/** The chain: each tower to its neighbour along, and whether a signal could cross. */
const readChainOfTowers = (works: readonly Work[], links: readonly PairResult[]): ChainResult => {
  const { edges, gapEdges } = spanningEdges(
    works.map((work) => work.position),
    LINK_RANGE_METRES,
  )
  const chainCoverage = {} as Record<SightlineVariant, number>
  let centralComponents: number[] = []
  let centralBreaks: TowerEdge[] = []
  let chainLengthMetres = 0

  for (const variant of SIGHTLINE_VARIANTS) {
    const clear = links
      .filter((pair) => pair.isClear[variant])
      .map((pair) => ({ from: pair.first, to: pair.second }))
    const components = componentsOf(works.length, clear)
    const reading = readChain(edges, components)
    chainCoverage[variant] =
      reading.totalMetres === 0 ? 0 : roundTo(reading.coveredMetres / reading.totalMetres, 3)
    if (variant === 'central') {
      centralComponents = components
      centralBreaks = reading.breaks
      chainLengthMetres = Math.round(reading.totalMetres)
    }
  }

  const clearLinkCounts = new Array<number>(works.length).fill(0)
  for (const pair of links) {
    if (!pair.isClear.central) continue
    clearLinkCounts[pair.first]!++
    clearLinkCounts[pair.second]!++
  }

  return {
    edges,
    gapEdges,
    chainCoverage,
    centralComponents,
    chainLengthMetres,
    breaks: centralBreaks,
    clearLinkCounts,
  }
}

interface GroundResult {
  grid: CoverageGrid
  counts: Uint8Array
  overlooked: GeoJSON.Geometry | null
  watched: GeoJSON.Geometry | null
  overlookedAreaSquareKm: number
  watchedAreaSquareKm: number
}

/** The watch: how many towers overlook each cell, and the ground at one and at three. */
const readGround = async (works: readonly Work[]): Promise<GroundResult> => {
  const bounds = boundsAround(
    works.map((work) => work.position),
    SIGHTLINE_RADIUS_METRES + 500,
  )
  const grid = makeCoverageGrid(bounds, GRID_CELL_METRES)
  console.log(`  grid ${grid.columns} × ${grid.rows} cells of ~${GRID_CELL_METRES} m`)
  const counts = new Uint8Array(grid.columns * grid.rows)
  for (const work of works) addTowerCoverage(grid, counts, work.coverage)

  const unionOf = async (minimum: number): Promise<GeoJSON.Geometry | null> => {
    const wkt = rectanglesToWkt(rectanglesAtLeast(grid, counts, minimum))
    if (wkt === 'MULTIPOLYGON EMPTY') return null
    const [row] = await sql<{ geometry: string | null }[]>`
      SELECT ST_AsGeoJSON(
               ST_SimplifyPreserveTopology(ST_UnaryUnion(ST_GeomFromText(${wkt}, 4326)), ${SIMPLIFY_DEGREES}),
               5
             ) AS geometry
    `
    return row?.geometry ? (JSON.parse(row.geometry) as GeoJSON.Geometry) : null
  }

  let overlookedCells = 0
  let watchedCells = 0
  counts.forEach((count) => {
    if (count >= 1) overlookedCells++
    if (count >= 3) watchedCells++
  })
  const cellAreaSquareKm = (GRID_CELL_METRES / 1000) ** 2

  return {
    grid,
    counts,
    overlooked: await unionOf(1),
    watched: await unionOf(3),
    overlookedAreaSquareKm: roundTo(overlookedCells * cellAreaSquareKm, 0),
    watchedAreaSquareKm: roundTo(watchedCells * cellAreaSquareKm, 0),
  }
}

/**
 * A stretch of the line, with the run of samples it was found in. The run is part
 * of its identity: the last sample of one part of the sector and the first of the
 * next carry the *same* cumulative distance, so a distance range alone would pick
 * up both ends of the seam and draw a chord between them.
 */
interface BlindStretch {
  fromMetres: number
  toMetres: number
  runStart: number
  runEnd: number
}

interface LineResult {
  lengthMetres: number
  seenShare: number
  watchedShare: number
  blind: BlindStretch[]
  slice: (stretch: BlindStretch) => [number, number][]
}

/**
 * The line itself — every part of the sector — but only where a tower could
 * reach it. Beyond that it is unrecorded, not blind. Runs of in-reach samples are
 * handled apart, so an unwatched run is not joined across a part that was skipped.
 */
const readLine = (
  geometryJson: string,
  works: readonly Work[],
  ground: Pick<GroundResult, 'grid' | 'counts'>,
): LineResult => {
  const geometry = JSON.parse(geometryJson) as { coordinates: [number, number][][] }
  const sampled = samplePolyline({
    parts: geometry.coordinates,
    minimumStepMetres: PATH_STEP_METRES,
    maximumSamples: 60_000,
  })

  const reachSquared = SIGHTLINE_RADIUS_METRES ** 2
  const inReach = sampled.samples.map((sample) =>
    works.some((work) => {
      const north = (sample.position.lat - work.position.lat) * METRES_PER_DEGREE_LATITUDE
      const east =
        (sample.position.lon - work.position.lon) *
        METRES_PER_DEGREE_LATITUDE *
        Math.cos((work.position.lat * Math.PI) / 180)
      return north * north + east * east < reachSquared
    }),
  )

  const runs = contiguousRuns(inReach, sampled.breaks)

  let sampleCount = 0
  let seenSamples = 0
  let watchedSamples = 0
  const blind: BlindStretch[] = []

  for (const run of runs) {
    const samples = sampled.samples.slice(run.start, run.end).map((sample) => ({
      distanceMetres: sample.distanceMetres,
      count: overlookedBy(ground.grid, ground.counts, sample.position),
    }))
    sampleCount += samples.length
    seenSamples += samples.filter((sample) => sample.count >= 1).length
    watchedSamples += samples.filter((sample) => sample.count >= 3).length
    const stretches = unwatchedStretches(
      samples.map((sample) => ({
        distanceMetres: sample.distanceMetres,
        isWatched: sample.count >= 1,
      })),
      MINIMUM_BLIND_METRES,
    )
    blind.push(
      ...stretches.map((stretch) => ({ ...stretch, runStart: run.start, runEnd: run.end })),
    )
  }

  return {
    lengthMetres: Math.round(sampleCount * PATH_STEP_METRES),
    seenShare: sampleCount === 0 ? 0 : roundTo(seenSamples / sampleCount, 3),
    watchedShare: sampleCount === 0 ? 0 : roundTo(watchedSamples / sampleCount, 3),
    blind,
    slice: (stretch) =>
      sampled.samples
        .slice(stretch.runStart, stretch.runEnd)
        .filter(
          (sample) =>
            sample.distanceMetres >= stretch.fromMetres &&
            sample.distanceMetres <= stretch.toMetres,
        )
        .map((sample) => [roundTo(sample.position.lon, 5), roundTo(sample.position.lat, 5)]),
  }
}

const linkState = (isDirect: boolean, isJoined: boolean): 'clear' | 'bridged' | 'broken' => {
  if (isDirect) return 'clear'
  return isJoined ? 'bridged' : 'broken'
}

interface LayerInputs {
  works: readonly Work[]
  links: readonly PairResult[]
  chain: ChainResult
  ground: GroundResult
  line: LineResult
  towers: readonly SectorWatchTower[]
}

/**
 * What is drawn: the two ground layers, the blind stretches, and the chain — each
 * tower's link to its neighbour along — with what crosses it.
 */
const buildLayers = (inputs: LayerInputs): GeoJSON.FeatureCollection => {
  const { works, links, chain, ground, line, towers } = inputs
  const features: GeoJSON.Feature[] = []

  if (ground.overlooked) {
    features.push({
      type: 'Feature',
      properties: { role: 'overlooked' },
      geometry: ground.overlooked,
    })
  }
  if (ground.watched) {
    features.push({ type: 'Feature', properties: { role: 'watched' }, geometry: ground.watched })
  }
  for (const stretch of line.blind) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'blind',
        lengthMetres: Math.round(stretch.toMetres - stretch.fromMetres),
      },
      geometry: { type: 'LineString', coordinates: line.slice(stretch) },
    })
  }

  const pairKey = (first: number, second: number): string =>
    first < second ? `${first}-${second}` : `${second}-${first}`
  const pairByKey = new Map(links.map((pair) => [pairKey(pair.first, pair.second), pair]))

  for (const edge of chain.edges) {
    const from = works[edge.from]!.position
    const to = works[edge.to]!.position
    const direct = pairByKey.get(pairKey(edge.from, edge.to))
    const isJoined = chain.centralComponents[edge.from] === chain.centralComponents[edge.to]
    features.push({
      type: 'Feature',
      properties: {
        // A direct clear sight line, a pair joined only round a blocked post, or a break.
        role: 'link',
        state: linkState(direct?.isClear.central === true, isJoined),
        lengthMetres: Math.round(edge.lengthMetres),
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [roundTo(from.lon, 5), roundTo(from.lat, 5)],
          [roundTo(to.lon, 5), roundTo(to.lat, 5)],
        ],
      },
    })
  }

  for (const tower of towers) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'tower',
        siteId: tower.id,
        title: tower.title,
        clearLinkCount: tower.clearLinkCount,
      },
      geometry: {
        type: 'Point',
        coordinates: [roundTo(tower.position.lon, 5), roundTo(tower.position.lat, 5)],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

const midpoint = (first: LonLat, second: LonLat): LonLat => ({
  lon: roundTo((first.lon + second.lon) / 2, 5),
  lat: roundTo((first.lat + second.lat) / 2, 5),
})

const analyseSector = async (sector: SectorRow): Promise<boolean> => {
  const rows = await loadTowers(sector.slug)
  const placed = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    position: { lon: row.lon, lat: row.lat },
  }))
  const { kept, foldedCount } = foldTwinTowers(placed, TWIN_THRESHOLD_METRES)

  if (kept.length < 2) {
    console.log(`${sector.slug}: ${kept.length} tower(s) — nothing to chain, skipped`)
    await sql`DELETE FROM limes_sector_sightlines WHERE sector_slug = ${sector.slug}`
    return false
  }
  console.log(
    `${sector.slug}: ${rows.length} records → ${kept.length} towers (${foldedCount} folded)`,
  )

  const { works, links, skippedTowerCount } = await walkTowers(walkOrder(kept))
  if (works.length < 2) {
    console.log(`${sector.slug}: terrain unavailable for too many towers, skipped`)
    return false
  }

  const chain = readChainOfTowers(works, links)
  const ground = await readGround(works)
  const line = readLine(sector.geometry, works, ground)

  const towers: SectorWatchTower[] = works.map((work, index) => ({
    id: work.id,
    slug: work.slug,
    title: work.title,
    position: work.position,
    clearLinkCount: chain.clearLinkCounts[index]!,
  }))

  const chainBreaks: SectorWatchBreak[] = chain.breaks
    .map((edge) => ({
      lengthMetres: Math.round(edge.lengthMetres),
      position: midpoint(works[edge.from]!.position, works[edge.to]!.position),
      fromSiteId: works[edge.from]!.id,
      fromTitle: works[edge.from]!.title,
      toSiteId: works[edge.to]!.id,
      toTitle: works[edge.to]!.title,
    }))
    .sort((first, second) => second.lengthMetres - first.lengthMetres)

  const blindStretches: SectorWatchBlind[] = line.blind
    .map((stretch) => {
      const slice = line.slice(stretch)
      const middle = slice[Math.floor(slice.length / 2)] ?? [0, 0]
      return {
        lengthMetres: Math.round(stretch.toMetres - stretch.fromMetres),
        position: { lon: middle[0], lat: middle[1] },
      }
    })
    .sort((first, second) => second.lengthMetres - first.lengthMetres)

  const summary: SectorWatchSummary = {
    sectorSlug: sector.slug,
    modelVersion: SIGHTLINE_MODEL_VERSION,
    computedAt: new Date().toISOString(),
    towerCount: works.length,
    foldedRecordCount: foldedCount,
    skippedTowerCount,
    chainLengthMetres: chain.chainLengthMetres,
    meanSpacingMetres:
      chain.edges.length === 0 ? 0 : Math.round(chain.chainLengthMetres / chain.edges.length),
    pairCount: links.length,
    linkRangeMetres: LINK_RANGE_METRES,
    recordGapCount: chain.gapEdges.length,
    chainCoverage: chain.chainCoverage,
    chainBreaks,
    lineLengthMetres: line.lengthMetres,
    lineSeenShare: line.seenShare,
    lineWatchedShare: line.watchedShare,
    blindStretches,
    overlookedAreaSquareKm: ground.overlookedAreaSquareKm,
    watchedAreaSquareKm: ground.watchedAreaSquareKm,
    towers,
  }
  const layers = buildLayers({ works, links, chain, ground, line, towers })

  await sql`
    INSERT INTO limes_sector_sightlines (sector_slug, model_version, computed_at, summary, layers)
    VALUES (
      ${sector.slug},
      ${SIGHTLINE_MODEL_VERSION},
      now(),
      ${sql.json(summary as unknown as postgres.JSONValue)},
      ${sql.json(layers as unknown as postgres.JSONValue)}
    )
    ON CONFLICT (sector_slug) DO UPDATE
      SET model_version = EXCLUDED.model_version,
          computed_at = EXCLUDED.computed_at,
          summary = EXCLUDED.summary,
          layers = EXCLUDED.layers
  `

  const { chainCoverage } = chain
  console.log(
    `  chain ${percent(chainCoverage.central)} (${percent(chainCoverage.low)}–${percent(chainCoverage.high)}) over ${Math.round(chain.chainLengthMetres / 1000)} km, ${chainBreaks.length} break(s), ${chain.gapEdges.length} record gap(s); ` +
      `line ${Math.round(line.lengthMetres / 1000)} km in reach: seen ${percent(line.seenShare)}, 3+ ${percent(line.watchedShare)}, ${blindStretches.length} blind; ` +
      `overlooked ${ground.overlookedAreaSquareKm} km², layers ${Math.round(JSON.stringify(layers).length / 1024)} KB`,
  )
  return true
}

const main = async (): Promise<void> => {
  const slugs = process.argv.slice(2)
  const sectors = await loadSectors(slugs)
  if (sectors.length === 0) {
    console.error(slugs.length > 0 ? `No such sector: ${slugs.join(', ')}` : 'No sectors loaded.')
    process.exitCode = 1
    return
  }
  let built = 0
  for (const sector of sectors) {
    if (await analyseSector(sector)) built++
  }
  console.log(`Done: ${built} of ${sectors.length} sector(s) written.`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end())
