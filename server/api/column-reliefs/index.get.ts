import { z } from 'zod'
import { and, asc, eq, notInArray } from 'drizzle-orm'
import { columnReliefPlates } from '~~/server/database/schema'
import type { ColumnReliefMonument, ColumnReliefPlateSummary } from '#shared/types'

export const querySchema = z.object({
  monument: z.enum(['trajans-column']),
})

defineRouteMeta({
  openAPI: {
    tags: ['column-reliefs'],
    summary: "List a monument's mirrored reference plates",
    description:
      "Imported reference material, not contributed records — ordered by the plates' own scene number, from /columns.",
  },
})

export default defineEventHandler(async (event): Promise<ColumnReliefPlateSummary[]> => {
  await enforceRateLimit(event, 'record')
  const { monument } = await getValidatedQuery(event, querySchema.parse)
  const database = useDatabase()

  const rows = await database
    .select({
      id: columnReliefPlates.id,
      monument: columnReliefPlates.monument,
      sceneNumber: columnReliefPlates.sceneNumber,
      title: columnReliefPlates.title,
      description: columnReliefPlates.description,
      licence: columnReliefPlates.licence,
      attribution: columnReliefPlates.attribution,
      width: columnReliefPlates.width,
      height: columnReliefPlates.height,
    })
    .from(columnReliefPlates)
    .where(
      and(
        eq(columnReliefPlates.monument, monument),
        // Same publishable-licence gate as the single-plate redirect route —
        // a stray unrecognised or all-rights-reserved row from the mirror
        // never surfaces here either.
        notInArray(columnReliefPlates.licence, [UNKNOWN_LICENCE, 'ARR']),
      ),
    )
    .orderBy(asc(columnReliefPlates.sortOrder))

  return rows.map((row) => ({ ...row, monument: row.monument as ColumnReliefMonument }))
})
