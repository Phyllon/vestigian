import type { IsicilyInscriptionDetail } from '#shared/types'

/**
 * One I.Sicily record for its detail page. The tile layer is in
 * `reference-layers.ts`; this is the single-record read, a sibling of
 * `loadAtticInscriptionDetail`. Imported by `scripts/import/24-isicily-inscriptions.ts`
 * (CC BY 4.0; six records CC BY-NC 4.0, carried in `licence`).
 */
export const loadIsicilyInscriptionDetail = async (
  isicilyId: string,
): Promise<IsicilyInscriptionDetail | null> => {
  const sql = useSql()

  const [row] = await sql<
    (Omit<IsicilyInscriptionDetail, 'position'> & { lon: number | null; lat: number | null })[]
  >`
    SELECT
      isicily_id AS "isicilyId", title, language,
      inscription_function AS "inscriptionFunction", object_type AS "objectType", material,
      date_text AS "dateText", not_before AS "notBefore", not_after AS "notAfter",
      place_name AS "placeName", ancient_place_name AS "ancientPlaceName",
      pleiades_id AS "pleiadesId", geonames_url AS "geonamesUrl", repository, provenance,
      edition, translation, trismegistos_id AS "trismegistosId", edcs_id AS "edcsId",
      edr_id AS "edrId", licence, source_url AS "sourceUrl",
      ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM isicily_inscriptions
    WHERE isicily_id = ${isicilyId}
    LIMIT 1
  `
  if (!row) return null

  const { lon, lat, ...rest } = row
  return { ...rest, position: lon !== null && lat !== null ? { lon, lat } : null }
}
