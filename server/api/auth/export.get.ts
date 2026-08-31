import { eq } from 'drizzle-orm'
import { revisions, siteImages, sites, tracings, users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

/**
 * GDPR Art. 15/20 — everything this account's row and its own contributions
 * hold, as one JSON document. Read-only, and deliberately scoped to what the
 * requester themselves wrote: this is a self-service export, not an admin
 * tool, and `requireUserSession` is the only authorization it needs because
 * every query below is already filtered to the caller's own id.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Export the signed-in account’s stored data',
    description:
      'Account fields plus every site, tracing, image and revision authored by the caller, as JSON. Scoped to the caller’s own id.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser
  await enforceRateLimit(event, 'record')

  const database = useDatabase()
  const userId = sessionUser.id

  const [account] = await database
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      approvedContributions: users.approvedContributions,
      trustRevoked: users.trustRevoked,
      emailVerifiedAt: users.emailVerifiedAt,
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  const [authoredSites, authoredTracings, authoredImages, authoredRevisions] = await Promise.all([
    database
      .select({
        id: sites.id,
        slug: sites.slug,
        title: sites.title,
        status: sites.status,
        createdAt: sites.createdAt,
      })
      .from(sites)
      .where(eq(sites.createdBy, userId)),
    database
      .select({
        id: tracings.id,
        title: tracings.title,
        status: tracings.status,
        createdAt: tracings.createdAt,
      })
      .from(tracings)
      .where(eq(tracings.createdBy, userId)),
    database
      .select({
        id: siteImages.id,
        siteId: siteImages.siteId,
        status: siteImages.status,
        createdAt: siteImages.createdAt,
      })
      .from(siteImages)
      .where(eq(siteImages.createdBy, userId)),
    database
      .select({
        id: revisions.id,
        entityType: revisions.entityType,
        entityId: revisions.entityId,
        status: revisions.status,
        createdAt: revisions.createdAt,
      })
      .from(revisions)
      .where(eq(revisions.authorId, userId)),
  ])

  event.context.log.info({ audit: 'auth.export', userId }, 'account data exported')

  return {
    account,
    sites: authoredSites,
    tracings: authoredTracings,
    images: authoredImages,
    revisions: authoredRevisions,
  }
})
