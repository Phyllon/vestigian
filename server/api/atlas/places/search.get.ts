import { z } from 'zod'
import type { AncientPlaceSummary } from '#shared/types'

export const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(10),
})

/**
 * Ancient names from the Barrington sheet's own gazetteer (`antiquity_places`,
 * imported from AWMC/Pleiades — see `05-antiquity-atlas.ts`), not Vestigian
 * records — the same reasoning and the same trigram-fallback shape as
 * `places/search.get.ts`, over ancient rather than modern names. A reader
 * looking at Gauting on the map has no way to learn it was once
 * "Bratananium" unless that name is itself searchable; this is that path in
 * the other direction, name to place.
 */
defineRouteMeta({
  openAPI: {
    tags: ['places'],
    summary: 'Search ancient place names',
    description:
      'Full-text search with a trigram fallback for misspellings, over the AWMC/Pleiades gazetteer drawn on the Barrington sheet — for navigating the map, not Vestigian records.',
  },
})

export default defineEventHandler(async (event): Promise<AncientPlaceSummary[]> => {
  await enforceRateLimit(event, 'search')
  const { q, limit } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const rows = await sql<
    {
      id: number
      title: string
      category: AncientPlaceSummary['category']
      lon: number
      lat: number
      relevance: number
    }[]
  >`
    SELECT p.id, p.title, p.category, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat,
      ${buildRelevance({ sql, column: 'p.title', term: q })} AS relevance
    FROM antiquity_places p
    WHERE p.title % ${q} OR p.title ILIKE ${q + '%'}
    ORDER BY relevance DESC, similarity(p.title, ${q}) DESC
    LIMIT ${limit}
  `

  searchRequestsTotal().inc({
    source: 'ancient-place',
    outcome: rows.length > 0 ? 'results' : 'empty',
  })

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    position: { lon: row.lon, lat: row.lat },
    relevance: row.relevance,
  }))
})
