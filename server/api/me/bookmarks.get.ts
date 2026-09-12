import { desc, eq, sql } from 'drizzle-orm'
import { siteBookmarks, sites } from '~~/server/database/schema'

/** The to-visit list, newest first. Feeds the GPX field kit. */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'The signed-in account’s to-visit list',
    description:
      'Sites the caller has marked to go to, newest first. Private, and never joined into a public feed.',
  },
})

export default defineEventHandler(async (event) => {
  const userId = (await requireActiveUser(event)).id
  await enforceRateLimit(event, 'record')

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
      addedAt: siteBookmarks.createdAt,
    })
    .from(siteBookmarks)
    .innerJoin(sites, eq(sites.id, siteBookmarks.siteId))
    .where(eq(siteBookmarks.userId, userId))
    .orderBy(desc(siteBookmarks.createdAt))
})
