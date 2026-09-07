import type { TileCoordinate } from '#shared/types'
import { TILE_BUFFER, TILE_EXTENT } from './mvt'

/**
 * Tile assembly for the ORBIS route network — the layer the map gains when
 * "Show ancient routes" is switched on. Its own endpoint for the same
 * reason as ports and battles: most readers never turn it on, and it
 * draws over *every* basemap. Shares the atlas cache generation
 * (`buildRouteCacheKey`) — an import that rebuilds one invalidates both.
 */

/**
 * Keyed to the atlas generation, not a third counter of its own — same
 * reasoning as `buildBattleCacheKey`.
 */
export const buildRouteCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `route:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

/**
 * One line layer, no simplification: at ~1,300 rows worldwide there is
 * nothing to thin at any zoom, the same reasoning `buildBattleTileSql`
 * gives for points at a similar scale.
 *
 * The 4326 filter rule applies unchanged: `geom && b.env_wgs` uses the
 * GiST index, `ST_Transform(geom, 3857) && env` cannot.
 */
export const buildRouteTileSql = (tile: TileCoordinate): string => `
  WITH bounds AS (
    SELECT env, ST_Transform(env, 4326) AS env_wgs
    FROM (SELECT ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y}) AS env) AS t
  )
  SELECT ST_AsMVT(rt, 'routes', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_routes.id,
      antiquity_routes.route_type,
      antiquity_routes.source_title,
      antiquity_routes.target_title,
      ST_AsMVTGeom(
        ST_Transform(antiquity_routes.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_routes, bounds b
    WHERE antiquity_routes.geom && b.env_wgs
  ) AS rt
  WHERE rt.geom IS NOT NULL
`
