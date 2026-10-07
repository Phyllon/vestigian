import { z } from 'zod'
import type { ReferenceSearchSummary } from '#shared/types'

export const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(10),
})

/**
 * Names from the borrowed reference layers — hillforts, ports, monuments, mints,
 * battles, coin hoards, minor antiquities and Tabula Peutingeriana places — so
 * that anything the map can draw can also be found by typing its name. One
 * endpoint over all of them (`server/utils/reference-search.ts`) rather than one
 * per layer, so the search bar makes one request more per keystroke, not eight.
 */
defineRouteMeta({
  openAPI: {
    tags: ['places'],
    summary: 'Search reference-layer names',
    description:
      'Accent- and punctuation-insensitive search over the names of hillforts, ports, monuments, mints, battles, coin hoards, minor antiquities and Tabula Peutingeriana places, with a trigram fallback for misspellings — for navigating the map, not Vestigian records.',
  },
})

export default defineEventHandler(async (event): Promise<ReferenceSearchSummary[]> => {
  await enforceRateLimit(event, 'search')
  const { q, limit } = await getValidatedQuery(event, querySchema.parse)

  if (tokeniseSearchTerm(q).length === 0) return []

  const rows = await buildReferenceSearchQuery({ sql: useSql(), term: q, limit })

  searchRequestsTotal().inc({ source: 'reference', outcome: rows.length > 0 ? 'results' : 'empty' })

  return rows.map((row) => ({
    id: row.id,
    layer: row.layer,
    title: row.title,
    position: { lon: row.lon, lat: row.lat },
    relevance: row.relevance,
  }))
})
