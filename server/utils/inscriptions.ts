import type {
  InscriptionDetail,
  InscriptionEditionLine,
  InscriptionPhoto,
  NearbyInscription,
  TileCoordinate,
} from '#shared/types'
import { TILE_BUFFER, TILE_EXTENT } from './mvt'
import { buildTileEnvelopeSql } from './sql-guard'

/**
 * Cross-referencing for the mirrored EDH inscription corpus
 * (`server/database/schema/epigraphy.ts`) against this atlas's own
 * contributed records — the synergy `.claude/rules/epigraphy.md` describes,
 * not a concordance verification (`server/utils/concordances.ts` already
 * owns that, and writes to `external_ids`/`external_id_verifications`; this
 * file only reads, for display).
 *
 * Both search radii are generous on purpose: EDH findspot coordinates are
 * typically resolved to the ancient settlement/place level, not an exact
 * excavation spot, so a tight radius would under-match. A tracing's own
 * radius is tighter than a site's — a milestone genuinely sits on or beside
 * the road it names, while a settlement-level inscription can be a real
 * distance from a site's own recorded point without being the wrong match.
 */
const SITE_SEARCH_RADIUS_METRES = 2000
const TRACING_SEARCH_RADIUS_METRES = 300
const NEARBY_RESULT_LIMIT = 20

export const findInscriptionsNearSite = async (siteId: number): Promise<NearbyInscription[]> => {
  const sql = useSql()

  const rows = await sql<
    { edhId: string; title: string; inscriptionType: string | null; distanceMetres: number }[]
  >`
    SELECT
      i.edh_id AS "edhId", i.title, i.inscription_type AS "inscriptionType",
      ST_Distance(i.geom::geography, s.geom::geography) AS "distanceMetres"
    FROM inscriptions i
    JOIN sites s ON s.id = ${siteId} AND s.status = 'approved'
    WHERE i.geom IS NOT NULL
      AND ST_DWithin(i.geom::geography, s.geom::geography, ${SITE_SEARCH_RADIUS_METRES})
    ORDER BY "distanceMetres" ASC
    LIMIT ${NEARBY_RESULT_LIMIT}
  `

  return rows.map((row) => ({ ...row, distanceMetres: Math.round(row.distanceMetres) }))
}

export const findInscriptionsNearTracing = async (
  tracingId: number,
): Promise<NearbyInscription[]> => {
  const sql = useSql()

  const rows = await sql<
    { edhId: string; title: string; inscriptionType: string | null; distanceMetres: number }[]
  >`
    SELECT
      i.edh_id AS "edhId", i.title, i.inscription_type AS "inscriptionType",
      ST_Distance(i.geom::geography, t.geom::geography) AS "distanceMetres"
    FROM inscriptions i
    JOIN tracings t ON t.id = ${tracingId} AND t.status = 'approved'
    WHERE i.geom IS NOT NULL
      AND ST_DWithin(i.geom::geography, t.geom::geography, ${TRACING_SEARCH_RADIUS_METRES})
    ORDER BY "distanceMetres" ASC
    LIMIT ${NEARBY_RESULT_LIMIT}
  `

  return rows.map((row) => ({ ...row, distanceMetres: Math.round(row.distanceMetres) }))
}

const PHOTO_DISPLAY_LIMIT = 8

export const loadInscriptionDetail = async (edhId: string): Promise<InscriptionDetail | null> => {
  const sql = useSql()

  const [row] = await sql<
    {
      id: number
      edhId: string
      title: string
      inscriptionType: string | null
      objectType: string | null
      material: string | null
      decorated: boolean
      decorationNote: string | null
      heightCm: string | null
      widthCm: string | null
      depthCm: string | null
      letterHeightCm: string | null
      originPlaceName: string | null
      provinceName: string | null
      notBefore: number | null
      notAfter: number | null
      datingMethod: string | null
      findModernPlace: string | null
      findModernCountryCode: string | null
      textLanguage: string | null
      textDiplomatic: string | null
      textEdition: InscriptionEditionLine[] | null
      commentary: string | null
      bibliography: string[] | null
      sourceUrl: string
      licence: string
      lon: number | null
      lat: number | null
    }[]
  >`
    SELECT
      id, edh_id AS "edhId", title, inscription_type AS "inscriptionType",
      object_type AS "objectType", material, decorated, decoration_note AS "decorationNote",
      height_cm AS "heightCm", width_cm AS "widthCm", depth_cm AS "depthCm",
      letter_height_cm AS "letterHeightCm", origin_place_name AS "originPlaceName",
      province_name AS "provinceName", not_before AS "notBefore", not_after AS "notAfter",
      dating_method AS "datingMethod", find_modern_place AS "findModernPlace",
      find_modern_country_code AS "findModernCountryCode", text_language AS "textLanguage",
      text_diplomatic AS "textDiplomatic", text_edition AS "textEdition", commentary,
      bibliography, source_url AS "sourceUrl", licence,
      ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM inscriptions
    WHERE edh_id = ${edhId}
    LIMIT 1
  `
  if (!row) return null

  const { id, lon, lat, heightCm, widthCm, depthCm, ...rest } = row

  // Capped — one inscription in the corpus carries 127 separate photograph
  // records (a whole excavation's worth of negatives, not one snapshot),
  // and a detail page listing all of them would be a wall of identical
  // "Rights Reserved" credits, not something worth reading.
  const photos = await sql<InscriptionPhoto[]>`
    SELECT edh_photo_id AS "edhPhotoId", rights_holder AS "rightsHolder", source_url AS "sourceUrl"
    FROM inscription_images
    WHERE inscription_id = ${id}
    ORDER BY edh_photo_id ASC
    LIMIT ${PHOTO_DISPLAY_LIMIT}
  `
  const [photoCountRow] = await sql<{ count: string }[]>`
    SELECT count(*) FROM inscription_images WHERE inscription_id = ${id}
  `

  const empireStates = await findEmpireStatesForDating(row.notBefore, row.notAfter)

  return {
    ...rest,
    heightCm: heightCm !== null ? Number(heightCm) : null,
    widthCm: widthCm !== null ? Number(widthCm) : null,
    depthCm: depthCm !== null ? Number(depthCm) : null,
    position: lon !== null && lat !== null ? { lon, lat } : null,
    photos,
    photoCount: Number(photoCountRow?.count ?? 0),
    // The caller (`/api/inscriptions/[edhId].get.ts`) overwrites these three
    // once it knows the reader's target language — this is EDH's own,
    // as-mirrored German metadata.
    language: 'de',
    originalLanguage: 'de',
    isMachineTranslated: false,
    empireStates,
  }
}

/**
 * Tile assembly for the map's "Show inscriptions" overlay — the layer this
 * table gains a `geom` column for in the first place. Rides the atlas cache
 * generation (`buildInscriptionCacheKey`), the same convention every other
 * imported-reference overlay here follows (`server/utils/ports.ts`,
 * `battles.ts`, `coin-hoards.ts`): a shared counter for reference data that
 * changes on its own import's clock, not on a contribution's.
 */
export const buildInscriptionCacheKey = (tile: TileCoordinate, atlasVersion: number): string =>
  `inscription:v${atlasVersion}:${tile.z}:${tile.x}:${tile.y}`

/**
 * One point layer, no simplification — 13,388 geometry-bearing rows
 * worldwide (`.claude/rules/epigraphy.md`), the same order of magnitude as
 * ports (6,007, also drawn unclustered) and nothing to thin at any zoom.
 *
 * The 4326 filter rule from `atlas.ts`/`ports.ts` applies unchanged and for
 * the same reason: `geom && b.env_wgs` uses the GiST index,
 * `ST_Transform(geom, 3857) && env` cannot.
 */
export const buildInscriptionTileSql = (tile: TileCoordinate): string => `
  WITH bounds AS (
    SELECT env, ST_Transform(env, 4326) AS env_wgs
    FROM (SELECT ${buildTileEnvelopeSql(tile)} AS env) AS t
  )
  SELECT ST_AsMVT(pt, 'inscriptions', ${TILE_EXTENT}, 'geom', 'id') AS tile
  FROM (
    SELECT
      inscriptions.id,
      inscriptions.edh_id,
      inscriptions.title,
      inscriptions.inscription_type,
      inscriptions.material,
      inscriptions.not_before,
      inscriptions.not_after,
      ST_AsMVTGeom(
        ST_Transform(inscriptions.geom, 3857), b.env, ${TILE_EXTENT}, ${TILE_BUFFER}, true
      ) AS geom
    FROM inscriptions, bounds b
    WHERE inscriptions.geom IS NOT NULL AND inscriptions.geom && b.env_wgs
  ) AS pt
  WHERE pt.geom IS NOT NULL
`
