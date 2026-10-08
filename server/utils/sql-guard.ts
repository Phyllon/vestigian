import type { TileCoordinate } from '#shared/types'

/**
 * The tile builders return SQL as a string and run it through `sql.unsafe`,
 * because `ST_AsMVT` pipelines are composed from fragments that bind
 * parameters cannot express. Every number interpolated into such a string is
 * therefore a potential injection point, and these guards are the only thing
 * standing between a route parameter and the statement.
 *
 * They throw rather than coerce: a value that reaches a builder unchecked is a
 * bug in the caller, and `NaN` or `Infinity` would otherwise be written into
 * the query as an identifier-shaped token. Routes still reject bad input
 * earlier (`isValidTileCoordinate`, the year range) with a 4xx; this is the
 * backstop for the next route that forgets.
 */

export const assertTileCoordinate = (tile: TileCoordinate): void => {
  const { z, x, y } = tile
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new TypeError(`Tile coordinate must be integers, got z=${z} x=${x} y=${y}`)
  }
}

export const assertFiniteNumber = (value: number, name: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${String(value)}`)
  }
}

/** `ST_TileEnvelope(z, x, y)` for the validated tile — the one place z/x/y enter a statement. */
export const buildTileEnvelopeSql = (tile: TileCoordinate): string => {
  assertTileCoordinate(tile)
  return `ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y})`
}
