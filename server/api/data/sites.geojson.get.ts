import { z } from 'zod'
import { siteCategoryEnum } from '~~/server/database/schema'

export const querySchema = z.object({
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/, 'bbox must be west,south,east,north')
    .optional(),
  // An unknown category used to reach the `::site_category` cast and answer 500.
  category: z.enum(siteCategoryEnum.enumValues).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  /**
   * Rows skipped, in `id` order — advance it by `limit` until a page comes back
   * short. Without it the feed claimed to be paged while every request returned
   * the same first 1,000 sites, so 60,000 of 61,273 were unreachable.
   */
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
})

/**
 * Read-only GeoJSON for reuse by other projects, mirroring the openness that
 * made this data available in the first place. It is bounded and paged, so it
 * is a data feed rather than a way to pull the whole database in one request.
 * Reads the live table on every call (the 5-minute `cache-control` is the only
 * staleness), so an approved edit appears here within that window.
 */
defineRouteMeta({
  openAPI: {
    tags: ['data'],
    summary: 'Bulk GeoJSON feed of approved sites',
    description:
      'Read-only, bounded and paged reuse feed. CORS-open. Data is CC BY-SA (text) / CC0 (metadata); image licences vary per record and are not part of this feed.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const { bbox, category, limit, offset } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const [west, south, east, north] = bbox ? bbox.split(',').map(Number) : [-180, -85, 180, 85]

  const rows = await sql<
    {
      id: number
      slug: string
      title: string
      category: string
      period_from: number | null
      period_to: number | null
      licence: string
      attribution: string | null
      lon: number
      lat: number
    }[]
  >`
    SELECT id, slug, title, category::text AS category, period_from, period_to,
           licence, attribution, ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM sites
    WHERE status = 'approved'
      AND geom && ST_MakeEnvelope(${west!}, ${south!}, ${east!}, ${north!}, 4326)
      ${category ? sql`AND category = ${category}::site_category` : sql``}
    ORDER BY id
    LIMIT ${limit} OFFSET ${offset}
  `

  setResponseHeaders(event, {
    'content-type': 'application/geo+json',
    // `private`: the pull zone ignores the query string, so `public` served every
    // bbox/page the first one cached (see `/api/sites/search` in nuxt.config.ts).
    'cache-control': 'private, max-age=300',
    'access-control-allow-origin': '*',
  })

  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      id: row.id,
      geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
      properties: {
        slug: row.slug,
        title: row.title,
        category: row.category,
        periodFrom: row.period_from,
        periodTo: row.period_to,
        licence: row.licence,
        attribution: row.attribution,
        url: `${useRuntimeConfig().public.siteUrl}/site/${row.slug}`,
      },
    })),
  }
})
