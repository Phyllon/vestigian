/**
 * Spreading markers that lie on top of one another into a small raster.
 *
 * Pure screen-space geometry, so it can be tested without a map: the caller
 * projects the markers to pixels, hands them in with the pixel width of one
 * marker, and gets back where each overlapping marker should be drawn and how
 * much smaller to draw it. Nothing here knows about MapLibre or the tile format.
 *
 * - **Who is grouped.** Markers whose discs would overlap (centres closer than
 *   one `cellSize`) form a group. Grouping is by reach from a group's first
 *   member, not by chaining, so a group's true spread stays within one cell and
 *   the displacement it causes stays bounded however dense the data is.
 * - **What shape.** Up to `RING_MEMBER_LIMIT` members sit on a circle, more fill
 *   a square grid. Members keep their compass order, so a marker west of the
 *   group's centre is drawn west of it and the hairlines back to the true
 *   positions rarely cross.
 * - **How small.** The icons shrink until the members no longer overlap one
 *   another, down to `MIN_SCALE`, below which a mark stops being readable and
 *   the group grows instead.
 * - **Neighbouring groups.** Two groups whose footprints overlap are merged and
 *   laid out again, so a dense district does not become a sheet of overlapping
 *   rings. Two limits stop a continuous built-up area from collapsing into one
 *   enormous grid: at most `MERGE_MEMBER_LIMIT` members, and every member within
 *   `MERGE_MAX_SPREAD` cells of the merged group's centre — a chain of markers
 *   each touching the next would otherwise be drawn far from where it is. Past
 *   those limits some overlap is left between neighbouring groups.
 * - **What is left over.** Groups that still touch their neighbours are
 *   settled by relaxation: every pair of overlapping icons is pushed apart,
 *   each icon is drawn back gently towards its slot so a district does not
 *   drift, and an icon that still cannot fit is shrunk — locally, only where it
 *   overlaps — down to `MIN_SCALE`. What remains is a jammed spot too dense for
 *   readable icons at this zoom, which zooming resolves.
 *
 * Markers that overlap nothing are not returned — they stay where they are.
 */

export interface ArrangementMarker {
  id: number
  /** Screen position, in CSS pixels. */
  x: number
  y: number
}

export interface ArrangedMarker {
  id: number
  /** Where to draw it, in the same pixel space it came from. */
  x: number
  y: number
  /** Fraction of the marker's normal size, `MIN_SCALE` to 1. */
  scale: number
}

export interface ArrangementOptions {
  /** The width of one marker at full size, in pixels. */
  cellSize: number
}

/** More members than this and a ring gets too wide for its icons; a grid takes over. */
export const RING_MEMBER_LIMIT = 8
/** A ring's radius is held to this many cells, so a large ring shrinks its icons instead of widening. */
const RING_MAX_RADIUS = 0.85
/** A grid's side is held to this many cells, for the same reason. */
const GRID_MAX_EXTENT = 2.6
/** The smallest an icon is drawn. Below it a group grows rather than its icons shrinking further. */
export const MIN_SCALE = 0.3
/** The most members two groups may be merged into. */
export const MERGE_MEMBER_LIMIT = 25
/** How far, in cells, a merged group's true members may lie from its centre. */
export const MERGE_MAX_SPREAD = 1.25
const MERGE_PASSES = 3
/** Rounds of push-apart per shrink step, and how many shrink steps are taken. */
const RELAX_ITERATIONS = 8
const SHRINK_ROUNDS = 3
/** Each shrink step multiplies an overlapping icon's size by this. */
const SHRINK_FACTOR = 0.8
/** How much of an overlap is undone per iteration, shared between the two icons. */
const PUSH_STIFFNESS = 0.6
/** How much of the distance back to its slot an icon recovers per iteration. */
const SPRING_STRENGTH = 0.05
/** Two icons exactly touching are not overlapping; this absorbs floating-point noise. */
const TOUCHING_EPSILON = 1e-6
/** An overlap deeper than this fraction of the smaller icon is worth shrinking for. */
const OVERLAP_TOLERANCE = 0.12
/** A marker that ended up this close to where it is, at full size, is left to the tile layer. */
const UNMOVED_PIXELS = 0.5

interface Point {
  x: number
  y: number
}

interface Group {
  members: ArrangementMarker[]
  centre: Point
  scale: number
  /** Radius of the circle the arranged group occupies, icons included. */
  radius: number
  /** Parallel to `ordered`: where each member goes, relative to `centre`. */
  ordered: ArrangementMarker[]
  offsets: Point[]
}

const meanOf = (members: ArrangementMarker[]): Point => ({
  x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
  y: members.reduce((sum, member) => sum + member.y, 0) / members.length,
})

const byId = (first: ArrangementMarker, second: ArrangementMarker): number => first.id - second.id

const clamp = (value: number, lowest: number, highest: number): number =>
  Math.min(highest, Math.max(lowest, value))

const singleton = (member: ArrangementMarker, cellSize: number): Group => ({
  members: [member],
  centre: { x: member.x, y: member.y },
  scale: 1,
  radius: cellSize / 2,
  ordered: [member],
  offsets: [{ x: 0, y: 0 }],
})

const layoutRing = (members: ArrangementMarker[], cellSize: number): Group => {
  const centre = meanOf(members)
  const count = members.length
  // The radius at which `count` full-size icons just touch along the circle.
  const fullRadius = cellSize / (2 * Math.sin(Math.PI / count))
  const scale = Math.min(1, (RING_MAX_RADIUS * cellSize) / fullRadius)
  const radius = fullRadius * scale

  const ordered = members
    .map((member) => ({ member, bearing: Math.atan2(member.y - centre.y, member.x - centre.x) }))
    .sort((first, second) => first.bearing - second.bearing || byId(first.member, second.member))

  const start = ordered[0]!.bearing
  const offsets = ordered.map((_, index) => {
    const angle = start + (2 * Math.PI * index) / count
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  })

  return {
    members,
    centre,
    scale,
    radius: radius + (scale * cellSize) / 2,
    ordered: ordered.map((entry) => entry.member),
    offsets,
  }
}

const layoutGrid = (members: ArrangementMarker[], cellSize: number): Group => {
  const centre = meanOf(members)
  const columns = Math.ceil(Math.sqrt(members.length))
  const rows = Math.ceil(members.length / columns)
  const scale = clamp(GRID_MAX_EXTENT / columns, MIN_SCALE, 1)
  const pitch = scale * cellSize

  // North to south into rows, then west to east within each, so the raster
  // reads like the ground does.
  const southward = [...members].sort((first, second) => first.y - second.y || byId(first, second))
  const ordered: ArrangementMarker[] = []
  const offsets: Point[] = []

  for (let row = 0; row < rows; row++) {
    const line = southward
      .slice(row * columns, (row + 1) * columns)
      .sort((first, second) => first.x - second.x || byId(first, second))

    line.forEach((member, column) => {
      ordered.push(member)
      offsets.push({
        x: (column - (line.length - 1) / 2) * pitch,
        y: (row - (rows - 1) / 2) * pitch,
      })
    })
  }

  return {
    members,
    centre,
    scale,
    radius: Math.hypot(columns * pitch, rows * pitch) / 2,
    ordered,
    offsets,
  }
}

const layoutGroup = (members: ArrangementMarker[], cellSize: number): Group => {
  if (members.length === 1) return singleton(members[0]!, cellSize)
  return members.length <= RING_MEMBER_LIMIT
    ? layoutRing(members, cellSize)
    : layoutGrid(members, cellSize)
}

const NEIGHBOURHOOD = [-1, 0, 1]

interface CellIndex {
  add: (index: number, point: Point) => void
  /** Everything filed in the cell of `point` and the eight around it. */
  around: (point: Point) => number[]
}

/** A hash of points into square cells `reach` wide, so a neighbour search never scans everything. */
const createCellIndex = (reach: number): CellIndex => {
  const indicesByCell = new Map<string, number[]>()
  const cellOf = (point: Point) => ({
    column: Math.floor(point.x / reach),
    row: Math.floor(point.y / reach),
  })
  const keyOf = (column: number, row: number): string => `${column}:${row}`

  const add = (index: number, point: Point): void => {
    const { column, row } = cellOf(point)
    const key = keyOf(column, row)
    const existing = indicesByCell.get(key)
    if (existing) existing.push(index)
    else indicesByCell.set(key, [index])
  }

  const around = (point: Point): number[] => {
    const { column, row } = cellOf(point)
    return NEIGHBOURHOOD.flatMap((columnShift) =>
      NEIGHBOURHOOD.flatMap(
        (rowShift) => indicesByCell.get(keyOf(column + columnShift, row + rowShift)) ?? [],
      ),
    )
  }

  return { add, around }
}

/**
 * Greedy grouping by reach from each group's first member, in id order so the
 * outcome does not depend on the order the tiles happened to deliver features.
 */
const groupByReach = (markers: ArrangementMarker[], reach: number): ArrangementMarker[][] => {
  const groups: ArrangementMarker[][] = []
  const leaders = createCellIndex(reach)

  const nearestGroup = (marker: ArrangementMarker): number => {
    let nearest = -1
    let nearestDistance = reach

    for (const index of leaders.around(marker)) {
      const leader = groups[index]![0]!
      const distance = Math.hypot(leader.x - marker.x, leader.y - marker.y)
      if (distance < nearestDistance) {
        nearest = index
        nearestDistance = distance
      }
    }

    return nearest
  }

  for (const marker of [...markers].sort(byId)) {
    const nearest = nearestGroup(marker)

    if (nearest >= 0) {
      groups[nearest]!.push(marker)
      continue
    }

    groups.push([marker])
    leaders.add(groups.length - 1, marker)
  }

  return groups
}

interface MergeCandidate {
  first: number
  second: number
  distance: number
}

/** Every pair of groups whose footprints overlap, once each. */
const findOverlappingPairs = (groups: Group[], cellSize: number): MergeCandidate[] => {
  const widest = groups.reduce((largest, group) => Math.max(largest, group.radius), 0)
  const cells = createCellIndex(Math.max(2 * widest, cellSize))
  groups.forEach((group, index) => cells.add(index, group.centre))

  return groups.flatMap((group, first) =>
    cells
      .around(group.centre)
      .filter((second) => second > first)
      .map((second) => ({
        first,
        second,
        distance: Math.hypot(
          group.centre.x - groups[second]!.centre.x,
          group.centre.y - groups[second]!.centre.y,
        ),
      }))
      .filter(({ second, distance }) => distance < group.radius + groups[second]!.radius),
  )
}

/** Whether `members` may be drawn as one group: few enough, and close enough, that moving them stays local. */
const canMerge = (members: ArrangementMarker[], cellSize: number): boolean => {
  if (members.length > MERGE_MEMBER_LIMIT) return false
  const centre = meanOf(members)
  return members.every(
    (member) => Math.hypot(member.x - centre.x, member.y - centre.y) <= MERGE_MAX_SPREAD * cellSize,
  )
}

/** One round of merging groups whose footprints overlap, closest pairs first. */
const mergeOnce = (groups: Group[], cellSize: number): Group[] => {
  const candidates = findOverlappingPairs(groups, cellSize)
  if (candidates.length === 0) return groups

  candidates.sort(
    (left, right) =>
      left.distance - right.distance || left.first - right.first || left.second - right.second,
  )

  const parent = groups.map((_, index) => index)
  const membersOf = groups.map((group) => group.members)

  const root = (index: number): number => {
    let current = index
    while (parent[current] !== current) current = parent[current]!
    return current
  }

  for (const { first, second } of candidates) {
    const firstRoot = root(first)
    const secondRoot = root(second)
    if (firstRoot === secondRoot) continue

    const combined = [...membersOf[firstRoot]!, ...membersOf[secondRoot]!]
    if (!canMerge(combined, cellSize)) continue

    parent[secondRoot] = firstRoot
    membersOf[firstRoot] = combined
  }

  const membersByRoot = new Map<number, ArrangementMarker[]>()
  groups.forEach((group, index) => {
    const key = root(index)
    const members = membersByRoot.get(key)
    if (members) members.push(...group.members)
    else membersByRoot.set(key, [...group.members])
  })

  return [...membersByRoot.values()].map((members) => layoutGroup(members, cellSize))
}

const mergeOverlapping = (groups: Group[], cellSize: number): Group[] => {
  let current = groups
  for (let pass = 0; pass < MERGE_PASSES; pass++) {
    const merged = mergeOnce(current, cellSize)
    if (merged.length === current.length) return merged
    current = merged
  }
  return current
}

/** One icon during relaxation. */
interface Body {
  id: number
  x: number
  y: number
  /** Its slot in the ring or grid, which relaxation is drawn back towards. */
  homeX: number
  homeY: number
  /** Where the record really is. */
  trueX: number
  trueY: number
  groupScale: number
  /** 1 until the icon has had to shrink further than its group's scale. */
  shrink: number
}

const radiusOf = (body: Body, cellSize: number): number =>
  (body.groupScale * body.shrink * cellSize) / 2

const bodiesOf = (groups: Group[]): Body[] =>
  groups
    .flatMap((group) =>
      group.ordered.map((member, index) => {
        const homeX = group.centre.x + group.offsets[index]!.x
        const homeY = group.centre.y + group.offsets[index]!.y
        return {
          id: member.id,
          x: homeX,
          y: homeY,
          homeX,
          homeY,
          trueX: member.x,
          trueY: member.y,
          groupScale: group.scale,
          shrink: 1,
        }
      }),
    )
    .sort((first, second) => first.id - second.id)

interface Contact {
  first: number
  second: number
  /** How far the two icons run into each other. */
  depth: number
  /** Unit vector from `second` towards `first`. */
  towardX: number
  towardY: number
  /** The smaller of the two icons' widths. */
  smaller: number
}

interface PlacedBodies {
  bodies: Body[]
  cellSize: number
}

/** The icons binned into a plain grid, as typed arrays for the contact scan. */
interface BodyGrid {
  count: number
  columns: number
  rows: number
  ids: Float64Array
  xs: Float64Array
  ys: Float64Array
  radii: Float64Array
  /** The grid cell each icon is in. */
  cellOf: Int32Array
  /** `members[start[cell]]` up to `members[start[cell + 1]]` are the icons in `cell`. */
  start: Int32Array
  members: Int32Array
}

/**
 * Bins the icons by counting sort. A cell is at least `cellSize` wide and no
 * icon is wider than that, so the eight cells around an icon hold every icon it
 * can touch — finding the neighbours of one is nine array lookups.
 */
const binBodies = (placed: PlacedBodies): BodyGrid => {
  const { bodies, cellSize } = placed
  const count = bodies.length

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const body of bodies) {
    minX = Math.min(minX, body.x)
    minY = Math.min(minY, body.y)
    maxX = Math.max(maxX, body.x)
    maxY = Math.max(maxY, body.y)
  }

  // Never more than about a million cells, however far apart the icons lie.
  const cell = Math.max(cellSize, Math.sqrt(((maxX - minX) * (maxY - minY)) / 1_000_000))
  const columns = Math.floor((maxX - minX) / cell) + 1
  const rows = Math.floor((maxY - minY) / cell) + 1

  const grid: BodyGrid = {
    count,
    columns,
    rows,
    ids: new Float64Array(count),
    xs: new Float64Array(count),
    ys: new Float64Array(count),
    radii: new Float64Array(count),
    cellOf: new Int32Array(count),
    start: new Int32Array(columns * rows + 1),
    members: new Int32Array(count),
  }

  bodies.forEach((body, index) => {
    grid.ids[index] = body.id
    grid.xs[index] = body.x
    grid.ys[index] = body.y
    grid.radii[index] = radiusOf(body, cellSize)
    const column = Math.floor((body.x - minX) / cell)
    const row = Math.floor((body.y - minY) / cell)
    grid.cellOf[index] = row * columns + column
    grid.start[grid.cellOf[index]! + 1]!++
  })
  for (let index = 0; index < columns * rows; index++) grid.start[index + 1]! += grid.start[index]!

  const fill = grid.start.slice(0, columns * rows)
  for (let index = 0; index < count; index++) {
    grid.members[fill[grid.cellOf[index]!]!++] = index
  }

  return grid
}

/** Writes the up-to-nine cells around and including `cell` into `into`; returns how many. */
const collectNeighbourCells = (grid: BodyGrid, cell: number, into: Int32Array): number => {
  const column = cell % grid.columns
  const row = (cell - column) / grid.columns
  let found = 0

  for (let nearRow = Math.max(0, row - 1); nearRow <= Math.min(grid.rows - 1, row + 1); nearRow++) {
    for (
      let nearColumn = Math.max(0, column - 1);
      nearColumn <= Math.min(grid.columns - 1, column + 1);
      nearColumn++
    ) {
      into[found++] = nearRow * grid.columns + nearColumn
    }
  }

  return found
}

/**
 * Fills `contact` and returns true when icons `first` and `second` overlap.
 * Squared distances decide, and the root is taken only for a real contact.
 */
const measureContact = (
  grid: BodyGrid,
  pair: { first: number; second: number },
  contact: Contact,
): boolean => {
  const { first, second } = pair
  const dx = grid.xs[first]! - grid.xs[second]!
  const dy = grid.ys[first]! - grid.ys[second]!
  const reachApart = grid.radii[first]! + grid.radii[second]!
  const squared = dx * dx + dy * dy
  if (squared >= (reachApart - TOUCHING_EPSILON) ** 2) return false

  const distance = Math.sqrt(squared)
  contact.first = first
  contact.second = second
  contact.depth = reachApart - distance
  contact.smaller = 2 * Math.min(grid.radii[first]!, grid.radii[second]!)

  if (distance > 1e-6) {
    contact.towardX = dx / distance
    contact.towardY = dy / distance
    return true
  }

  // Two icons on exactly the same spot have no direction to part in; the ids
  // give a fixed one, so the same data always parts the same way.
  const angle = (grid.ids[first]! * 2.399963 + grid.ids[second]! * 1.618034) % (2 * Math.PI)
  contact.towardX = Math.cos(angle)
  contact.towardY = Math.sin(angle)
  return true
}

/**
 * Calls `visit` for every pair of icons that overlap, with one `Contact` object
 * that is reused between calls — this runs a few dozen times over thousands of
 * icons, and allocating a record per pair was most of its cost.
 */
const forEachContact = (placed: PlacedBodies, visit: (contact: Contact) => void): void => {
  if (placed.bodies.length < 2) return

  const grid = binBodies(placed)
  const contact: Contact = { first: 0, second: 0, depth: 0, towardX: 0, towardY: 0, smaller: 0 }
  const nearCells = new Int32Array(9)

  for (let first = 0; first < grid.count; first++) {
    const found = collectNeighbourCells(grid, grid.cellOf[first]!, nearCells)

    for (let nearIndex = 0; nearIndex < found; nearIndex++) {
      const nearCell = nearCells[nearIndex]!
      for (let slot = grid.start[nearCell]!; slot < grid.start[nearCell + 1]!; slot++) {
        const second = grid.members[slot]!
        if (second > first && measureContact(grid, { first, second }, contact)) visit(contact)
      }
    }
  }
}

/** Pushes overlapping icons apart and draws each back towards its slot. */
const relaxBodies = (placed: PlacedBodies): void => {
  const { bodies } = placed
  const shiftX = new Float64Array(bodies.length)
  const shiftY = new Float64Array(bodies.length)

  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration++) {
    shiftX.fill(0)
    shiftY.fill(0)
    let contacts = 0

    forEachContact(placed, (contact) => {
      contacts++
      const push = (contact.depth * PUSH_STIFFNESS) / 2
      shiftX[contact.first]! += contact.towardX * push
      shiftY[contact.first]! += contact.towardY * push
      shiftX[contact.second]! -= contact.towardX * push
      shiftY[contact.second]! -= contact.towardY * push
    })
    if (contacts === 0) return

    bodies.forEach((body, index) => {
      body.x += shiftX[index]!
      body.y += shiftY[index]!
      body.x += (body.homeX - body.x) * SPRING_STRENGTH
      body.y += (body.homeY - body.y) * SPRING_STRENGTH
    })
  }
}

/**
 * Relaxes, then shrinks whichever icons still overlap one another by more than
 * the tolerance, and relaxes again — each icon only as far as its own
 * neighbourhood needs, so one crowded corner does not shrink the district.
 */
const settleBodies = (placed: PlacedBodies): void => {
  for (let round = 0; round <= SHRINK_ROUNDS; round++) {
    relaxBodies(placed)
    if (round === SHRINK_ROUNDS) return

    // Only an icon that can still get smaller counts. A jammed spot whose icons
    // are all at the floor would otherwise keep every round running to no end.
    const crowded = new Set<number>()
    forEachContact(placed, (contact) => {
      if (contact.depth <= contact.smaller * OVERLAP_TOLERANCE) return
      for (const index of [contact.first, contact.second]) {
        const body = placed.bodies[index]!
        if (body.groupScale * body.shrink > MIN_SCALE + 1e-9) crowded.add(index)
      }
    })
    if (crowded.size === 0) return

    for (const index of crowded) {
      const body = placed.bodies[index]!
      const floor = MIN_SCALE / body.groupScale
      body.shrink = Math.max(floor, body.shrink * SHRINK_FACTOR)
    }
  }
}

/**
 * Where to draw each marker that overlaps another, and at what fraction of its
 * normal size. Markers that sit clear of every other are absent from the result.
 * Deterministic: the same markers in any order give the same arrangement.
 */
export const arrangeMarkers = (
  markers: ArrangementMarker[],
  options: ArrangementOptions,
): ArrangedMarker[] => {
  if (markers.length < 2 || options.cellSize <= 0) return []
  const { cellSize } = options

  const groups = mergeOverlapping(
    groupByReach(markers, cellSize).map((members) => layoutGroup(members, cellSize)),
    cellSize,
  )
  if (groups.every((group) => group.members.length === 1)) return []

  const bodies = bodiesOf(groups)
  settleBodies({ bodies, cellSize })

  return bodies
    .map((body) => ({
      id: body.id,
      x: body.x,
      y: body.y,
      scale: body.groupScale * body.shrink,
    }))
    .filter((arranged, index) => {
      const body = bodies[index]!
      const isMoved = Math.hypot(body.x - body.trueX, body.y - body.trueY) > UNMOVED_PIXELS
      return isMoved || arranged.scale < 1 - 1e-9
    })
}
