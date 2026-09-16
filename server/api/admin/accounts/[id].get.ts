import { z } from 'zod'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import {
  adminAuditLog,
  revisions,
  siteBookmarks,
  siteEndorsements,
  siteImages,
  siteVisits,
  sites,
  tracings,
  users,
} from '~~/server/database/schema'

export const paramsSchema = z.object({ id: routeIdentifier })

export const querySchema = z.object({
  /** How far back through their revision history to read. */
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: routeIdentifier.optional(),
})

/**
 * Everything one account did, in one response — the dossier.
 *
 * Before a sanction, this is the screen the decision is actually made on:
 * whether a run of edits is vandalism or an enthusiast having a productive
 * afternoon is not answerable from a row in a table, and an administrator who
 * has to reconstruct it by clicking through thirty site pages will reach for
 * the ban button instead. It also answers the question after the fact — what
 * exactly would a retraction take offline — which is why the counts here and
 * the counts in the retraction confirmation come from the same data.
 *
 * What it never returns: the password hash, the encrypted TOTP secret, and any
 * IP address. The first two have no use in an interface; addresses live in the
 * request log on their own retention and lawful basis, and duplicating them
 * into a panel would be a new liability rather than a new capability.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'One account’s complete body of work',
    description:
      'Admin only, and audited. Account standing, contribution counts, revision history with diffs, the records they created and the photographs they uploaded. Never the password hash, the TOTP secret, or an IP address.',
  },
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await enforceRateLimit(event, 'admin')
  const { id: userId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { limit, cursor } = await getValidatedQuery(event, querySchema.parse)
  const database = useDatabase()

  const [account] = await database
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      approvedContributions: users.approvedContributions,
      trustRevoked: users.trustRevoked,
      bannedAt: users.bannedAt,
      banReason: users.banReason,
      bannedBy: users.bannedBy,
      emailVerifiedAt: users.emailVerifiedAt,
      twoFactorEnabled: sql<boolean>`${users.totpEnabledAt} IS NOT NULL`,
      publicProfile: users.publicProfile,
      notifyByEmail: users.notifyByEmail,
      preferredLocale: users.preferredLocale,
      bio: users.bio,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      sessionsValidFrom: users.sessionsValidFrom,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!account) throw createError({ statusCode: 404, message: 'No such account.' })

  /**
   * `LIST_CAP` bounds the three lists this returns so a dossier for a
   * prolific contributor cannot become a megabyte of JSON. The *counts* are
   * separate queries rather than `list.length`, which would silently report
   * "200 records" for someone with nine hundred — and those counts are what
   * the retraction confirmation reads, so an undercount there would
   * misdescribe an irreversible-feeling action.
   */
  const LIST_CAP = 200

  /**
   * Every count and list in parallel. Each is an indexed lookup on this
   * account's id, and running them in sequence would make opening a dossier
   * feel like a page load rather than a panel opening.
   */
  const [
    revisionCounts,
    createdSites,
    createdTracings,
    images,
    recordCounts,
    endorsementCount,
    visitCount,
    bookmarkCount,
    history,
    auditTrail,
  ] = await Promise.all([
    database
      .select({ status: revisions.status, total: count() })
      .from(revisions)
      .where(eq(revisions.authorId, userId))
      .groupBy(revisions.status),

    database
      .select({
        id: sites.id,
        title: sites.title,
        slug: sites.slug,
        category: sites.category,
        status: sites.status,
        createdAt: sites.createdAt,
      })
      .from(sites)
      .where(eq(sites.createdBy, userId))
      .orderBy(desc(sites.id))
      .limit(LIST_CAP),

    database
      .select({
        id: tracings.id,
        title: tracings.title,
        kind: tracings.kind,
        status: tracings.status,
        createdAt: tracings.createdAt,
      })
      .from(tracings)
      .where(eq(tracings.createdBy, userId))
      .orderBy(desc(tracings.id))
      .limit(LIST_CAP),

    database
      .select({
        id: siteImages.id,
        siteId: siteImages.siteId,
        licence: siteImages.licence,
        status: siteImages.status,
        createdAt: siteImages.createdAt,
      })
      .from(siteImages)
      .where(eq(siteImages.createdBy, userId))
      .orderBy(desc(siteImages.id))
      .limit(LIST_CAP),

    /**
     * One round trip for the three record counts, because they are what the
     * retraction confirmation counts and they have to agree with each other.
     */
    database
      .select({
        sitesCreated: sql<number>`(SELECT count(*)::int FROM ${sites} WHERE ${sites.createdBy} = ${userId})`,
        tracingsCreated: sql<number>`(SELECT count(*)::int FROM ${tracings} WHERE ${tracings.createdBy} = ${userId})`,
        imagesUploaded: sql<number>`(SELECT count(*)::int FROM ${siteImages} WHERE ${siteImages.createdBy} = ${userId})`,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),

    database
      .select({ total: count() })
      .from(siteEndorsements)
      .where(eq(siteEndorsements.userId, userId)),

    database.select({ total: count() }).from(siteVisits).where(eq(siteVisits.userId, userId)),

    database.select({ total: count() }).from(siteBookmarks).where(eq(siteBookmarks.userId, userId)),

    database
      .select({
        id: revisions.id,
        entityType: revisions.entityType,
        entityId: revisions.entityId,
        payload: revisions.payload,
        previousPayload: revisions.previousPayload,
        editSummary: revisions.editSummary,
        status: revisions.status,
        autoApproved: revisions.autoApproved,
        revertsRevisionId: revisions.revertsRevisionId,
        createdAt: revisions.createdAt,
      })
      .from(revisions)
      .where(
        and(eq(revisions.authorId, userId), cursor ? sql`${revisions.id} < ${cursor}` : undefined),
      )
      .orderBy(desc(revisions.id))
      .limit(limit),

    database
      .select({
        id: adminAuditLog.id,
        action: adminAuditLog.action,
        detail: adminAuditLog.detail,
        createdAt: adminAuditLog.createdAt,
        actorName: users.displayName,
      })
      .from(adminAuditLog)
      .leftJoin(users, eq(users.id, adminAuditLog.actorId))
      .where(and(eq(adminAuditLog.subjectType, 'account'), eq(adminAuditLog.subjectId, userId)))
      .orderBy(desc(adminAuditLog.id))
      .limit(50),
  ])

  const revisionsByStatus = Object.fromEntries(
    revisionCounts.map((row) => [row.status, Number(row.total)]),
  )

  await recordAdminAction({
    actorId: admin.id,
    action: 'account.inspected',
    subjectType: 'account',
    subjectId: userId,
  })

  return {
    account: {
      ...account,
      bannedAt: account.bannedAt?.toISOString() ?? null,
      emailVerifiedAt: account.emailVerifiedAt?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
      lastSeenAt: account.lastSeenAt?.toISOString() ?? null,
      sessionsValidFrom: account.sessionsValidFrom.toISOString(),
    },
    counts: {
      revisions: {
        pending: revisionsByStatus.pending ?? 0,
        approved: revisionsByStatus.approved ?? 0,
        rejected: revisionsByStatus.rejected ?? 0,
      },
      sitesCreated: Number(recordCounts[0]?.sitesCreated ?? 0),
      tracingsCreated: Number(recordCounts[0]?.tracingsCreated ?? 0),
      imagesUploaded: Number(recordCounts[0]?.imagesUploaded ?? 0),
      endorsements: Number(endorsementCount[0]?.total ?? 0),
      visits: Number(visitCount[0]?.total ?? 0),
      bookmarks: Number(bookmarkCount[0]?.total ?? 0),
    },
    createdSites: createdSites.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    createdTracings: createdTracings.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    images: images.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    /** So the panel can say "showing the first 200" instead of implying that is all. */
    listsTruncated: {
      sites: createdSites.length === LIST_CAP,
      tracings: createdTracings.length === LIST_CAP,
      images: images.length === LIST_CAP,
    },
    history: history.map((row) => {
      const changes = diffPayloads(
        row.previousPayload as StoredPayload | null,
        row.payload as StoredPayload,
      )

      return {
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        title: (row.payload as { title?: string }).title ?? null,
        editSummary: row.editSummary,
        status: row.status,
        autoApproved: row.autoApproved === 1,
        isRevert: row.revertsRevisionId !== null,
        isRetraction: (row.payload as { retracted?: boolean }).retracted === true,
        changes,
        substantial: isSubstantialEdit(changes),
        blanking: isBlankingEdit(changes),
        createdAt: row.createdAt.toISOString(),
      }
    }),
    historyCursor: history.length === limit ? history.at(-1)!.id : null,
    auditTrail: auditTrail.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  }
})
