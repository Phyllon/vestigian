import type { TileCoordinate } from '#shared/types'
import { TILE_BUFFER, TILE_EXTENT, getSimplifyTolerance } from './mvt'

/**
 * Tile assembly for the frontier — the layer the Barrington sheet gains when
 * "Follow the limes" is switched on.
 *
 * Its own endpoint rather than two more layers on `/api/tiles/antiquity`,
 * because most readers never turn the switch on and would otherwise pay for the
 * frontier in every atlas tile they fetch. It shares the atlas cache generation
 * (see `buildLimesCacheKey`): both change only when an import runs, and there
 * is no case where one is stale and the other current.
 */

/** Sector names label several hundred kilometres of frontier; past this they crowd. */
export const LIMES_SECTOR_ZOOM_CEILING = 9
export const LIMES_SECTOR_ZOOM_FLOOR = 4

export interface LimesRenderPlan {
  simplifyTolerance: number
  includeSectorLabels: boolean
}

export const planLimesRender = (zoom: number): LimesRenderPlan => ({
  simplifyTolerance: getSimplifyTolerance(zoom),
  includeSectorLabels: zoom >= LIMES_SECTOR_ZOOM_FLOOR && zoom <= LIMES_SECTOR_ZOOM_CEILING,
})

/**
 * Keyed to the atlas generation, not a third counter of its own. `pnpm
 * import:limes` clears `atlas:v*` and `limes:v*` together for the same reason.
 */
export const buildLimesCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `limes:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

interface LimesTileQuery {
  tile: TileCoordinate
  plan: LimesRenderPlan
}

/**
 * Two layers, one round trip.
 *
 * The 4326 filter rule from `atlas.ts` applies unchanged and for the same
 * reason: `geom && b.env_wgs` uses the GiST index, `ST_Transform(geom, 3857) &&
 * env` cannot. This table is small enough today that the wrong form would still
 * feel fast, which is exactly how it would get written and then stay.
 *
 * `ST_SimplifyPreserveTopology` rather than the plain form the sea gets: this is
 * the one line on the sheet a reader is meant to follow, and a frontier that
 * fragments into pieces at zoom 5 is a different claim from one that does not.
 */
export const buildLimesTileSql = (query: LimesTileQuery): string => {
  const { tile, plan } = query

  const frontierLayer = `
    SELECT ST_AsMVT(f, 'frontier', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        limes_segments.id,
        limes_segments.kind::text AS kind,
        limes_segments.certain,
        limes_sectors.slug AS sector_slug,
        limes_sectors.name AS sector_name,
        ST_AsMVTGeom(
          ST_SimplifyPreserveTopology(
            ST_Transform(limes_segments.geom, 3857), ${plan.simplifyTolerance}
          ),
          b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM limes_segments
      JOIN limes_sectors ON limes_sectors.id = limes_segments.sector_id, bounds b
      WHERE limes_segments.geom && b.env_wgs
    ) AS f
    WHERE f.geom IS NOT NULL
  `

  /**
   * One label per sector, at the midpoint of its longest run.
   *
   * The midpoint rather than the centroid: a sector's centroid can fall well
   * off it — the Dacian frontier is a loop, so its centroid is in the middle of
   * Transylvania with no line under it — and a name floating in open country is
   * read as belonging to the country rather than to the line.
   */
  const sectorLayer = `
    SELECT ST_AsMVT(s, 'sectors', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        limes_sectors.id,
        limes_sectors.slug,
        limes_sectors.name,
        limes_sectors.length_metres,
        ST_AsMVTGeom(
          ST_Transform(ST_LineInterpolatePoint(limes_sectors.path_geom, 0.5), 3857),
          b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM limes_sectors, bounds b
      WHERE ST_LineInterpolatePoint(limes_sectors.path_geom, 0.5) && b.env_wgs
    ) AS s
    WHERE s.geom IS NOT NULL
  `

  const layers = [frontierLayer]
  if (plan.includeSectorLabels) layers.push(sectorLayer)

  return `
    WITH bounds AS (
      SELECT env, ST_Transform(env, 4326) AS env_wgs
      FROM (SELECT ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y}) AS env) AS t
    )
    SELECT ${layers.map((layer) => `(${layer})`).join(' || ')} AS tile
  `
}
