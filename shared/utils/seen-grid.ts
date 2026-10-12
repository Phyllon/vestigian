import type { LonLat, SeenGrid } from '../types'
import { COMPASS_POINTS } from '../types'
import { compassPointFor, destinationPoint } from './sightline'

/**
 * The ground a tower sees, kept as a polar grid (see `SeenGrid`): compact enough
 * to travel with the answer, and exact enough to draw as wedges on a diagram or
 * on the map. Pure, and symmetric — `encode` and `decode` are each other's tests.
 */

/** Packs one-byte-per-cell (0 or 1) into bits, least significant first, as base64. */
export const encodeSeenCells = (cells: Uint8Array): string => {
  const bytes = new Uint8Array(Math.ceil(cells.length / 8))
  cells.forEach((cell, index) => {
    if (cell) bytes[index >> 3]! |= 1 << (index & 7)
  })
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

/** The inverse of {@link encodeSeenCells}; `cellCount` fixes the length the bits are read to. */
export const decodeSeenCells = (data: string, cellCount: number): Uint8Array => {
  const binary = atob(data)
  const cells = new Uint8Array(cellCount)
  for (let index = 0; index < cellCount; index++) {
    const byte = binary.charCodeAt(index >> 3)
    if (!Number.isNaN(byte) && (byte >> (index & 7)) & 1) cells[index] = 1
  }
  return cells
}

export const seenGridFromCells = (
  cells: Uint8Array,
  shape: { columns: number; binMetres: number; binCount: number },
): SeenGrid => ({ ...shape, data: encodeSeenCells(cells) })

export const cellsOfGrid = (grid: SeenGrid): Uint8Array =>
  decodeSeenCells(grid.data, grid.columns * grid.binCount)

/** A run of seen bins in one wedge: bins `fromBin` up to but not including `toBin`. */
export interface SeenRun {
  column: number
  fromBin: number
  toBin: number
}

export const seenRuns = (
  cells: Uint8Array,
  shape: { columns: number; binCount: number },
): SeenRun[] => {
  const runs: SeenRun[] = []
  for (let column = 0; column < shape.columns; column++) {
    let start = -1
    for (let bin = 0; bin <= shape.binCount; bin++) {
      const isSeen = bin < shape.binCount && cells[column * shape.binCount + bin] === 1
      if (isSeen && start < 0) start = bin
      if (!isSeen && start >= 0) {
        runs.push({ column, fromBin: start, toBin: bin })
        start = -1
      }
    }
  }
  return runs
}

/** Whether the ground at this bearing and distance from the tower is in the grid's seen cells. */
export const isSeenAt = (
  cells: Uint8Array,
  shape: { columns: number; binMetres: number; binCount: number },
  place: { bearingDegrees: number; distanceMetres: number },
): boolean => {
  const { bearingDegrees, distanceMetres } = place
  if (distanceMetres <= 0 || distanceMetres >= shape.binCount * shape.binMetres) return false
  const normalised = ((bearingDegrees % 360) + 360) % 360
  const column = Math.min(shape.columns - 1, Math.floor((normalised * shape.columns) / 360))
  const bin = Math.min(shape.binCount - 1, Math.floor(distanceMetres / shape.binMetres))
  return cells[column * shape.binCount + bin] === 1
}

/**
 * For each of the eight compass sectors, the farthest ground seen in it — the
 * number that tells a tower on a rim (a short open view, a far valley side) from
 * one that is simply shut in.
 */
export const farthestSeenBySector = (
  cells: Uint8Array,
  shape: { columns: number; binMetres: number; binCount: number },
): Record<(typeof COMPASS_POINTS)[number], number> => {
  const farthest = Object.fromEntries(COMPASS_POINTS.map((point) => [point, 0])) as Record<
    (typeof COMPASS_POINTS)[number],
    number
  >
  for (let column = 0; column < shape.columns; column++) {
    const point = compassPointFor(((column + 0.5) * 360) / shape.columns)
    for (let bin = shape.binCount - 1; bin >= 0; bin--) {
      if (cells[column * shape.binCount + bin] === 1) {
        const metres = (bin + 1) * shape.binMetres
        if (metres > farthest[point]) farthest[point] = metres
        break
      }
    }
  }
  return farthest
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * One run as a closed ring on the ground: the outer arc out, the inner arc back,
 * a vertex every half degree so a wedge looks like part of a circle at map scale.
 */
export const wedgeRing = (
  origin: LonLat,
  run: SeenRun,
  shape: { columns: number; binMetres: number },
): [number, number][] => {
  const widthDegrees = 360 / shape.columns
  const startBearing = run.column * widthDegrees
  const steps = Math.max(1, Math.ceil(widthDegrees / 0.5))
  const inner = run.fromBin * shape.binMetres
  const outer = run.toBin * shape.binMetres

  const ring: [number, number][] = []
  const push = (bearing: number, metres: number): void => {
    const point = metres === 0 ? origin : destinationPoint(origin, bearing, metres)
    ring.push([roundTo(point.lon, 5), roundTo(point.lat, 5)])
  }
  for (let step = 0; step <= steps; step++)
    push(startBearing + (widthDegrees * step) / steps, outer)
  for (let step = steps; step >= 0; step--)
    push(startBearing + (widthDegrees * step) / steps, inner)
  ring.push(ring[0]!)
  return ring
}
