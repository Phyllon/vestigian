import { eq } from 'drizzle-orm'
import {
  revisions,
  siteBookmarks,
  siteEndorsements,
  siteImages,
  siteVisits,
  sites,
  tracings,
  users,
} from '~~/server/database/schema'

/**
 * GDPR Art. 15/20 — everything this account's row and its own contributions
 * hold, as one JSON document. Read-only, and deliberately scoped to what the
 * requester themselves wrote: this is a self-service export, not an admin
 * tool, and `requireActiveUser` is the only authorization it needs because
 * every query below is already filtered to the caller's own id. **There is no
 * admin variant of this endpoint and there should not be** — `/admin`'s
 * dossier shows an account's contributions, which are public work, and stops
 * short of handing an administrator the same personal-data dump its owner
 * gets for their own use.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Export the signed-in account’s stored data',
    description:
      'Account fields plus every site, tracing, image and revision authored by the caller, the private visit log and to-visit list, and sites the caller has endorsed, as JSON. Scoped to the caller’s own id.',
  },
})

export default defineEventHandler(async (event) => {
  const sessionUser = await requireActiveUser(event)
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
      bio: users.bio,
      homeGround: users.homeGround,
      publicProfile: users.publicProfile,
      notifyByEmail: users.notifyByEmail,
      preferredLocale: users.preferredLocale,
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

  const [
    authoredSites,
    authoredTracings,
    authoredImages,
    authoredRevisions,
    recordedVisits,
    savedPlaces,
    givenEndorsements,
  ] = await Promise.all([
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

    /**
     * The notebook. Not contributions — nobody else can read these — but
     * squarely personal data, and therefore squarely within Art. 15. The note
     * is included in full: it is the subject's own words, and an export that
     * withheld them would be reporting less than the database holds.
     */
    database
      .select({
        siteId: siteVisits.siteId,
        visitedOn: siteVisits.visitedOn,
        note: siteVisits.note,
        createdAt: siteVisits.createdAt,
      })
      .from(siteVisits)
      .where(eq(siteVisits.userId, userId)),
    database
      .select({ siteId: siteBookmarks.siteId, createdAt: siteBookmarks.createdAt })
      .from(siteBookmarks)
      .where(eq(siteBookmarks.userId, userId)),

    /**
     * Not part of the notebook above — see the docstring on
     * `siteEndorsements` for why — but still the caller's own action on
     * their own account, so Art. 15 covers it the same way.
     */
    database
      .select({ siteId: siteEndorsements.siteId, createdAt: siteEndorsements.createdAt })
      .from(siteEndorsements)
      .where(eq(siteEndorsements.userId, userId)),
  ])

  event.context.log.info({ audit: 'auth.export', userId }, 'account data exported')

  return {
    account,
    sites: authoredSites,
    tracings: authoredTracings,
    images: authoredImages,
    revisions: authoredRevisions,
    visits: recordedVisits,
    bookmarks: savedPlaces,
    endorsements: givenEndorsements,
  }
})
