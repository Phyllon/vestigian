import { desc, eq, sql } from 'drizzle-orm'
import { siteVisits, sites } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

/**
 * The visit log, newest first.
 *
 * Undated visits sort last rather than first: "I have been, I do not recall
 * when" is a real answer (see `site_visits.visited_on`), and treating a null as
 * the beginning of time would bury the entries someone bothered to date.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'The signed-in account’s visit log',
    description:
      'Every site this account has recorded standing on, with its private note, newest first. Undated visits sort last. Never readable by anyone else, and never joined into a public feed.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = (session.user as SessionUser).id
  await enforceRateLimit(event, 'record')

  // Personal data, and specific to one session's account: a shared cache would
  // be a cross-account leak and a CDN one is simply wrong here.
  setResponseHeader(event, 'cache-control', 'private, no-store')

  return useDatabase()
    .select({
      siteId: sites.id,
      slug: sites.slug,
      title: sites.title,
      category: sites.category,
      countryCode: sites.countryCode,
      modernPlace: sites.modernPlace,
      latitude: sql<number>`ST_Y(${sites.geom})`,
      longitude: sql<number>`ST_X(${sites.geom})`,
      visitedOn: siteVisits.visitedOn,
      note: siteVisits.note,
      recordedAt: siteVisits.createdAt,
    })
    .from(siteVisits)
    .innerJoin(sites, eq(sites.id, siteVisits.siteId))
    .where(eq(siteVisits.userId, userId))
    .orderBy(sql`${siteVisits.visitedOn} DESC NULLS LAST`, desc(siteVisits.createdAt))
})
