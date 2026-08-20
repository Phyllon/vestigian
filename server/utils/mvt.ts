import type { TileCoordinate, TileRenderPlan } from '#shared/types'

export const MIN_ZOOM = 0
export const MAX_ZOOM = 18
export const TILE_EXTENT = 4096
export const TILE_BUFFER = 64

/** Below this zoom the map shows counted clusters instead of individual sites. */
export const CLUSTER_ZOOM_CEILING = 9

/** Tracings are meaningless as clusters, so they only appear once zoomed in. */
export const TRACING_ZOOM_FLOOR = 7

/**
 * A tile request is user-controlled input that goes straight into a spatial
 * query, so it is validated before it reaches the database rather than being
 * trusted from the route parameters.
 */
export const isValidTileCoordinate = (tile: TileCoordinate): boolean => {
  const { z, x, y } = tile
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false
  if (z < MIN_ZOOM || z > MAX_ZOOM) return false
  const axisLimit = 2 ** z
  return x >= 0 && x < axisLimit && y >= 0 && y < axisLimit
}

/**
 * Douglas-Peucker tolerance in Web Mercator metres. Roughly one screen pixel at
 * the requested zoom, so simplification is invisible but the payload shrinks by
 * an order of magnitude at continental zooms.
 */
export const getSimplifyTolerance = (zoom: number): number => {
  const metresPerPixel = 40075016.686 / (256 * 2 ** zoom)
  return Math.max(metresPerPixel, 0.5)
}

/** Cluster cell size in metres — about 48 screen pixels, tuned for touch. */
export const getClusterGridSize = (zoom: number): number =>
  (40075016.686 / (256 * 2 ** zoom)) * 48

export const planTileRender = (zoom: number): TileRenderPlan => ({
  strategy: zoom < CLUSTER_ZOOM_CEILING ? 'cluster' : 'feature',
  simplifyTolerance: getSimplifyTolerance(zoom),
  clusterGridSize: getClusterGridSize(zoom),
  includeTracings: zoom >= TRACING_ZOOM_FLOOR,
})

/**
 * Cache key for a rendered tile. The data version prefix lets an approved edit
 * invalidate every cached tile at once by bumping a single counter, which is
 * far cheaper than tracking which tiles a given geometry touches.
 */
export const buildTileCacheKey = (tile: TileCoordinate, dataVersion: number): string =>
  `tile:v${dataVersion}:${tile.z}:${tile.x}:${tile.y}`

interface ClusterTileQuery {
  tile: TileCoordinate
  gridSize: number
}

/**
 * Low zoom: sites collapsed onto a Mercator grid and counted. Snapping in
 * projected space keeps cluster cells square on screen at every latitude,
 * which grid-snapping in degrees would not.
 */
export const buildClusterTileSql = (query: ClusterTileQuery): string => `
  WITH bounds AS (
    SELECT ST_TileEnvelope(${query.tile.z}, ${query.tile.x}, ${query.tile.y}) AS env
  ),
  clustered AS (
    SELECT
      ST_SnapToGrid(ST_Transform(s.geom, 3857), ${query.gridSize}) AS cell,
      count(*)::int AS site_count,
      min(s.id) AS sample_id,
      min(s.title) AS sample_title
    FROM sites s, bounds b
    WHERE s.status = 'approved'
      AND ST_Transform(s.geom, 3857) && ST_Expand(b.env, ${query.gridSize})
    GROUP BY cell
  )
  SELECT ST_AsMVT(t, 'clusters', ${TILE_EXTENT}, 'geom') AS tile
  FROM (
    SELECT
      site_count,
      sample_id,
      sample_title,
      ST_AsMVTGeom(cell, b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true) AS geom
    FROM clustered, bounds b
    WHERE ST_AsMVTGeom(cell, b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true) IS NOT NULL
  ) AS t
`

interface FeatureTileQuery {
  tile: TileCoordinate
  simplifyTolerance: number
  includeTracings: boolean
}

/**
 * High zoom: individual sites plus, once close enough to be legible, the line
 * tracings. Properties are deliberately minimal — the client fetches the full
 * record from /api/sites/:id when a feature is opened, which keeps tiles small
 * and cacheable for far longer than the editable content would allow.
 */
export const buildFeatureTileSql = (query: FeatureTileQuery): string => {
  const { tile, simplifyTolerance, includeTracings } = query

  const siteLayer = `
    SELECT ST_AsMVT(s, 'sites', ${TILE_EXTENT}, 'geom') AS tile
    FROM (
      SELECT
        sites.id,
        sites.slug,
        sites.title,
        sites.category::text AS category,
        sites.period_from,
        sites.period_to,
        ST_AsMVTGeom(
          ST_Transform(sites.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM sites, bounds b
      WHERE sites.status = 'approved'
        AND ST_Transform(sites.geom, 3857) && b.env
    ) AS s
  `

  const tracingLayer = `
    SELECT ST_AsMVT(t, 'tracings', ${TILE_EXTENT}, 'geom') AS tile
    FROM (
      SELECT
        tracings.id,
        tracings.title,
        tracings.kind::text AS kind,
        tracings.category::text AS category,
        ST_AsMVTGeom(
          ST_SimplifyPreserveTopology(
            ST_Transform(tracings.geom, 3857), ${simplifyTolerance}
          ),
          b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM tracings, bounds b
      WHERE tracings.status = 'approved'
        AND ST_Transform(tracings.geom, 3857) && b.env
    ) AS t
    WHERE t.geom IS NOT NULL
  `

  return `
    WITH bounds AS (
      SELECT ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y}) AS env
    )
    SELECT (${siteLayer})${includeTracings ? ` || (${tracingLayer})` : ''} AS tile
  `
}
