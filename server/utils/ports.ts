import type { TileCoordinate } from '#shared/types'
import { TILE_BUFFER, TILE_EXTENT } from './mvt'
import { buildTileEnvelopeSql } from './sql-guard'

/**
 * Tile assembly for ancient ports — the layer the map gains when "Show
 * ports" is switched on. Its own endpoint rather than folded into
 * `/api/tiles/antiquity`, for the same reason the frontier and battles
 * are: most readers never turn the switch on, and this overlay draws over
 * *every* basemap, not only the Barrington sheet. Shares the atlas cache
 * generation (`buildPortCacheKey`) — an import that rebuilds one
 * invalidates both.
 */

/**
 * Keyed to the atlas generation, not a third counter of its own — same
 * reasoning as `buildBattleCacheKey`.
 */
export const buildPortCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `port:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

/**
 * One point layer, no simplification: a port is a point, and at ~6,000
 * rows worldwide there is nothing to thin at any zoom.
 *
 * The 4326 filter rule from `atlas.ts`/`limes.ts`/`battles.ts` applies
 * unchanged and for the same reason: `geom && b.env_wgs` uses the GiST
 * index, `ST_Transform(geom, 3857) && env` cannot.
 */
export const buildPortTileSql = (tile: TileCoordinate): string => `
  WITH bounds AS (
    SELECT env, ST_Transform(env, 4326) AS env_wgs
    FROM (SELECT ${buildTileEnvelopeSql(tile)} AS env) AS t
  )
  SELECT ST_AsMVT(pt, 'ports', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_ports.id,
      antiquity_ports.title,
      antiquity_ports.modern_name,
      antiquity_ports.country,
      antiquity_ports.foundation,
      antiquity_ports.pleiades_url,
      antiquity_ports.wikipedia_url,
      ST_AsMVTGeom(
        ST_Transform(antiquity_ports.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_ports, bounds b
    WHERE antiquity_ports.geom && b.env_wgs
  ) AS pt
  WHERE pt.geom IS NOT NULL
`
