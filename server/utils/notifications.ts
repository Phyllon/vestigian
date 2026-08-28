import { eq } from 'drizzle-orm'
import { revisions, sites, users } from '~~/server/database/schema'

/**
 * The messages the atlas sends about something that has already happened.
 *
 * Every one of them is a courtesy, and none of them may change the outcome of
 * the action that triggered it: a moderator's decision is already written and
 * applied by the time anything here runs, so a mail provider having a bad
 * afternoon must not turn a successful review into a 500. Each function
 * therefore swallows its own failures — the lookup as well as the send, since
 * `deliver` only guards the latter — and leaves the trail in the log.
 *
 * CLAUDE.md listed notifications under "Not built" up to this point, with the
 * reasoning that a contributor learns an edit was accepted by looking. That
 * held while the only outcome was publication. It stopped holding for the two
 * events here: a rejection is invisible on the map by definition, and a
 * suspension changes what the person is allowed to do without changing
 * anything they can see.
 */

const notificationLogger = () => useLogger()

interface ReviewNotification {
  revisionId: number
  decision: 'approved' | 'rejected'
  /** The moderator's note, shown to the author verbatim. */
  note?: string | null
  moderatorName: string
}

interface RecordAddress {
  entityType: string
  entityId: number | null
  siteUrl: string
}

/**
 * Resolves the page a published record lives on.
 *
 * Sites are addressed by slug and tracings by id, and a rejected revision for
 * a record that never existed has no page at all — hence the undefined, which
 * the template answers with a link back to the map instead.
 */
const resolveRecordUrl = async (address: RecordAddress): Promise<string | undefined> => {
  if (address.entityId === null) return undefined

  if (address.entityType === 'tracing') return `${address.siteUrl}/tracing/${address.entityId}`

  const [record] = await useDatabase()
    .select({ slug: sites.slug })
    .from(sites)
    .where(eq(sites.id, address.entityId))
    .limit(1)

  return record ? `${address.siteUrl}/site/${record.slug}` : undefined
}

export const notifyReviewDecision = async (notification: ReviewNotification): Promise<void> => {
  try {
    const database = useDatabase()
    const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')

    const [revision] = await database
      .select({
        authorId: revisions.authorId,
        entityType: revisions.entityType,
        entityId: revisions.entityId,
        payload: revisions.payload,
        revertsRevisionId: revisions.revertsRevisionId,
      })
      .from(revisions)
      .where(eq(revisions.id, notification.revisionId))
      .limit(1)

    // A revert carries the moderator as its author, not the contributor, and
    // telling someone their own housekeeping was approved is noise.
    if (!revision || revision.authorId === null || revision.revertsRevisionId !== null) return

    const [author] = await database
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, revision.authorId))
      .limit(1)

    if (!author) return

    const payload = revision.payload as { title?: string; kind?: string }

    await sendAccountMail(
      notification.decision === 'approved' ? 'revision-approved' : 'revision-rejected',
      {
        to: author.email,
        displayName: author.displayName,
        siteUrl,
        recordTitle: payload.title,
        recordKind: revision.entityType,
        recordUrl:
          notification.decision === 'approved'
            ? await resolveRecordUrl({
                entityType: revision.entityType,
                entityId: revision.entityId,
                siteUrl,
              })
            : undefined,
        moderatorName: notification.moderatorName,
        note: notification.note ?? null,
      },
    )
  } catch (error) {
    notificationLogger().error(
      { revisionId: notification.revisionId, decision: notification.decision, error },
      'review notification could not be sent',
    )
  }
}

interface TrustNotification {
  userId: number
  revoked: boolean
  reason?: string | null
  moderatorName: string
}

export const notifyTrustChange = async (notification: TrustNotification): Promise<void> => {
  try {
    const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')

    const [account] = await useDatabase()
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, notification.userId))
      .limit(1)

    if (!account) return

    await sendAccountMail(notification.revoked ? 'trust-suspended' : 'trust-restored', {
      to: account.email,
      displayName: account.displayName,
      siteUrl,
      moderatorName: notification.moderatorName,
      note: notification.reason ?? null,
    })
  } catch (error) {
    notificationLogger().error(
      { targetUserId: notification.userId, revoked: notification.revoked, error },
      'trust notification could not be sent',
    )
  }
}
