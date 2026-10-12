import { z } from 'zod'

export const paramsSchema = z.object({ slug: z.string().trim().min(1).max(80) })

/**
 * The ground a sector's towers overlook, as GeoJSON for the map: two layers of
 * ground (seen from at least one tower, from three or more), the stretches of the
 * line no tower overlooks, the chain of links between neighbouring towers and the
 * towers. Several hundred kilobytes for a long sector, so it is its own route and
 * is fetched only when a reader switches the layer on.
 *
 * Not in `/api/data`: it carries pieces of the sector's line (ODbL), and is
 * served to the map with the frontier's own attribution, as a produced work.
 */
defineRouteMeta({
  openAPI: {
    tags: ['limes'],
    summary: 'The ground a limes sector’s towers overlook, for the map',
    description:
      'A GeoJSON FeatureCollection: overlooked ground, ground seen from three or more towers, blind stretches of the line, tower-to-tower links and the towers. 404 when no calculation has been run for the sector.',
  },
})

export default defineEventHandler(async (event) => {
  const { slug } = await getValidatedRouterParams(event, paramsSchema.parse)
  await enforceRateLimit(event, 'enrichment')

  const sql = useSql()
  const [row] = await sql<{ layers: unknown }[]>`
    SELECT layers FROM limes_sector_sightlines WHERE sector_slug = ${slug} LIMIT 1
  `
  if (!row) {
    throw createError({ statusCode: 404, message: 'No calculation for that sector.' })
  }

  setResponseHeader(event, 'cache-control', 'private, max-age=3600')
  setResponseHeader(event, 'content-type', 'application/geo+json; charset=utf-8')
  return row.layers
})
