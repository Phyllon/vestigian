import { z } from 'zod'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { atticInscriptions } from '~~/server/database/schema'
import type { AtticInscriptionSummary } from '#shared/types'

export const querySchema = z.object({
  monumentType: z.string().trim().min(1).max(80).optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
})

defineRouteMeta({
  openAPI: {
    tags: ['inscriptions'],
    summary: 'Browse the Attic Inscriptions Online corpus',
    description:
      'A second, smaller mirror alongside the EDH corpus — Classical/Hellenistic Athenian decrees, filterable by monument type and date range, from /inscriptions/attic.',
  },
})

export default defineEventHandler(
  async (event): Promise<{ items: AtticInscriptionSummary[]; hasMore: boolean }> => {
    await enforceRateLimit(event, 'record')
    const { monumentType, yearFrom, yearTo, limit, offset } = await getValidatedQuery(
      event,
      querySchema.parse,
    )
    const database = useDatabase()

    const conditions = [
      monumentType ? eq(atticInscriptions.monumentType, monumentType) : undefined,
      // An undated row can't be said to fall inside a requested range, so a
      // date filter excludes it — the same restraint the EDH browse
      // endpoint already applies.
      yearFrom !== undefined ? gte(atticInscriptions.notAfter, yearFrom) : undefined,
      yearTo !== undefined ? lte(atticInscriptions.notBefore, yearTo) : undefined,
    ].filter((condition) => condition !== undefined)

    const rows = await database
      .select({
        aioKey: atticInscriptions.aioKey,
        title: atticInscriptions.title,
        primarySource: atticInscriptions.primarySource,
        dateText: atticInscriptions.dateText,
        notBefore: atticInscriptions.notBefore,
        notAfter: atticInscriptions.notAfter,
        monumentType: atticInscriptions.monumentType,
        inscriptionType: atticInscriptions.inscriptionType,
      })
      .from(atticInscriptions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(atticInscriptions.aioKey))
      .limit(limit + 1)
      .offset(offset)

    return {
      // Same reasoning as the EDH browse endpoint: no map on this grid, so
      // `position` is always null here rather than spending an `ST_X`/`ST_Y`
      // read nothing in this view uses.
      items: rows.slice(0, limit).map((row) => ({ ...row, position: null })),
      hasMore: rows.length > limit,
    }
  },
)
