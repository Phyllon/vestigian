import { z } from 'zod'
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm'
import { siteImages, sites, users } from '~~/server/database/schema'

export const querySchema = z.object({
  /**
   * `pending` is the review backlog; `unlicensed` is the set that must never
   * publish at all, whatever its review status.
   */
  filter: z.enum(['pending', 'unlicensed', 'all']).default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(40),
})

/**
 * Photographs that need a decision, and photographs that must never have one.
 *
 * Two sets, and the second is the reason this endpoint exists. An image whose
 * licence is `UNKNOWN` or `ARR` is never published — that is a hard rule in
 * the security invariants — but nothing in this application ever *listed*
 * them: they were discoverable only by opening the site page they hang off,
 * which is no use for finding the ones nobody has opened. A rule enforced at
 * render time with no way to audit its inputs is a rule you have to take on
 * trust.
 */
const UNRESOLVED_LICENCES = ['UNKNOWN', 'ARR']

defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'Photographs awaiting review, and photographs with an unresolved licence',
    description:
      'Admin only. The pending backlog, plus every image whose licence is UNKNOWN or ARR at any review status — the set that must never publish, and which no other screen lists.',
  },
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await enforceRateLimit(event, 'admin')
  const { filter, limit } = await getValidatedQuery(event, querySchema.parse)
  const database = useDatabase()

  const FILTERS = {
    pending: eq(siteImages.status, 'pending'),
    unlicensed: and(
      inArray(siteImages.licence, UNRESOLVED_LICENCES),
      // Already-rejected ones are not a problem to solve; they are a problem
      // already solved, and listing them would bury the ones that are live.
      ne(siteImages.status, 'rejected'),
    ),
    all: or(
      eq(siteImages.status, 'pending'),
      and(inArray(siteImages.licence, UNRESOLVED_LICENCES), ne(siteImages.status, 'rejected')),
    ),
  } as const

  const rows = await database
    .select({
      id: siteImages.id,
      siteId: siteImages.siteId,
      siteTitle: sites.title,
      siteSlug: sites.slug,
      caption: siteImages.caption,
      licence: siteImages.licence,
      attribution: siteImages.attribution,
      sourceUrl: siteImages.sourceUrl,
      status: siteImages.status,
      width: siteImages.width,
      height: siteImages.height,
      createdAt: siteImages.createdAt,
      uploaderId: siteImages.createdBy,
      uploaderName: users.displayName,
    })
    .from(siteImages)
    .innerJoin(sites, eq(sites.id, siteImages.siteId))
    // Left, not inner: an upload outlives the account that made it.
    .leftJoin(users, eq(users.id, siteImages.createdBy))
    .where(FILTERS[filter])
    .orderBy(desc(siteImages.id))
    .limit(limit)

  return {
    images: rows.map((row) => ({
      ...row,
      /** The flag the panel colours on: this one cannot be published, ever. */
      licenceUnresolved: UNRESOLVED_LICENCES.includes(row.licence),
      createdAt: row.createdAt.toISOString(),
    })),
  }
})
