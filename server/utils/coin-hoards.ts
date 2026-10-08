import type { TileCoordinate } from '#shared/types'
import { TILE_BUFFER, TILE_EXTENT } from './mvt'
import { buildTileEnvelopeSql } from './sql-guard'

/**
 * Tile assembly for CHRR coin-hoard findspots — the layer the map gains
 * when "Show coin hoards" is switched on. Its own endpoint for the same
 * reason as ports, battles and minor features: most readers never turn
 * it on, and it draws over every basemap. Shares the atlas cache
 * generation (`buildCoinHoardCacheKey`) — an import that rebuilds one
 * invalidates both.
 */

/**
 * Keyed to the atlas generation, not a third counter of its own — same
 * reasoning as `buildBattleCacheKey`.
 */
export const buildCoinHoardCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `coin-hoard:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

/**
 * One point layer, no simplification: at 620 rows worldwide there is
 * nothing to thin at any zoom.
 *
 * The 4326 filter rule applies unchanged: `geom && b.env_wgs` uses the
 * GiST index, `ST_Transform(geom, 3857) && env` cannot.
 */
export const buildCoinHoardTileSql = (tile: TileCoordinate): string => `
  WITH bounds AS (
    SELECT env, ST_Transform(env, 4326) AS env_wgs
    FROM (SELECT ${buildTileEnvelopeSql(tile)} AS env) AS t
  )
  SELECT ST_AsMVT(ch, 'coin_hoards', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_coin_hoards.id,
      antiquity_coin_hoards.name,
      antiquity_coin_hoards.hoard_count,
      antiquity_coin_hoards.geonames_url,
      ST_AsMVTGeom(
        ST_Transform(antiquity_coin_hoards.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_coin_hoards, bounds b
    WHERE antiquity_coin_hoards.geom && b.env_wgs
  ) AS ch
  WHERE ch.geom IS NOT NULL
`
