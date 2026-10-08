import type { TileCoordinate, TileRenderPlan } from '#shared/types'
import { MAX_ZOOM, MIN_ZOOM } from '#shared/utils/tile-limits'

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
export const getClusterGridSize = (zoom: number): number => (40075016.686 / (256 * 2 ** zoom)) * 48

/**
 * `showEverySite` is the reader's "individual markers" switch: the tile then
 * carries sites at every zoom instead of counted clusters below the ceiling.
 * Clusters stay the default because at zoom 4 this is tens of thousands of
 * points per view — the switch trades payload and legibility for completeness.
 */
export interface TileRenderOptions {
  showEverySite?: boolean
}

export const planTileRender = (zoom: number, options: TileRenderOptions = {}): TileRenderPlan => {
  const isBelowCeiling = zoom < CLUSTER_ZOOM_CEILING
  const showEverySite = options.showEverySite === true

  return {
    strategy: isBelowCeiling && !showEverySite ? 'cluster' : 'feature',
    simplifyTolerance: getSimplifyTolerance(zoom),
    clusterGridSize: getClusterGridSize(zoom),
    includeTracings: zoom >= TRACING_ZOOM_FLOOR,
    compactSiteProperties: isBelowCeiling && showEverySite,
  }
}

/**
 * Cache key for a rendered tile. The data version prefix lets an approved edit
 * invalidate every cached tile at once by bumping a single counter, which is
 * far cheaper than tracking which tiles a given geometry touches.
 */
export const buildTileCacheKey = (
  tile: TileCoordinate,
  dataVersion: number,
  options: TileRenderOptions = {},
): string =>
  `tile:v${dataVersion}:${tile.z}:${tile.x}:${tile.y}${options.showEverySite ? ':every' : ''}`

interface ClusterTileQuery {
  tile: TileCoordinate
  gridSize: number
}

/**
 * Low zoom: sites collapsed onto a Mercator grid and counted. Snapping in
 * projected space keeps cluster cells square on screen at every latitude,
 * which grid-snapping in degrees would not.
 *
 * The grid decides **which** sites belong together; it does not decide where
 * the marker goes. `ST_SnapToGrid` returns the cell's grid node, and drawing
 * the cluster there puts it up to half a cell diagonal from the sites it
 * stands for — measured against this data at zoom 6, a mean of 13 screen
 * pixels and a worst case of 34, with a lone site's "cluster" among the
 * offenders. Clicking one then eases the camera to the node, so the sites
 * arrive off-centre and the count appears to refer to empty ground.
 *
 * The marker is therefore drawn at the members' centre of mass, which is both
 * where the reader expects it and what makes click-to-zoom land correctly.
 * `ST_Centroid` of the collected points is the plain average; the geometric
 * median would resist outliers better but costs an iterative solve per cell,
 * on the hot path, for a marker that is an approximation by definition.
 *
 * A centroid, unlike a grid node, depends on *which* members were selected —
 * so a cell whose members were clipped away would land somewhere different in
 * each neighbouring tile and jitter along the seam. It cannot happen here, but
 * only because the numbers work out: a cell reaches at most half a grid step
 * from its node, the drawn region reaches TILE_BUFFER/TILE_EXTENT of a tile
 * beyond the envelope, and 0.5 x 48/256 + 64/4096 = 0.109 of a tile is less
 * than the 48/256 = 0.188 this query already expands by. Those ratios are
 * zoom-independent, so it holds at every level — and it stops holding if the
 * grid shrinks or the buffer grows.
 */
export const buildClusterTileSql = (query: ClusterTileQuery): string => `
  WITH bounds AS (
    SELECT ST_TileEnvelope(${query.tile.z}, ${query.tile.x}, ${query.tile.y}) AS env
  ),
  clustered AS (
    SELECT
      ST_Centroid(ST_Collect(ST_Transform(s.geom, 3857))) AS centre,
      count(*)::int AS site_count,
      min(s.id) AS sample_id,
      min(s.title) AS sample_title
    FROM sites s, bounds b
    WHERE s.status = 'approved'
      AND ST_Transform(s.geom, 3857) && ST_Expand(b.env, ${query.gridSize})
    GROUP BY ST_SnapToGrid(ST_Transform(s.geom, 3857), ${query.gridSize})
  ),
  projected AS (
    SELECT
      site_count,
      sample_id,
      sample_title,
      ST_AsMVTGeom(centre, b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true) AS geom
    FROM clustered, bounds b
  )
  SELECT ST_AsMVT(t, 'clusters', ${TILE_EXTENT}, 'geom') AS tile
  FROM (SELECT * FROM projected WHERE geom IS NOT NULL) AS t
`

interface FeatureTileQuery {
  tile: TileCoordinate
  simplifyTolerance: number
  includeTracings: boolean
  compactSiteProperties: boolean
}

/**
 * High zoom: individual sites plus, once close enough to be legible, the line
 * tracings. Properties are deliberately minimal — the client fetches the full
 * record from /api/sites/:id when a feature is opened, which keeps tiles small
 * and cacheable for far longer than the editable content would allow.
 *
 * Both layers pass `'id'` as `ST_AsMVT`'s feature_id_name, which promotes the
 * column out of the property bag and into the tile feature's own id. That is
 * the only identifier `setFeatureState` will accept: without it the call
 * silently matches no feature, and hover and selection have no visible effect
 * while every other part of the map behaves normally.
 *
 * It also makes the tile smaller — the id stops being a key/value pair in the
 * layer's string table — so this is not a trade.
 *
 * The bounding-box filter compares in 4326 against the tile envelope
 * transformed into it (`geom && b.env_wgs`), exactly as `limes.ts` and
 * `atlas.ts` do. The earlier `ST_Transform(geom, 3857) && env` cannot use the
 * GiST indexes, which sit on the raw 4326 column: every cache miss was a
 * sequential scan that reprojected all 61k sites and every tracing —
 * 236 ms and 194 ms against 1.7 ms and 1.1 ms on a zoom-10 tile, and the
 * cause of `TileRenderSlow`. Keep `status = 'approved'` in the predicate so the
 * partial `*_approved_geom_idx` indexes qualify. `ST_AsMVTGeom` still does the
 * exact clipping, so the tile is unchanged.
 */
export const buildFeatureTileSql = (query: FeatureTileQuery): string => {
  const { tile, simplifyTolerance, includeTracings, compactSiteProperties } = query

  const siteLayer = `
    SELECT ST_AsMVT(s, 'sites', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        sites.id,
        ${compactSiteProperties ? '' : 'sites.slug,'}
        sites.title,
        sites.category::text AS category,
        -- vici's own kind, where the record came with one. Small and highly
        -- repetitive, so it costs almost nothing in a tile that already carries
        -- a title, and it is what lets the frontier draw a turret as a turret.
        sites.subcategory,
        ${compactSiteProperties ? '' : 'sites.period_from, sites.period_to,'}
        ST_AsMVTGeom(
          ST_Transform(sites.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM sites, bounds b
      WHERE sites.status = 'approved'
        AND sites.geom && b.env_wgs
    ) AS s
  `

  const tracingLayer = `
    SELECT ST_AsMVT(t, 'tracings', ${TILE_EXTENT}, 'geom', 'id') AS tile
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
        AND tracings.geom && b.env_wgs
    ) AS t
    WHERE t.geom IS NOT NULL
  `

  return `
    WITH bounds AS (
      SELECT env, ST_Transform(env, 4326) AS env_wgs
      FROM (SELECT ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y}) AS env) AS t
    )
    SELECT (${siteLayer})${includeTracings ? ` || (${tracingLayer})` : ''} AS tile
  `
}
