import type { BoundingBox, LonLat } from '../types'
import { isSeenAt } from './seen-grid'

/**
 * What the towers of a frontier sector could do together, as arithmetic over
 * their individual answers: which records are one post, where a signal could not
 * cross, how many towers overlook each patch of ground. Pure — the script that
 * walks the terrain hands in what each tower saw and takes out numbers and
 * rectangles. See `.claude/rules/sightlines.md`.
 */

const METRES_PER_DEGREE_LATITUDE = 111_320

/** A tower, as the analysis needs it. */
export interface PlacedTower {
  id: number
  position: LonLat
}

export const metresBetweenPositions = (from: LonLat, to: LonLat): number => {
  const north = (to.lat - from.lat) * METRES_PER_DEGREE_LATITUDE
  const east =
    (to.lon - from.lon) *
    METRES_PER_DEGREE_LATITUDE *
    Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180)
  return Math.hypot(north, east)
}

/**
 * Twin records — a timber post and the stone tower built over it are two records
 * eighteen metres apart (Turm 15-25a and 15-25b) — are one place to stand. Two
 * records closer than `thresholdMetres` fold into the earlier one (by id), so a
 * pair of eighteen metres that is always clear and tells nothing does not become
 * a link, and one post is not counted twice in every share.
 */
export const foldTwinTowers = <T extends PlacedTower>(
  towers: readonly T[],
  thresholdMetres: number,
): { kept: T[]; foldedCount: number } => {
  const ordered = [...towers].sort((first, second) => first.id - second.id)
  const kept: T[] = []
  let foldedCount = 0

  for (const tower of ordered) {
    const twin = kept.find(
      (candidate) => metresBetweenPositions(candidate.position, tower.position) <= thresholdMetres,
    )
    if (twin) {
      foldedCount++
    } else {
      kept.push(tower)
    }
  }
  return { kept, foldedCount }
}

export interface Stretch {
  fromMetres: number
  toMetres: number
}

export interface TowerEdge {
  /** Indexes into the tower list. */
  from: number
  to: number
  lengthMetres: number
}

/**
 * The shortest set of edges that joins every tower — a minimum spanning tree —
 * leaving out any edge longer than `maximumMetres`, which is a gap in the
 * records, not a link to try. For a frontier of towers it is the line itself:
 * each tower to its neighbour along, with a branch where two lines run side by
 * side. It is what "the next tower along" means when the towers have no order of
 * their own (a sector's path covers only its longest run, so a position along it
 * is clamped to zero for everything beyond).
 *
 * Prim's algorithm, O(n²): a sector has hundreds of towers, not millions.
 */
export const spanningEdges = (
  positions: readonly LonLat[],
  maximumMetres: number,
): { edges: TowerEdge[]; gapEdges: TowerEdge[] } => {
  const count = positions.length
  const edges: TowerEdge[] = []
  const gapEdges: TowerEdge[] = []
  if (count < 2) return { edges, gapEdges }

  const inTree = new Array<boolean>(count).fill(false)
  const bestLength = new Array<number>(count).fill(Number.POSITIVE_INFINITY)
  const bestFrom = new Array<number>(count).fill(-1)
  bestLength[0] = 0

  /** The tower outside the tree that is nearest to it. */
  const nearestOutside = (): number => {
    let nearest = -1
    for (let index = 0; index < count; index++) {
      if (inTree[index]) continue
      if (nearest === -1 || bestLength[index]! < bestLength[nearest]!) nearest = index
    }
    return nearest
  }

  /** Lets a newly added tower offer itself as the nearest member to the others. */
  const offerFrom = (added: number): void => {
    for (let index = 0; index < count; index++) {
      if (inTree[index]) continue
      const length = metresBetweenPositions(positions[added]!, positions[index]!)
      if (length >= bestLength[index]!) continue
      bestLength[index] = length
      bestFrom[index] = added
    }
  }

  for (let step = 0; step < count; step++) {
    const next = nearestOutside()
    inTree[next] = true

    const from = bestFrom[next]!
    if (from >= 0) {
      const edge = { from, to: next, lengthMetres: bestLength[next]! }
      ;(edge.lengthMetres <= maximumMetres ? edges : gapEdges).push(edge)
    }
    offerFrom(next)
  }
  return { edges, gapEdges }
}

/** Connected components of the graph whose edges are the clear links; one id per node. */
export const componentsOf = (
  count: number,
  clearPairs: readonly { from: number; to: number }[],
): number[] => {
  const parent = Array.from({ length: count }, (_value, index) => index)
  const find = (node: number): number => {
    let root = node
    while (parent[root] !== root) root = parent[root]!
    // Path compression, so a long chain does not make every lookup a walk.
    let walker = node
    while (parent[walker] !== root) {
      const following = parent[walker]!
      parent[walker] = root
      walker = following
    }
    return root
  }
  for (const pair of clearPairs) {
    const first = find(pair.from)
    const second = find(pair.to)
    if (first !== second) parent[first] = second
  }
  return Array.from({ length: count }, (_value, index) => find(index))
}

export interface ChainReading {
  /** Metres of spanning edges whose two towers are joined by clear links. */
  coveredMetres: number
  /** Metres of spanning edges in all (those within range). */
  totalMetres: number
  /** The edges whose towers no chain of clear links joins. */
  breaks: TowerEdge[]
}

/**
 * Could a signal pass along the line? Each spanning edge is a stretch of the
 * frontier between two neighbouring towers; it is covered when the two are in
 * one component of the clear-link graph — directly, or round a blocked pair by
 * way of a longer clear link, which is how a real chain of beacons skips a
 * post in a hollow. The ones that are not are the breaks.
 */
export const readChain = (
  edges: readonly TowerEdge[],
  componentOf: readonly number[],
): ChainReading => {
  let coveredMetres = 0
  let totalMetres = 0
  const breaks: TowerEdge[] = []
  for (const edge of edges) {
    totalMetres += edge.lengthMetres
    if (componentOf[edge.from] === componentOf[edge.to]) {
      coveredMetres += edge.lengthMetres
    } else {
      breaks.push(edge)
    }
  }
  return { coveredMetres, totalMetres, breaks }
}

/** A regular longitude/latitude grid over a box, cells about `cellMetres` square. */
export interface CoverageGrid {
  west: number
  south: number
  columns: number
  rows: number
  cellLongitude: number
  cellLatitude: number
}

export const makeCoverageGrid = (bounds: BoundingBox, cellMetres: number): CoverageGrid => {
  const middleLatitude = (bounds.north + bounds.south) / 2
  const cellLatitude = cellMetres / METRES_PER_DEGREE_LATITUDE
  const cellLongitude = cellLatitude / Math.max(Math.cos((middleLatitude * Math.PI) / 180), 0.1)
  return {
    west: bounds.west,
    south: bounds.south,
    columns: Math.max(1, Math.ceil((bounds.east - bounds.west) / cellLongitude)),
    rows: Math.max(1, Math.ceil((bounds.north - bounds.south) / cellLatitude)),
    cellLongitude,
    cellLatitude,
  }
}

export const cellOf = (
  grid: CoverageGrid,
  position: LonLat,
): { column: number; row: number } | null => {
  const column = Math.floor((position.lon - grid.west) / grid.cellLongitude)
  const row = Math.floor((position.lat - grid.south) / grid.cellLatitude)
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return null
  return { column, row }
}

/** What one tower saw, as the polar cells of its answer. */
export interface TowerCoverage {
  position: LonLat
  cells: Uint8Array
  shape: { columns: number; binMetres: number; binCount: number }
}

/**
 * Adds one to every grid cell the tower sees. Only the window the tower can
 * reach is visited, so a sector of three hundred towers costs three hundred
 * windows, not three hundred passes over the sector.
 */
export const addTowerCoverage = (
  grid: CoverageGrid,
  counts: Uint8Array,
  tower: TowerCoverage,
): void => {
  const reach = tower.shape.binCount * tower.shape.binMetres
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((tower.position.lat * Math.PI) / 180)

  const reachLatitude = reach / METRES_PER_DEGREE_LATITUDE
  const reachLongitude = reach / metresPerDegreeLongitude
  const firstColumn = Math.max(
    0,
    Math.floor((tower.position.lon - reachLongitude - grid.west) / grid.cellLongitude),
  )
  const lastColumn = Math.min(
    grid.columns - 1,
    Math.floor((tower.position.lon + reachLongitude - grid.west) / grid.cellLongitude),
  )
  const firstRow = Math.max(
    0,
    Math.floor((tower.position.lat - reachLatitude - grid.south) / grid.cellLatitude),
  )
  const lastRow = Math.min(
    grid.rows - 1,
    Math.floor((tower.position.lat + reachLatitude - grid.south) / grid.cellLatitude),
  )

  for (let row = firstRow; row <= lastRow; row++) {
    const latitude = grid.south + (row + 0.5) * grid.cellLatitude
    const north = (latitude - tower.position.lat) * METRES_PER_DEGREE_LATITUDE
    for (let column = firstColumn; column <= lastColumn; column++) {
      const longitude = grid.west + (column + 0.5) * grid.cellLongitude
      const east = (longitude - tower.position.lon) * metresPerDegreeLongitude
      const distanceMetres = Math.hypot(north, east)
      if (distanceMetres >= reach) continue
      const bearingDegrees = (Math.atan2(east, north) * 180) / Math.PI
      if (isSeenAt(tower.cells, tower.shape, { bearingDegrees, distanceMetres })) {
        const index = row * grid.columns + column
        if (counts[index]! < 255) counts[index]!++
      }
    }
  }
}

/** How many towers overlook the cell a position falls in; 0 outside the grid. */
export const overlookedBy = (grid: CoverageGrid, counts: Uint8Array, position: LonLat): number => {
  const cell = cellOf(grid, position)
  return cell ? counts[cell.row * grid.columns + cell.column]! : 0
}

export interface GridRectangle {
  west: number
  south: number
  east: number
  north: number
}

interface OpenRun {
  firstColumn: number
  lastColumn: number
  firstRow: number
  lastRow: number
}

/** The runs of at-least-`minimum` cells in one row, as column ranges. */
const runsInRow = (
  grid: CoverageGrid,
  counts: Uint8Array,
  place: { row: number; minimum: number },
): { first: number; last: number }[] => {
  const { row, minimum } = place
  const runs: { first: number; last: number }[] = []
  let start = -1
  for (let column = 0; column <= grid.columns; column++) {
    const isOn = column < grid.columns && counts[row * grid.columns + column]! >= minimum
    if (isOn && start < 0) start = column
    if (!isOn && start >= 0) {
      runs.push({ first: start, last: column - 1 })
      start = -1
    }
  }
  return runs
}

/**
 * The cells overlooked by at least `minimum` towers, as rectangles: horizontal
 * runs, each merged with the identical run above it, so a filled block is one
 * rectangle and the union PostGIS then takes has thousands of inputs, not
 * hundreds of thousands.
 */
export const rectanglesAtLeast = (
  grid: CoverageGrid,
  counts: Uint8Array,
  minimum: number,
): GridRectangle[] => {
  const rectangles: GridRectangle[] = []
  let open = new Map<string, OpenRun>()

  for (let row = 0; row < grid.rows; row++) {
    const next = new Map<string, OpenRun>()

    for (const run of runsInRow(grid, counts, { row, minimum })) {
      const key = `${run.first}-${run.last}`
      // The identical run in the row above continues; anything else starts afresh.
      const continued = open.get(key)
      if (continued) {
        continued.lastRow = row
        next.set(key, continued)
      } else {
        next.set(key, { firstColumn: run.first, lastColumn: run.last, firstRow: row, lastRow: row })
      }
    }

    // Whatever was open and did not continue into this row is finished.
    for (const [key, finished] of open) {
      if (!next.has(key)) rectangles.push(toRectangle(grid, finished))
    }
    open = next
  }
  for (const finished of open.values()) rectangles.push(toRectangle(grid, finished))
  return rectangles
}

const toRectangle = (
  grid: CoverageGrid,
  cells: { firstColumn: number; lastColumn: number; firstRow: number; lastRow: number },
): GridRectangle => ({
  west: grid.west + cells.firstColumn * grid.cellLongitude,
  east: grid.west + (cells.lastColumn + 1) * grid.cellLongitude,
  south: grid.south + cells.firstRow * grid.cellLatitude,
  north: grid.south + (cells.lastRow + 1) * grid.cellLatitude,
})

/** A MultiPolygon in WKT, for PostGIS to dissolve. */
export const rectanglesToWkt = (rectangles: readonly GridRectangle[]): string => {
  if (rectangles.length === 0) return 'MULTIPOLYGON EMPTY'
  const ring = (box: GridRectangle): string =>
    `((${box.west} ${box.south},${box.east} ${box.south},${box.east} ${box.north},${box.west} ${box.north},${box.west} ${box.south}))`
  return `MULTIPOLYGON(${rectangles.map(ring).join(',')})`
}

export interface SampleRun {
  start: number
  /** One past the last sample of the run. */
  end: number
}

/**
 * Runs of consecutive `true` flags, split wherever a part of the line ends and the
 * next begins (`partStarts`: the sample indexes at which a further part begins).
 *
 * The seam matters: the last sample of one part and the first of the next are
 * neighbours in the list and may be a hundred kilometres apart on the ground. A
 * run that crossed it is drawn as a chord — which is what the first version of
 * the blind stretches did, a 150 km line across Raetia for a 400 m finding.
 */
export const contiguousRuns = (
  flags: readonly boolean[],
  partStarts: readonly number[],
): SampleRun[] => {
  const seams = new Set(partStarts)
  const runs: SampleRun[] = []
  let start = -1

  flags.forEach((flag, index) => {
    if (start >= 0 && (!flag || seams.has(index))) {
      runs.push({ start, end: index })
      start = -1
    }
    if (flag && start < 0) start = index
  })
  if (start >= 0) runs.push({ start, end: flags.length })
  return runs
}

/**
 * Runs of consecutive samples along the line for which `isWatched` is false:
 * the stretches nothing overlooks, as metres along the line, with the short ones
 * (under `minimumLengthMetres`) dropped as noise in the terrain model.
 */
export const unwatchedStretches = (
  samples: readonly { distanceMetres: number; isWatched: boolean }[],
  minimumLengthMetres: number,
): Stretch[] => {
  const stretches: Stretch[] = []
  let start: number | null = null
  let lastDistance = 0

  for (const sample of samples) {
    if (!sample.isWatched && start === null) start = sample.distanceMetres
    if (sample.isWatched && start !== null) {
      stretches.push({ fromMetres: start, toMetres: sample.distanceMetres })
      start = null
    }
    lastDistance = sample.distanceMetres
  }
  if (start !== null) stretches.push({ fromMetres: start, toMetres: lastDistance })

  return stretches.filter((stretch) => stretch.toMetres - stretch.fromMetres >= minimumLengthMetres)
}
