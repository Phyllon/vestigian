import { z } from 'zod'
import type { PlaceSummary } from '#shared/types'

export const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(10),
})

/**
 * Modern cities and towns, not Vestigian records — see the docstring on
 * `PlaceSummary`. Matching is the same trigram-fallback shape as
 * `sites/search.get.ts`, over `cities` (`scripts/import/09-cities.ts`)
 * instead of `sites`, but ranking is not: an exact prefix match always
 * outranks a fuzzy trigram-only one, and within either group the more
 * populous place wins, not the one whose name happens to be closer in
 * length to the query. Ranking by similarity alone put villages named
 * "Londa"/"Londe" ahead of London for the query "Lond" — trigram similarity
 * rewards a short candidate matching a short query, which has nothing to do
 * with which "Lond…" a reader is actually looking for.
 *
 * Ordering is `relevance` first (`server/utils/search-relevance.ts`), so the
 * prefix band still sorts by population — every prefix match scores exactly
 * 1 — and only a fuzzy-only result is ordered by how close it is.
 */
defineRouteMeta({
  openAPI: {
    tags: ['places'],
    summary: 'Search modern cities and towns',
    description:
      'Full-text search with a trigram fallback for misspellings, over GeoNames.org place names — for navigating the map, not Vestigian records.',
  },
})

export default defineEventHandler(async (event): Promise<PlaceSummary[]> => {
  await enforceRateLimit(event, 'search')
  const { q, limit } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const rows = await sql<
    {
      id: number
      name: string
      countryCode: string
      lon: number
      lat: number
      relevance: number
    }[]
  >`
    SELECT c.id, c.name, c.country_code AS "countryCode", c.lon, c.lat,
      ${buildRelevance({ sql, column: 'c.name', term: q })} AS relevance
    FROM cities c
    WHERE c.name % ${q} OR c.name ILIKE ${q + '%'}
    ORDER BY relevance DESC, c.population DESC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    countryCode: row.countryCode,
    position: { lon: row.lon, lat: row.lat },
    relevance: row.relevance,
  }))
})
