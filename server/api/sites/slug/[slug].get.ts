import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { sites } from '~~/server/database/schema'
import type { SiteDetail } from '#shared/types'

const paramsSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9-]+$/),
})

/**
 * Slug lookup for the shareable site page. Kept separate from the id route so
 * both remain cheap single-index reads rather than one endpoint branching on
 * the shape of its parameter.
 */
export default defineEventHandler(async (event): Promise<SiteDetail> => {
  await enforceRateLimit(event, 'record')
  const { slug } = await getValidatedRouterParams(event, paramsSchema.parse)
  const database = useDatabase()

  const [row] = await database
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.slug, slug), eq(sites.status, 'approved')))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, message: 'No site recorded under that name.' })
  }

  return $fetch<SiteDetail>(`/api/sites/${row.id}`)
})
