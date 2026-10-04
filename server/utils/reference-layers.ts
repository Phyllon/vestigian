import type { TileCoordinate } from '#shared/types'
import { isReferenceOverlayId, type ReferenceOverlayId } from '#shared/utils/reference-overlays'
import { TILE_BUFFER, TILE_EXTENT } from './mvt'

/**
 * Tile assembly for the reference overlays added with Itiner-e, Nomisma, the
 * Wikidata monuments, I.Sicily, the Atlas of Hillforts and Cliopatria. They share one endpoint
 * (`/api/tiles/reference/:layer/:z/:x/:y`) rather than the one-file-per-layer
 * arrangement of the older overlays (`coin-hoards.ts`, `ports.ts`, …), because
 * all four of the plain ones are the same shape — a table, a GiST index, a
 * handful of properties — and a fifth copy of that endpoint would add nothing
 * but a place for them to drift apart. The polities layer carries a year in its
 * path and keeps its own endpoint, like `antiquity-empire`.
 *
 * Every layer rides the atlas cache generation, so an import that rebuilds a
 * table (`refreshAtlasCache`) invalidates the tiles with it.
 */

export type ReferenceLayerId = ReferenceOverlayId

export const isReferenceLayerId = isReferenceOverlayId

/**
 * Keyed by layer so `refreshAtlasCache(['reference:mints:*'])` can drop one
 * layer's tiles without touching the others.
 */
export const buildReferenceCacheKey = (
  layer: ReferenceLayerId,
  tile: TileCoordinate,
  atlasVersion: number,
): string => `reference:${layer}:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

export const buildPolityCacheKey = (
  tile: TileCoordinate,
  atlasVersion: number,
  year: number,
): string => `reference:polities:v${atlasVersion}:${year}:${tile.z}:${tile.x}:${tile.y}`

const BOUNDS_CTE = (tile: TileCoordinate): string => `
  WITH bounds AS (
    SELECT env, ST_Transform(env, 4326) AS env_wgs
    FROM (SELECT ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y}) AS env) AS t
  )
`

/**
 * The zoom below which only main roads are drawn. 14,769 segments, five-eighths
 * of them secondary, is a wall of lines at continental scale; the main network
 * is what a reader can read there, and the rest arrive as they zoom in.
 */
export const ROAD_SECONDARY_MINIMUM_ZOOM = 6

/**
 * The 4326 filter rule applies unchanged: `geom && b.env_wgs` uses the GiST
 * index, `ST_Transform(geom, 3857) && env` cannot. Roads are simplified to about
 * a pixel at the requested zoom (`simplifyTolerance`, Web Mercator metres).
 */
const roadTileSql = (tile: TileCoordinate, simplifyTolerance: number): string => `
  ${BOUNDS_CTE(tile)}
  SELECT ST_AsMVT(rd, 'roman_roads', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_roman_roads.id,
      antiquity_roman_roads.name,
      antiquity_roman_roads.is_main,
      antiquity_roman_roads.certainty::text AS certainty,
      antiquity_roman_roads.itinerary,
      ST_AsMVTGeom(
        ST_Simplify(ST_Transform(antiquity_roman_roads.geom, 3857), ${simplifyTolerance}),
        b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_roman_roads, bounds b
    WHERE antiquity_roman_roads.geom && b.env_wgs
      ${tile.z < ROAD_SECONDARY_MINIMUM_ZOOM ? 'AND antiquity_roman_roads.is_main' : ''}
  ) AS rd
  WHERE rd.geom IS NOT NULL
`

const mintTileSql = (tile: TileCoordinate): string => `
  ${BOUNDS_CTE(tile)}
  SELECT ST_AsMVT(mt, 'mints', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_mints.id,
      antiquity_mints.nomisma_id,
      antiquity_mints.name,
      antiquity_mints.pleiades_id,
      ST_AsMVTGeom(
        ST_Transform(antiquity_mints.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_mints, bounds b
    WHERE antiquity_mints.geom && b.env_wgs
  ) AS mt
  WHERE mt.geom IS NOT NULL
`

const monumentTileSql = (tile: TileCoordinate): string => `
  ${BOUNDS_CTE(tile)}
  SELECT ST_AsMVT(mn, 'monuments', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_monuments.id,
      antiquity_monuments.wikidata_id,
      antiquity_monuments.name,
      antiquity_monuments.kind::text AS kind,
      ST_AsMVTGeom(
        ST_Transform(antiquity_monuments.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_monuments, bounds b
    WHERE antiquity_monuments.geom && b.env_wgs
  ) AS mn
  WHERE mn.geom IS NOT NULL
`

/** `isicily_id`, not the serial `id`, is what the popup links with — it is the stable one. */
const isicilyTileSql = (tile: TileCoordinate): string => `
  ${BOUNDS_CTE(tile)}
  SELECT ST_AsMVT(ic, 'isicily', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      isicily_inscriptions.id,
      isicily_inscriptions.isicily_id,
      isicily_inscriptions.title,
      isicily_inscriptions.language,
      isicily_inscriptions.inscription_function,
      isicily_inscriptions.not_before,
      isicily_inscriptions.not_after,
      isicily_inscriptions.place_name,
      ST_AsMVTGeom(
        ST_Transform(isicily_inscriptions.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM isicily_inscriptions, bounds b
    WHERE isicily_inscriptions.geom IS NOT NULL AND isicily_inscriptions.geom && b.env_wgs
  ) AS ic
  WHERE ic.geom IS NOT NULL
`

/**
 * `types` and `dated_periods` are small key arrays; an MVT property cannot be an array, so they
 * travel as comma-joined strings the popup splits. The atlas's long summaries are not in the
 * table, so nothing heavy can reach a tile.
 */
const hillfortTileSql = (tile: TileCoordinate): string => `
  ${BOUNDS_CTE(tile)}
  SELECT ST_AsMVT(hf, 'hillforts', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      antiquity_hillforts.id,
      antiquity_hillforts.atlas_number,
      antiquity_hillforts.name,
      antiquity_hillforts.country,
      antiquity_hillforts.reliability::text AS reliability,
      array_to_string(antiquity_hillforts.types, ',') AS types,
      array_to_string(antiquity_hillforts.dated_periods, ',') AS dated_periods,
      antiquity_hillforts.area_hectares::float AS area_hectares,
      antiquity_hillforts.altitude_metres,
      ST_AsMVTGeom(
        ST_Transform(antiquity_hillforts.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM antiquity_hillforts, bounds b
    WHERE antiquity_hillforts.geom && b.env_wgs
  ) AS hf
  WHERE hf.geom IS NOT NULL
`

export interface ReferenceTileQuery {
  layer: ReferenceLayerId
  tile: TileCoordinate
  /** Web Mercator metres; only the road layer is simplified. */
  simplifyTolerance: number
}

export const buildReferenceTileSql = (query: ReferenceTileQuery): string => {
  const { layer, tile, simplifyTolerance } = query

  if (layer === 'roman-roads') return roadTileSql(tile, simplifyTolerance)
  if (layer === 'mints') return mintTileSql(tile)
  if (layer === 'monuments') return monumentTileSql(tile)
  if (layer === 'hillforts') return hillfortTileSql(tile)
  return isicilyTileSql(tile)
}

/** The span the period scrubber covers; the same range `antiquity-empire` accepts. */
export const POLITY_EARLIEST_YEAR = -509
export const POLITY_LATEST_YEAR = 476

export interface PolityTileQuery {
  tile: TileCoordinate
  year: number
  simplifyTolerance: number
}

/**
 * Cliopatria slices are inclusive on both ends (`FromYear`..`ToYear`, "any year
 * between … inclusive"), unlike the OHM extents' half-open intervals, so the
 * test is `<=` and `>=`. `year` reaches this string only after the endpoint has
 * proved it an integer inside the imported range.
 *
 * **The Roman extent wins where the two sources disagree.** Measured at all 51
 * scrubber steps (3 Oct 2026): until 66 BCE the neighbours sit outside Rome, but
 * from 27 BCE up to six realms lie 96–100 % inside OpenHistoricalMap's extent
 * (client kingdoms such as Pontus, Cappadocia and Thrace, which OHM counts as
 * Roman while Cliopatria still draws them until their own annexation), and from
 * 407 CE the Franks, Visigoths, Burgundians and Vandals lie inside the Western
 * empire OHM draws until 476. Two sources claiming the same ground would draw it
 * twice and label it twice, so each neighbour is cut by the Roman extent of the
 * same year: a realm shows only the part *outside* Rome, and one wholly inside it
 * disappears. The scrubber is about the Roman state, so OHM is its authority.
 * The Roman side is simplified to about a pixel (in degrees, `metres / 111,320`)
 * *before* it is made valid and clipped — OHM's extents run to 83,000 vertices, and
 * validating them first took a continental tile up to 8 s cold, against 0.2 s this
 * way (all 52 OHM slices are valid already, so the simplified result is repaired
 * rather than the source). The difference is made valid before the result is
 * simplified again.
 *
 * **Slivers are opened away.** Cliopatria's outlines are coarse and run into the sea where
 * OHM's coastline is detailed, so cutting leaves strips of water along every coast — and a
 * label sitting on each ("Kingdom of Pontus" in the Black Sea, "Greek City-States" between
 * the Aegean islands). After the cut, any part narrower than about four pixels is removed
 * (a negative then a positive buffer, in Web Mercator metres), which takes the strips and
 * nothing a reader could see as a territory. Applied wherever the tile holds any Roman extent;
 * a tile with none leaves every outline exactly as published.
 *
 * Largest first, so a small polity is drawn over the empire that once held it
 * rather than hidden under it.
 */
export const buildPolityTileSql = (query: PolityTileQuery): string => {
  const { tile, year, simplifyTolerance } = query

  return `
    ${BOUNDS_CTE(tile)},
    rome AS (
      SELECT ST_Union(ST_MakeValid(ST_Intersection(
        ST_MakeValid(ST_Simplify(e.geom, ${simplifyTolerance / 111320})), b.env_wgs
      ))) AS geom
      FROM antiquity_empire_extents e, bounds b
      WHERE e.geom && b.env_wgs
        AND e.start_year <= ${year}
        AND e.end_year > ${year}
    )
    SELECT ST_AsMVT(pl, 'polities', ${TILE_EXTENT}, 'geom', 'id') AS tile
    FROM (
      SELECT
        antiquity_polities.id,
        antiquity_polities.name,
        antiquity_polities.from_year,
        antiquity_polities.to_year,
        antiquity_polities.wikidata_id,
        antiquity_polities.wikipedia_title,
        ST_AsMVTGeom(
          ST_Simplify(
            CASE WHEN rome.geom IS NULL THEN ST_Transform(antiquity_polities.geom, 3857)
                 ELSE ST_Buffer(
                   ST_Buffer(
                     ST_Transform(
                       ST_CollectionExtract(
                         ST_MakeValid(ST_Difference(ST_MakeValid(antiquity_polities.geom), rome.geom)),
                         3
                       ),
                       3857
                     ),
                     -${simplifyTolerance * 2}
                   ),
                   ${simplifyTolerance * 2}
                 )
            END,
            ${simplifyTolerance}
          ),
          b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
        ) AS geom
      FROM antiquity_polities, bounds b, rome
      WHERE antiquity_polities.geom && b.env_wgs
        AND antiquity_polities.from_year <= ${year}
        AND antiquity_polities.to_year >= ${year}
      ORDER BY antiquity_polities.area_square_kilometres DESC NULLS LAST
    ) AS pl
    WHERE pl.geom IS NOT NULL
  `
}
