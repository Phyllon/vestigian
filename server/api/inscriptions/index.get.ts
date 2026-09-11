import { z } from 'zod'
import { and, asc, eq, gte, lte, sql as drizzleSql } from 'drizzle-orm'
import { inscriptions } from '~~/server/database/schema'
import type { InscriptionSummary } from '#shared/types'

export const querySchema = z.object({
  type: z.string().trim().min(1).max(80).optional(),
  material: z.string().trim().min(1).max(120).optional(),
  language: z.string().trim().min(1).max(8).optional(),
  decoratedOnly: z.coerce.boolean().default(false),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
})

defineRouteMeta({
  openAPI: {
    tags: ['inscriptions'],
    summary: 'Browse the mirrored EDH inscription corpus',
    description:
      'Imported reference material, not contributed records — filterable by type, material, language and date range, from /inscriptions.',
  },
})

export default defineEventHandler(
  async (event): Promise<{ items: InscriptionSummary[]; hasMore: boolean }> => {
    await enforceRateLimit(event, 'record')
    const { type, material, language, decoratedOnly, yearFrom, yearTo, limit, offset } =
      await getValidatedQuery(event, querySchema.parse)
    const database = useDatabase()
    const materialPattern = material ? `%${material}%` : undefined

    const conditions = [
      type ? eq(inscriptions.inscriptionType, type) : undefined,
      materialPattern ? drizzleSql`${inscriptions.material} ILIKE ${materialPattern}` : undefined,
      language ? eq(inscriptions.textLanguage, language) : undefined,
      decoratedOnly ? eq(inscriptions.decorated, true) : undefined,
      // An undated row can't be said to fall inside a requested range, so a
      // date filter excludes it rather than guessing it belongs — the same
      // "don't guess" restraint this table's own import already follows.
      yearFrom !== undefined ? gte(inscriptions.notAfter, yearFrom) : undefined,
      yearTo !== undefined ? lte(inscriptions.notBefore, yearTo) : undefined,
    ].filter((condition) => condition !== undefined)

    // One row past the page rather than a separate COUNT(*) — cheap to tell
    // "more pages exist" from, and avoids a second full-table-scale query on
    // every page of a 79,000-row table for a number nothing here displays.
    const rows = await database
      .select({
        edhId: inscriptions.edhId,
        title: inscriptions.title,
        inscriptionType: inscriptions.inscriptionType,
        objectType: inscriptions.objectType,
        material: inscriptions.material,
        decorated: inscriptions.decorated,
        notBefore: inscriptions.notBefore,
        notAfter: inscriptions.notAfter,
        textLanguage: inscriptions.textLanguage,
      })
      .from(inscriptions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(inscriptions.edhId))
      .limit(limit + 1)
      .offset(offset)

    return {
      // `position` is always null from this list — the browse grid has no
      // map to plot it on, and selecting `ST_X`/`ST_Y` here would be cost
      // with no reader in this view able to use it. The map tile layer and
      // the single-record detail endpoint are what carry a real position.
      items: rows.slice(0, limit).map((row) => ({ ...row, position: null })),
      hasMore: rows.length > limit,
    }
  },
)
