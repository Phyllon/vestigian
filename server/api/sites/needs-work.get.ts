import { z } from 'zod'
import { SITE_GAPS, scoreSiteCompleteness, type SiteGap } from '#shared/utils/completeness'
import type { SiteCategory } from '#shared/types'

/** Far enough to plan a day around, bounded so the query stays a lookup. */
const MAXIMUM_RADIUS_METRES = 50_000
const DEFAULT_RADIUS_METRES = 10_000

export const querySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  radius: z.coerce
    .number()
    .int()
    .min(100)
    .max(MAXIMUM_RADIUS_METRES)
    .default(DEFAULT_RADIUS_METRES),
  /** Narrow to one kind of work — `photograph` is the one most visitors can do. */
  missing: z.enum(['photograph', 'description', 'period', 'summary']).optional(),
  category: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

/**
 * Sites near here that are still missing something, nearest first.
 *
 * The atlas holds 61,273 imported records and, until this existed, no way for
 * anyone to find out which of them need work — a project recorded by the people
 * who visit places offered a map to browse and no queue to work from. 82% of
 * those records have no photograph, and a photograph is the one thing that
 * genuinely requires someone to be standing there.
 *
 * Ordered by distance rather than by how incomplete a record is, which is the
 * opposite of what it first seems it should do. The binding constraint on a
 * visitor is where they are; a very incomplete site forty kilometres away is
 * not more useful than a nearly complete one at the end of the road. What
 * completeness decides is *which records appear at all* and what each one asks
 * for — `?missing=photograph` is the query a visitor actually wants.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'Nearby published sites that are still missing something',
    description:
      'Approved sites within a radius that lack a photograph, description, period or summary — nearest first. Intended for contributors deciding where to go, so it reports only gaps the contribution form can actually accept.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const { lon, lat, radius, missing, category, limit } = await getValidatedQuery(
    event,
    querySchema.parse,
  )
  const sql = useSql()

  /**
   * The `geom && ST_Expand(...)` term is not redundant with `ST_DWithin`.
   * A geography cast cannot use the GiST index on `sites.geom`, so without a
   * bounding-box pre-filter this is a sequential scan over sixty thousand rows
   * per request — the same trap `limes/sectors/[slug].get.ts` documents.
   *
   * `ST_Expand` takes degrees, so the radius is converted at the latitude of
   * the query: a degree of longitude is ~111 km at the equator and nothing at
   * the pole, and using a fixed factor would under-cover the box in northern
   * Europe, silently dropping sites that are genuinely within range.
   */
  const rows = await sql<
    {
      slug: string
      title: string
      category: SiteCategory
      country_code: string | null
      lon: number
      lat: number
      distance_metres: number
      has_summary: boolean
      has_description: boolean
      has_period: boolean
      approved_image_count: number
    }[]
  >`
    WITH origin AS (
      SELECT ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) AS point
    )
    SELECT s.slug, s.title, s.category::text AS category, s.country_code,
           ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
           ST_Distance(s.geom::geography, origin.point::geography) AS distance_metres,
           (s.summary IS NOT NULL AND s.summary <> '') AS has_summary,
           (s.description IS NOT NULL AND s.description <> '') AS has_description,
           (s.period_from IS NOT NULL OR s.period_to IS NOT NULL) AS has_period,
           COALESCE(images.approved_count, 0) AS approved_image_count
    FROM sites s
    CROSS JOIN origin
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS approved_count
      FROM site_images i
      WHERE i.site_id = s.id AND i.status = 'approved'
    ) images ON true
    WHERE s.status = 'approved'
      AND s.geom && ST_Expand(
        origin.point,
        ${radius} / (111320.0 * GREATEST(cos(radians(${lat})), 0.01)),
        ${radius} / 110540.0
      )
      AND ST_DWithin(s.geom::geography, origin.point::geography, ${radius})
      ${category ? sql`AND s.category = ${category}::site_category` : sql``}
      ${
        missing === 'photograph'
          ? sql`AND NOT EXISTS (SELECT 1 FROM site_images i WHERE i.site_id = s.id AND i.status = 'approved')`
          : sql``
      }
      ${missing === 'description' ? sql`AND (s.description IS NULL OR s.description = '')` : sql``}
      ${missing === 'summary' ? sql`AND (s.summary IS NULL OR s.summary = '')` : sql``}
      ${missing === 'period' ? sql`AND s.period_from IS NULL AND s.period_to IS NULL` : sql``}
    ORDER BY distance_metres
    LIMIT ${limit}
  `

  const items = rows
    .map((row) => {
      const completeness = scoreSiteCompleteness({
        hasSummary: row.has_summary,
        hasDescription: row.has_description,
        hasPeriod: row.has_period,
        approvedImageCount: Number(row.approved_image_count),
      })

      return {
        slug: row.slug,
        title: row.title,
        category: row.category,
        countryCode: row.country_code,
        position: { lon: row.lon, lat: row.lat },
        distanceMetres: Math.round(row.distance_metres),
        score: completeness.score,
        missing: completeness.missing,
      }
    })
    /**
     * A record with nothing missing is dropped here rather than in SQL. The
     * four gaps are one rule living in `scoreSiteCompleteness`, and duplicating
     * it as a WHERE clause is how the list and the badges would drift into
     * disagreeing about what "complete" means.
     */
    .filter((item) => item.missing.length > 0)

  return { items, gaps: SITE_GAPS satisfies SiteGap[] }
})
