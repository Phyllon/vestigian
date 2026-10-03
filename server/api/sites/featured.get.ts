import { z } from 'zod'
import { isFeaturable, scoreFeaturedSite } from '#shared/utils/featured'
import type { FeaturedSiteSummary, SiteCategory } from '#shared/types'

/** "Nearby" stops being a neighbourhood well before a continent. */
const MAXIMUM_RADIUS_METRES = 300_000
const DEFAULT_RADIUS_METRES = 25_000

/**
 * The nearest candidates are fetched, then ranked. A fixed pool keeps the query
 * a bounded lookup however crowded the viewport, while still leaving enough to
 * rank among.
 */
const CANDIDATE_POOL = 80

export const querySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  radius: z.coerce
    .number()
    .int()
    .min(500)
    .max(MAXIMUM_RADIUS_METRES)
    .default(DEFAULT_RADIUS_METRES),
  limit: z.coerce.number().int().min(1).max(20).default(8),
})

defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'Featured sites near a point',
    description:
      'Published sites within a radius that have a photograph and a description, best documented first. "Featured" is derived from the record, not an editorial flag.',
  },
})

export default defineEventHandler(async (event): Promise<FeaturedSiteSummary[]> => {
  await enforceRateLimit(event, 'search')
  const { lon, lat, radius, limit } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  /**
   * The bounding-box term is what lets the GiST index on `sites.geom` do the
   * work; the geography cast alone cannot use it — see `needs-work.get.ts`.
   * The first photograph is the one the gallery would lead with
   * (`sort_order, id`), restricted to licences that may be published at all.
   */
  const rows = await sql<
    {
      id: number
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
      image_count: number
      thumbnail_image_id: number | null
      endorsement_count: number
    }[]
  >`
    WITH origin AS (
      SELECT ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) AS point
    )
    SELECT s.id, s.slug, s.title, s.category::text AS category, s.country_code,
           ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
           ST_Distance(s.geom::geography, origin.point::geography) AS distance_metres,
           (s.summary IS NOT NULL AND s.summary <> '') AS has_summary,
           (s.description IS NOT NULL AND s.description <> '') AS has_description,
           (s.period_from IS NOT NULL OR s.period_to IS NOT NULL) AS has_period,
           images.image_count, images.thumbnail_image_id,
           COALESCE(endorsements.endorsement_count, 0) AS endorsement_count
    FROM sites s
    CROSS JOIN origin
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS image_count,
             (array_agg(i.id ORDER BY i.sort_order, i.id))[1] AS thumbnail_image_id
      FROM site_images i
      WHERE i.site_id = s.id AND i.status = 'approved'
        AND i.licence <> 'UNKNOWN' AND i.licence <> 'ARR'
    ) images
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS endorsement_count FROM site_endorsements e WHERE e.site_id = s.id
    ) endorsements ON true
    WHERE s.status = 'approved'
      AND s.description IS NOT NULL AND s.description <> ''
      AND images.image_count > 0
      AND s.geom && ST_Expand(
        origin.point,
        ${radius} / (111320.0 * GREATEST(cos(radians(${lat})), 0.01)),
        ${radius} / 110540.0
      )
      AND ST_DWithin(s.geom::geography, origin.point::geography, ${radius})
    ORDER BY distance_metres
    LIMIT ${CANDIDATE_POOL}
  `

  const featured = rows
    .map((row) => ({
      row,
      candidate: {
        approvedImageCount: Number(row.image_count),
        endorsementCount: Number(row.endorsement_count),
        hasDescription: row.has_description,
        hasPeriod: row.has_period,
        hasSummary: row.has_summary,
      },
    }))
    .filter(({ candidate, row }) => isFeaturable(candidate) && row.thumbnail_image_id !== null)
    .map((entry) => ({ ...entry, score: scoreFeaturedSite(entry.candidate) }))
    .toSorted((a, b) => b.score - a.score || a.row.distance_metres - b.row.distance_metres)
    .slice(0, limit)
    .map(({ row }) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      category: row.category,
      countryCode: row.country_code,
      position: { lon: row.lon, lat: row.lat },
      distanceMetres: Math.round(row.distance_metres),
      thumbnailImageId: row.thumbnail_image_id as number,
    }))

  featuredRequestsTotal().inc({ outcome: featured.length > 0 ? 'results' : 'empty' })
  return featured
})
