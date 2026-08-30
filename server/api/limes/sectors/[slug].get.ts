import { z } from 'zod'
import type { LimesInstallation, LimesMark, LimesSectorDetail } from '#shared/types'
import { buildMilitaryFeatureTypePattern, resolveLimesMark } from '#shared/utils/limes'

const paramsSchema = z.object({ slug: z.string().trim().min(1).max(80) })

/**
 * Anything further from the sector's path than this is not on it.
 *
 * Twenty kilometres is wide enough to hold the supply forts and vici that sat
 * behind a frontier — the second line on the Danube runs 10 to 15 km back — and
 * narrow enough that a town in the interior does not appear in the roll of a
 * frontier it merely shares a province with.
 */
const CORRIDOR_METRES = 20000

/**
 * How close to an end a thing has to be to count as being at that end.
 *
 * `ST_LineLocatePoint` clamps: everything past either end of the path projects
 * onto its first or last vertex, so a fort twenty kilometres beyond the western
 * terminus of Hadrian's Wall came back at offset zero and the roll opened with
 * a dozen entries all reading "at the start". Anything that clamps from further
 * out than this is not on this stretch — it is past the end of it — and is
 * dropped rather than filed at a milepost it never stood at.
 */
const TERMINUS_METRES = 5000

/** Degrees, for the index-using pre-filter. Comfortably wider than the corridor. */
const CORRIDOR_DEGREES = 0.3

interface InstallationRow {
  id: number
  title: string
  slug: string | null
  pleiades_id: string | null
  subcategory: string | null
  feature_types: string | null
  lon: number
  lat: number
  offset_metres: number
  distance_metres: number
}

const toInstallation = (row: InstallationRow): LimesInstallation => ({
  id: row.id,
  title: row.title,
  mark: resolveLimesMark({
    subcategory: row.subcategory,
    featureTypes: row.feature_types,
  }) as LimesMark | null,
  position: { lon: row.lon, lat: row.lat },
  offsetMetres: Math.round(row.offset_metres),
  distanceMetres: Math.round(row.distance_metres),
  slug: row.slug,
  pleiadesId: row.pleiades_id,
})

/**
 * One sector and the roll of installations along it, ordered from one end to
 * the other rather than by id — which is what makes the list an itinerary and
 * the whole feature followable.
 *
 * ## Two halves, never merged
 *
 * `records` are this atlas's own contributed sites; `references` are Pleiades
 * places. They stay in separate arrays all the way to the screen because they
 * carry different licences and different standards of evidence, and a reader is
 * owed the difference. Each half names its own attribution.
 *
 * ## The licence judgement
 *
 * `offsetMetres` is measured against AWMC geometry, which is ODbL, and the
 * records it orders are not. That is deliberate and it is the one place in this
 * project where the two touch. It is computed **on read and never stored**: no
 * column on `sites` holds it, and `/api/data/sites.geojson` gains no field from
 * it, so the contributed database is exactly what it was and what leaves here
 * is a Produced Work with both attributions attached. Storing the offset would
 * be a different question with a different answer.
 *
 * ## Why the pre-filter looks redundant
 *
 * `geom && ST_Expand(path_geom, …)` before the geography distance test is not
 * belt and braces. `ST_DWithin` on geography casts cannot use the GiST index on
 * `sites.geom`, so without the bounding-box term this is a sequential scan over
 * sixty thousand records per sector.
 */
export default defineEventHandler(async (event): Promise<LimesSectorDetail> => {
  await enforceRateLimit(event, 'record')
  const { slug } = await getValidatedRouterParams(event, paramsSchema.parse)

  const sql = useSql()

  const [sector] = await sql<
    {
      id: number
      slug: string
      name: string
      latin_name: string | null
      summary: string | null
      pleiades_id: string | null
      min_year: number | null
      max_year: number | null
      length_metres: number
      west: number
      south: number
      east: number
      north: number
    }[]
  >`
    SELECT id, slug, name, latin_name, summary, pleiades_id, min_year, max_year, length_metres,
           ST_XMin(bbox) AS west, ST_YMin(bbox) AS south,
           ST_XMax(bbox) AS east, ST_YMax(bbox) AS north
    FROM limes_sectors
    WHERE slug = ${slug}
  `

  if (!sector) {
    throw createError({ statusCode: 404, message: 'No such stretch of frontier.' })
  }

  const records = await sql<InstallationRow[]>`
    WITH sector AS (
      SELECT path_geom, ST_Length(path_geom::geography) AS path_metres
      FROM limes_sectors WHERE id = ${sector.id}
    ),
    located AS (
      SELECT s.id, s.title, s.slug, NULL::text AS pleiades_id,
             s.subcategory, NULL::text AS feature_types,
             ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
             ST_LineLocatePoint(sector.path_geom, s.geom) AS fraction,
             ST_LineLocatePoint(sector.path_geom, s.geom) * sector.path_metres AS offset_metres,
             ST_Distance(sector.path_geom::geography, s.geom::geography) AS distance_metres
      FROM sites s, sector
      WHERE s.status = 'approved'
        AND s.category = 'fortification'
        AND s.geom && ST_Expand(sector.path_geom, ${CORRIDOR_DEGREES})
        AND ST_DWithin(sector.path_geom::geography, s.geom::geography, ${CORRIDOR_METRES})
    )
    SELECT id, title, slug, pleiades_id, subcategory, feature_types,
           lon, lat, offset_metres, distance_metres
    FROM located
    WHERE fraction > 0 AND fraction < 1 OR distance_metres <= ${TERMINUS_METRES}
    ORDER BY offset_metres, distance_metres
  `

  const references = await sql<InstallationRow[]>`
    WITH sector AS (
      SELECT path_geom, ST_Length(path_geom::geography) AS path_metres
      FROM limes_sectors WHERE id = ${sector.id}
    ),
    located AS (
      SELECT p.id, p.title, NULL::text AS slug, p.pleiades_id,
             NULL::text AS subcategory, p.feature_types,
             ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat,
             ST_LineLocatePoint(sector.path_geom, p.geom) AS fraction,
             ST_LineLocatePoint(sector.path_geom, p.geom) * sector.path_metres AS offset_metres,
             ST_Distance(sector.path_geom::geography, p.geom::geography) AS distance_metres
      FROM antiquity_places p, sector
      WHERE p.feature_types ~ ${buildMilitaryFeatureTypePattern()}
        AND p.geom && ST_Expand(sector.path_geom, ${CORRIDOR_DEGREES})
        AND ST_DWithin(sector.path_geom::geography, p.geom::geography, ${CORRIDOR_METRES})
    )
    SELECT id, title, slug, pleiades_id, subcategory, feature_types,
           lon, lat, offset_metres, distance_metres
    FROM located
    WHERE fraction > 0 AND fraction < 1 OR distance_metres <= ${TERMINUS_METRES}
    ORDER BY offset_metres, distance_metres
  `

  setResponseHeader(event, 'cache-control', 'public, max-age=600, stale-while-revalidate=86400')

  return {
    id: sector.id,
    slug: sector.slug,
    name: sector.name,
    latinName: sector.latin_name,
    summary: sector.summary,
    pleiadesId: sector.pleiades_id,
    minYear: sector.min_year,
    maxYear: sector.max_year,
    lengthMetres: sector.length_metres,
    bounds: {
      west: sector.west,
      south: sector.south,
      east: sector.east,
      north: sector.north,
    },
    roll: {
      records: records.map(toInstallation),
      references: references.map(toInstallation),
      recordsAttribution: 'Records contributed to this atlas and to Vici.org, CC BY-SA 3.0',
      referencesAttribution: 'Places from Pleiades, CC BY 3.0; frontier from AWMC, ODbL 1.0',
    },
  }
})
