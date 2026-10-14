import { z } from 'zod'
import type { SectorWatchSummary } from '#shared/types'

export const paramsSchema = z.object({ slug: z.string().trim().min(1).max(80) })

/**
 * What the recorded towers of one frontier sector could do together: how much of
 * the line a signal could cross, where it breaks, which stretches no tower
 * overlooks. Worked out ahead of time by `pnpm sightlines:build` and read from
 * `limes_sector_sightlines`; null for a sector with fewer than two towers or one
 * the script has not been run for.
 *
 * The summary only — a few kilobytes. The ground itself (hundreds of kilobytes of
 * polygons) is `sightlines.geojson`, fetched when the reader asks for it on the
 * map.
 */
defineRouteMeta({
  openAPI: {
    tags: ['limes'],
    summary: 'What a limes sector’s towers could see together',
    description:
      'Chain coverage between neighbouring towers, how far apart they stand against how far apart the ground allowed, breaks, the share of the line overlooked by one or by three towers, and the stretches nothing overlooks. A calculation over recorded towers, worked out by a script; null when none has been run for the sector.',
  },
})

export default defineEventHandler(async (event): Promise<SectorWatchSummary | null> => {
  const { slug } = await getValidatedRouterParams(event, paramsSchema.parse)
  await enforceRateLimit(event, 'enrichment')

  const sql = useSql()
  const [row] = await sql<{ summary: SectorWatchSummary }[]>`
    SELECT summary FROM limes_sector_sightlines WHERE sector_slug = ${slug} LIMIT 1
  `

  setResponseHeader(event, 'cache-control', 'private, max-age=3600')
  return row?.summary ?? null
})
