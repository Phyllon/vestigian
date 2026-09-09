import type { TileCoordinate } from '#shared/types'
import { buildMilitaryFeatureTypePattern, buildPleiadesMarkSql } from '#shared/utils/limes'
import { TILE_BUFFER, TILE_EXTENT, getSimplifyTolerance } from './mvt'

/**
 * Tile assembly for the antiquity atlas — the reference cartography behind the
 * 'antiquity-awmc' basemap, drawn from AWMC's Barrington-derived geodata and
 * Pleiades. It is a separate endpoint from `/api/tiles` for two reasons: the
 * data is third-party and licensed differently, and it changes only when the
 * import is re-run, so it wants its own cache generation rather than being
 * invalidated every time a contribution is approved.
 */

/** Below this the sheet is coastline, sea and the major routes only. */
export const ATLAS_DETAIL_ZOOM = 7

/** Region and people names label a whole province; past this they are noise. */
export const ATLAS_REGION_ZOOM_CEILING = 9
export const ATLAS_REGION_ZOOM_FLOOR = 4

/** Pleiades is dense. Individual places arrive once there is room to read them. */
export const ATLAS_PLACE_ZOOM_FLOOR = 6

/** Urban extents are a few hundred metres across and meaningless before this. */
export const ATLAS_AREA_ZOOM_FLOOR = 8

export interface AtlasRenderPlan {
  simplifyTolerance: number
  /** Minor roads, aqueducts, canals and walls, which crowd a continental view. */
  includeDetailLines: boolean
  includeRegions: boolean
  includePlaces: boolean
  includeAreas: boolean
}

export const planAtlasRender = (zoom: number): AtlasRenderPlan => ({
  simplifyTolerance: getSimplifyTolerance(zoom),
  includeDetailLines: zoom >= ATLAS_DETAIL_ZOOM,
  includeRegions: zoom >= ATLAS_REGION_ZOOM_FLOOR && zoom <= ATLAS_REGION_ZOOM_CEILING,
  includePlaces: zoom >= ATLAS_PLACE_ZOOM_FLOOR,
  includeAreas: zoom >= ATLAS_AREA_ZOOM_FLOOR,
})

/**
 * The atlas is rebuilt by an import rather than edited, so its tiles survive
 * every approval. Keying them to the site data version would throw the whole
 * pyramid away each time a moderator accepted a photograph.
 */
export const buildAtlasCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `atlas:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

interface AtlasTileQuery {
  tile: TileCoordinate
  plan: AtlasRenderPlan
}

/**
 * One statement, one round trip, five layers concatenated into a single tile.
 *
 * **Every filter compares in 4326, against the tile envelope transformed into
 * it — never `ST_Transform(geom, 3857) && env`.** That form is the obvious one
 * to write and it cannot use the GiST index, because the index is built on the
 * stored geometry and the expression is on a transformed copy. It measured 1.1
 * to 2.6 seconds per tile here: a sequential scan over sixty thousand
 * coastlines, roads and sea polygons for a tile that returns four hundred
 * bytes. Comparing the other way round is the same answer from an index scan.
 *
 * Only the rows that survive that filter are transformed and simplified, which
 * is the second half of the saving: the same coastline has to serve zoom 4 and
 * zoom 12, and at zoom 4 the unsimplified geometry is a 195 KB tile of vertices
 * that land on the same pixel. `ST_AsMVTGeom` would snap most of them away in
 * any case, but only after they have been carried through the transform.
 */
export const buildAtlasTileSql = (query: AtlasTileQuery): string => {
  const { tile, plan } = query
  const { simplifyTolerance } = plan

  /**
   * `ST_Simplify`, not `ST_SimplifyPreserveTopology`, and only here.
   *
   * The sea arrives as OpenStreetMap-grade polygons — the Baltic is one ring of
   * a hundred thousand vertices — and preserving topology across that at zoom 4
   * measured 1.8 seconds against 340 ms for the plain algorithm, for a tile
   * that was also 60% larger. What topology preservation buys is protection
   * against a ring folding through itself; what it costs here is the whole
   * budget for the zoom people first see. The plain form also drops rings
   * smaller than the tolerance outright, which at continental zoom removes
   * islands that would render as single specks anyway.
   *
   * The linework below keeps the safe form: it is cheap there, and a road that
   * fragments is a factual error rather than a cosmetic one.
   */
  const waterLayer = `
    SELECT ST_AsMVT(w, 'water', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        antiquity_water.id,
        antiquity_water.kind::text AS kind,
        antiquity_water.name,
        ST_AsMVTGeom(
          ST_Simplify(
            ST_Transform(antiquity_water.geom, 3857), ${simplifyTolerance}
          ),
          b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM antiquity_water, bounds b
      WHERE antiquity_water.geom && b.env_wgs
    ) AS w
    WHERE w.geom IS NOT NULL
  `

  // The coastline is always drawn; the rest of the linework waits for a zoom at
  // which an aqueduct is distinguishable from a road.
  const lineFilter = plan.includeDetailLines
    ? 'TRUE'
    : `antiquity_lines.kind = 'shoreline' OR (antiquity_lines.kind = 'road' AND antiquity_lines.major)`

  const lineLayer = `
    SELECT ST_AsMVT(l, 'lines', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        antiquity_lines.id,
        antiquity_lines.kind::text AS kind,
        antiquity_lines.name,
        antiquity_lines.major,
        antiquity_lines.certain,
        antiquity_lines.period,
        ST_AsMVTGeom(
          ST_SimplifyPreserveTopology(
            ST_Transform(antiquity_lines.geom, 3857), ${simplifyTolerance}
          ),
          b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM antiquity_lines, bounds b
      WHERE antiquity_lines.geom && b.env_wgs
        AND (${lineFilter})
    ) AS l
    WHERE l.geom IS NOT NULL
  `

  const areaLayer = `
    SELECT ST_AsMVT(a, 'areas', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        antiquity_areas.id,
        antiquity_areas.kind,
        antiquity_areas.name,
        ST_AsMVTGeom(
          ST_Transform(antiquity_areas.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM antiquity_areas, bounds b
      WHERE antiquity_areas.geom && b.env_wgs
    ) AS a
    WHERE a.geom IS NOT NULL
  `

  const regionLayer = `
    SELECT ST_AsMVT(r, 'regions', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        antiquity_regions.id,
        antiquity_regions.title,
        antiquity_regions.kind,
        ST_AsMVTGeom(
          ST_Transform(antiquity_regions.label_geom, 3857),
          b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM antiquity_regions, bounds b
      WHERE antiquity_regions.label_geom && b.env_wgs
    ) AS r
    WHERE r.geom IS NOT NULL
  `

  /**
   * Whether a place stood on a frontier is decided here, not in the style.
   *
   * `feature_types` is a comma-separated list from a vocabulary of several
   * hundred terms; matching it inside a MapLibre filter would mean shipping the
   * free text in every tile and running a string match per symbol. One boolean
   * is a byte, and it is computed from the same set the sector roll queries
   * against, so the mark on the map and the entry in the list cannot disagree
   * about what counts as military. The pattern is built from fixed identifiers
   * and contains no quotes — see `buildMilitaryFeatureTypePattern`.
   */
  const placeLayer = `
    SELECT ST_AsMVT(p, 'places', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        antiquity_places.id,
        antiquity_places.pleiades_id,
        antiquity_places.title,
        antiquity_places.category::text AS category,
        antiquity_places.description,
        antiquity_places.feature_types,
        antiquity_places.min_year,
        antiquity_places.max_year,
        antiquity_places.location_precision,
        (antiquity_places.feature_types ~ '${buildMilitaryFeatureTypePattern()}') AS military,
        ${buildPleiadesMarkSql('antiquity_places.feature_types')} AS mark,
        ST_AsMVTGeom(
          ST_Transform(antiquity_places.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM antiquity_places, bounds b
      WHERE antiquity_places.geom && b.env_wgs
    ) AS p
    WHERE p.geom IS NOT NULL
  `

  const layers = [waterLayer, lineLayer]
  if (plan.includeAreas) layers.push(areaLayer)
  if (plan.includeRegions) layers.push(regionLayer)
  if (plan.includePlaces) layers.push(placeLayer)

  return `
    WITH bounds AS (
      SELECT env, ST_Transform(env, 4326) AS env_wgs
      FROM (SELECT ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y}) AS env) AS t
    )
    SELECT ${layers.map((layer) => `(${layer})`).join(' || ')} AS tile
  `
}

/**
 * Tile assembly for the period scrubber — the fill the Barrington sheet gains
 * when a reader drags the extent slider along the Roman timeline
 * (`19-ohm-empire-extents.ts`, OpenHistoricalMap, CC0).
 *
 * Its own endpoint, same reasoning as `limes.ts`: most readers never touch
 * the scrubber, and folding this into `/api/tiles/antiquity` would charge
 * everyone who doesn't for a fill layer they never asked for. Shares the
 * atlas cache generation — this data changes only when the antiquity import
 * runs, same clock as everything else in this file.
 */
export const buildEmpireExtentCacheKey = (
  tile: TileCoordinate,
  atlasVersion: number,
  year: number,
): string => `atlas:v${atlasVersion}:empire:${year}:${tile.z}:${tile.x}:${tile.y}`

interface EmpireExtentTileQuery {
  tile: TileCoordinate
  year: number
  simplifyTolerance: number
}

/**
 * One layer, one round trip. The 4326 filter rule from `buildAtlasTileSql`
 * applies unchanged and for the same reason — `geom && b.env_wgs` uses the
 * GiST index, `ST_Transform(geom, 3857) && env` cannot.
 *
 * **Selected by the year the reader is standing on, not by slice id.** The
 * source models control as half-open intervals, and after 395 two of them
 * are live at once — the Western and Eastern empires are separate relations
 * covering the same years. Asking "which extents contain this year" draws
 * both without the caller needing to know there are two, and makes the
 * handful of overlapping refinements OHM carries (two slices both ending
 * 439, two both ending 465) merge into the same fill instead of fighting.
 *
 * `ST_Simplify`, not the topology-preserving form: this is a fill, not a
 * line a reader is meant to trace, and the plain algorithm is what the sea
 * layer above already uses for the same reason at the same kind of vertex
 * count. It matters more here than it did for AWMC's three snapshots — these
 * 52 slices carry 2.9 million vertices between them.
 */
export const buildEmpireExtentTileSql = (query: EmpireExtentTileQuery): string => {
  const { tile, year, simplifyTolerance } = query

  const extentLayer = `
    SELECT ST_AsMVT(e, 'extent', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        antiquity_empire_extents.id,
        antiquity_empire_extents.state_name,
        ST_AsMVTGeom(
          ST_Simplify(
            ST_Transform(antiquity_empire_extents.geom, 3857), ${simplifyTolerance}
          ),
          b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM antiquity_empire_extents, bounds b
      WHERE antiquity_empire_extents.geom && b.env_wgs
        AND antiquity_empire_extents.start_year <= ${year}
        AND antiquity_empire_extents.end_year > ${year}
    ) AS e
    WHERE e.geom IS NOT NULL
  `

  return `
    WITH bounds AS (
      SELECT env, ST_Transform(env, 4326) AS env_wgs
      FROM (SELECT ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y}) AS env) AS t
    )
    SELECT (${extentLayer}) AS tile
  `
}
