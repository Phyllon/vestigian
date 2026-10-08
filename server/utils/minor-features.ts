import type { TileCoordinate } from '#shared/types'
import { TILE_BUFFER, TILE_EXTENT } from './mvt'
import { buildTileEnvelopeSql } from './sql-guard'

/**
 * Tile assembly for AWMC's minor point features — bridges, mines/
 * quarries, dams, cemeteries, forts and tumuli — the layer the map gains
 * when "Show minor antiquities" is switched on. Its own endpoint rather
 * than folded into `/api/tiles/antiquity`, for the same reason the
 * frontier and battles are: most readers never turn the switch on, and
 * this overlay draws over every basemap, not only the Barrington sheet.
 * Shares the atlas cache generation (`buildMinorFeatureCacheKey`) — an import
 * that rebuilds one invalidates both.
 */

/**
 * Keyed to the atlas generation, not a third counter of its own — same
 * reasoning as `buildBattleCacheKey`.
 */
export const buildMinorFeatureCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `feature:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

/**
 * One point layer, no simplification: at ~525 rows worldwide there is
 * nothing to thin at any zoom.
 *
 * The 4326 filter rule from `atlas.ts`/`limes.ts`/`battles.ts` applies
 * unchanged and for the same reason: `geom && b.env_wgs` uses the GiST
 * index, `ST_Transform(geom, 3857) && env` cannot.
 */
export const buildMinorFeatureTileSql = (tile: TileCoordinate): string => `
  WITH bounds AS (
    SELECT env, ST_Transform(env, 4326) AS env_wgs
    FROM (SELECT ${buildTileEnvelopeSql(tile)} AS env) AS t
  )
  SELECT ST_AsMVT(ft, 'features', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_features.id,
      antiquity_features.kind::text AS kind,
      antiquity_features.name,
      antiquity_features.source,
      antiquity_features.material,
      antiquity_features.periods,
      ST_AsMVTGeom(
        ST_Transform(antiquity_features.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_features, bounds b
    WHERE antiquity_features.geom && b.env_wgs
  ) AS ft
  WHERE ft.geom IS NOT NULL
`
