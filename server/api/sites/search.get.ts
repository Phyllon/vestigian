import { z } from 'zod'
import type { SiteSummary } from '#shared/types'

export const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(10),
})

/**
 * Postgres full-text search with a trigram fallback, so a misspelt place name
 * still finds its site. Meilisearch is only worth adding if this stops being
 * fast enough, which at twenty thousand records it will not.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'Search sites by title',
    description:
      'Full-text search with a trigram fallback for misspellings. Titles and summaries only.',
  },
})

export default defineEventHandler(async (event): Promise<SiteSummary[]> => {
  await enforceRateLimit(event, 'search')
  const { q, limit } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const rows = await sql<
    {
      id: number
      slug: string
      title: string
      category: SiteSummary['category']
      lon: number
      lat: number
    }[]
  >`
    SELECT s.id, s.slug, s.title, s.category, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat
    FROM sites s
    WHERE s.status = 'approved'
      AND (
        to_tsvector('simple', s.title || ' ' || coalesce(s.summary, ''))
          @@ plainto_tsquery('simple', ${q})
        OR s.title % ${q}
      )
    ORDER BY similarity(s.title, ${q}) DESC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    position: { lon: row.lon, lat: row.lat },
  }))
})
