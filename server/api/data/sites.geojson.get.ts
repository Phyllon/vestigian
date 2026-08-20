import { z } from 'zod'

const querySchema = z.object({
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/, 'bbox must be west,south,east,north')
    .optional(),
  category: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})

/**
 * Read-only GeoJSON for reuse by other projects, mirroring the openness that
 * made this data available in the first place. It is bounded and paged, so it
 * is a data feed rather than a way to pull the whole database in one request.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const { bbox, category, limit } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const [west, south, east, north] = bbox
    ? bbox.split(',').map(Number)
    : [-180, -85, 180, 85]

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
    LIMIT ${limit}
  `

  setResponseHeaders(event, {
    'content-type': 'application/geo+json',
    'cache-control': 'public, max-age=300',
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
