import type {
  AtticFindspot,
  AtticFootnote,
  AtticImageCredit,
  AtticInscriptionDetail,
  AtticPlaceRef,
  AtticReference,
  AtticTranslationSegment,
  NearbyAtticInscription,
  TileCoordinate,
} from '#shared/types'
import { TILE_BUFFER, TILE_EXTENT } from './mvt'

/**
 * Cross-referencing for Attic Inscriptions Online (`.claude/rules/
 * epigraphy.md`) against this atlas's own contributed records — the same
 * synergy `findInscriptionsNearSite`/`findInscriptionsNearTracing`
 * (`server/utils/inscriptions.ts`) already provide for the EDH corpus,
 * reused here for the second one. Radii match those functions exactly:
 * AIO's own findspot coordinates are resolved to the Pleiades place level
 * (a deme or a well-known site like the Acropolis), not an excavation
 * trench, the same granularity EDH's Trismegistos-resolved points carry.
 */
const SITE_SEARCH_RADIUS_METRES = 2000
const TRACING_SEARCH_RADIUS_METRES = 300
const NEARBY_RESULT_LIMIT = 20

export const findAtticInscriptionsNearSite = async (
  siteId: number,
): Promise<NearbyAtticInscription[]> => {
  const sql = useSql()

  const rows = await sql<
    { aioKey: string; title: string; monumentType: string | null; distanceMetres: number }[]
  >`
    SELECT
      ai.aio_key AS "aioKey", ai.title, ai.monument_type AS "monumentType",
      ST_Distance(ai.geom::geography, s.geom::geography) AS "distanceMetres"
    FROM attic_inscriptions ai
    JOIN sites s ON s.id = ${siteId} AND s.status = 'approved'
    WHERE ai.geom IS NOT NULL
      AND ST_DWithin(ai.geom::geography, s.geom::geography, ${SITE_SEARCH_RADIUS_METRES})
    ORDER BY "distanceMetres" ASC
    LIMIT ${NEARBY_RESULT_LIMIT}
  `

  return rows.map((row) => ({ ...row, distanceMetres: Math.round(row.distanceMetres) }))
}

export const findAtticInscriptionsNearTracing = async (
  tracingId: number,
): Promise<NearbyAtticInscription[]> => {
  const sql = useSql()

  const rows = await sql<
    { aioKey: string; title: string; monumentType: string | null; distanceMetres: number }[]
  >`
    SELECT
      ai.aio_key AS "aioKey", ai.title, ai.monument_type AS "monumentType",
      ST_Distance(ai.geom::geography, t.geom::geography) AS "distanceMetres"
    FROM attic_inscriptions ai
    JOIN tracings t ON t.id = ${tracingId} AND t.status = 'approved'
    WHERE ai.geom IS NOT NULL
      AND ST_DWithin(ai.geom::geography, t.geom::geography, ${TRACING_SEARCH_RADIUS_METRES})
    ORDER BY "distanceMetres" ASC
    LIMIT ${NEARBY_RESULT_LIMIT}
  `

  return rows.map((row) => ({ ...row, distanceMetres: Math.round(row.distanceMetres) }))
}

export const loadAtticInscriptionDetail = async (
  aioKey: string,
): Promise<AtticInscriptionDetail | null> => {
  const sql = useSql()

  const [row] = await sql<
    {
      aioKey: string
      title: string
      primarySource: string | null
      dateText: string | null
      notBefore: number | null
      notAfter: number | null
      monumentType: string | null
      inscriptionType: string | null
      translators: string[] | null
      translationEdition: AtticTranslationSegment[] | null
      footnotes: AtticFootnote[] | null
      originalLocation: AtticPlaceRef | null
      findspots: AtticFindspot[] | null
      imageCredits: AtticImageCredit[] | null
      references: AtticReference[] | null
      sourceUrl: string
      licence: string
      lon: number | null
      lat: number | null
    }[]
  >`
    SELECT
      aio_key AS "aioKey", title, primary_source AS "primarySource", date_text AS "dateText",
      not_before AS "notBefore", not_after AS "notAfter", monument_type AS "monumentType",
      inscription_type AS "inscriptionType", translators,
      translation_edition AS "translationEdition", footnotes,
      original_location AS "originalLocation", findspots, image_credits AS "imageCredits",
      "references", source_url AS "sourceUrl", licence,
      ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM attic_inscriptions
    WHERE aio_key = ${aioKey}
    LIMIT 1
  `
  if (!row) return null

  const { lon, lat, ...rest } = row

  return { ...rest, position: lon !== null && lat !== null ? { lon, lat } : null }
}

/**
 * Tile assembly for the map's "Show Attic inscriptions" overlay — its own
 * layer rather than folded into `buildInscriptionTileSql`'s EDH source,
 * since the two are separate tables with no shared row identity. Rides the
 * atlas cache generation, same convention as every other imported-reference
 * overlay.
 */
export const buildAtticInscriptionCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `attic-inscription:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

/** One point layer, no simplification — on the order of a couple thousand
 *  geometry-bearing rows, all clustered around Attica, nothing to thin. */
export const buildAtticInscriptionTileSql = (tile: TileCoordinate): string => `
  WITH bounds AS (
    SELECT env, ST_Transform(env, 4326) AS env_wgs
    FROM (SELECT ST_TileEnvelope(${tile.z}, ${tile.x}, ${tile.y}) AS env) AS t
  )
  SELECT ST_AsMVT(pt, 'attic_inscriptions', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      attic_inscriptions.id,
      attic_inscriptions.aio_key,
      attic_inscriptions.title,
      attic_inscriptions.monument_type,
      attic_inscriptions.not_before,
      attic_inscriptions.not_after,
      ST_AsMVTGeom(
        ST_Transform(attic_inscriptions.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM attic_inscriptions, bounds b
    WHERE attic_inscriptions.geom IS NOT NULL AND attic_inscriptions.geom && b.env_wgs
  ) AS pt
  WHERE pt.geom IS NOT NULL
`
