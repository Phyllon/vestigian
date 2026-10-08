import type { TileCoordinate } from '#shared/types'
import { TILE_BUFFER, TILE_EXTENT } from './mvt'
import { buildTileEnvelopeSql } from './sql-guard'

/**
 * Tile assembly for ancient battles — the layer the map gains when "Show
 * battles" is switched on. Its own endpoint rather than folded into
 * `/api/tiles/antiquity`, for the same reason the frontier is: most
 * readers never turn the switch on, and this overlay draws over *every*
 * basemap, not only the Barrington sheet, so it could not live inside
 * that endpoint even if every reader wanted it. Shares the atlas cache
 * generation (`buildBattleCacheKey`) — an import that rebuilds one
 * invalidates both.
 */

/**
 * Keyed to the atlas generation, not a third counter of its own — same
 * reasoning as `buildLimesCacheKey`.
 */
export const buildBattleCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `battle:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

/**
 * One point layer, no simplification: a battle is a point, and at ~490
 * rows worldwide there is nothing to thin at any zoom.
 *
 * The 4326 filter rule from `atlas.ts`/`limes.ts` applies unchanged and
 * for the same reason: `geom && b.env_wgs` uses the GiST index,
 * `ST_Transform(geom, 3857) && env` cannot.
 */
export const buildBattleTileSql = (tile: TileCoordinate): string => `
  WITH bounds AS (
    SELECT env, ST_Transform(env, 4326) AS env_wgs
    FROM (SELECT ${buildTileEnvelopeSql(tile)} AS env) AS t
  )
  SELECT ST_AsMVT(bt, 'battles', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_battles.id,
      antiquity_battles.title,
      antiquity_battles.year,
      antiquity_battles.wikidata_id,
      antiquity_battles.location_precision,
      antiquity_battles.wikipedia_url,
      ST_AsMVTGeom(
        ST_Transform(antiquity_battles.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_battles, bounds b
    WHERE antiquity_battles.geom && b.env_wgs
  ) AS bt
  WHERE bt.geom IS NOT NULL
`
