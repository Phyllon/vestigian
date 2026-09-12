import { and, count, eq } from 'drizzle-orm'
import { revisions, siteImages, sites, tracings, users } from '~~/server/database/schema'
import { evaluateTrust } from '#shared/utils/authorization'

/**
 * The notebook's front page: who you are here, what you have put in, and where
 * you stand.
 *
 * Distinct from `auth/export.get.ts`, which answers a legal question with an
 * unpaginated dump of rows. This answers "how am I doing" with counts, and is
 * the only endpoint that returns a live `role` and `trustRevoked` — the session
 * cookie is sealed at login, so someone promoted or suspended an hour ago sees
 * the truth here before they see it anywhere else in the interface.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'The signed-in account’s standing and notebook counts',
    description:
      'Live role and trust re-read from the database, authored and pending counts, visit and bookmark totals, countries covered, and the milestone marks derived from them. Scoped to the caller.',
  },
})

export default defineEventHandler(async (event) => {
  const userId = (await requireActiveUser(event)).id
  await enforceRateLimit(event, 'record')

  const database = useDatabase()

  const [[account], [authoredSites], [authoredTracings], [authoredImages], [pending], standing] =
    await Promise.all([
      database
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          approvedContributions: users.approvedContributions,
          trustRevoked: users.trustRevoked,
          bio: users.bio,
          homeGround: users.homeGround,
          publicProfile: users.publicProfile,
          notifyByEmail: users.notifyByEmail,
          preferredLocale: users.preferredLocale,
          emailVerifiedAt: users.emailVerifiedAt,
          totpEnabledAt: users.totpEnabledAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),

      database
        .select({ total: count(sites.id) })
        .from(sites)
        .where(eq(sites.createdBy, userId)),
      database
        .select({ total: count(tracings.id) })
        .from(tracings)
        .where(eq(tracings.createdBy, userId)),
      database
        .select({ total: count(siteImages.id) })
        .from(siteImages)
        .where(eq(siteImages.createdBy, userId)),

      // What is still waiting on a moderator. The one number a contributor on
      // probation actually wants, and the reason the queue feels like silence
      // without it.
      database
        .select({ total: count(revisions.id) })
        .from(revisions)
        .where(and(eq(revisions.authorId, userId), eq(revisions.status, 'pending'))),

      readNotebookStanding(userId),
    ])

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  return {
    account,
    trust: evaluateTrust(account),
    contributions: {
      sites: authoredSites?.total ?? 0,
      tracings: authoredTracings?.total ?? 0,
      images: authoredImages?.total ?? 0,
      pending: pending?.total ?? 0,
    },
    notebook: standing,
  }
})
