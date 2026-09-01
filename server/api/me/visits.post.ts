import { z } from 'zod'
import { siteVisits } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

export const visitSchema = z.object({
  siteId: databaseIdentifier,
  /** ISO date, no time. A visit is a day, not a timestamp. */
  visitedOn: z.string().date().nullish(),
  note: z.string().trim().max(2000).nullish(),
})

/**
 * Records that this account has stood on a site.
 *
 * **This is the one write path in the app that does not go through
 * `applyRevision()`, and it must stay that way.** That function is the single
 * writer for the shared record, and everything it does — queue, diff, review,
 * revert, trust — is about a change other people will read. A visit is not a
 * change to the atlas. Sending it through moderation would put a moderator in
 * front of someone's travel history and make a private note reviewable.
 *
 * Upsert, not insert: one row per person per site. Marking a place twice
 * corrects the entry rather than appending to it, because this records
 * *whether* someone has been somewhere, not an itinerary — and a log of repeat
 * trips is a movement history worth more to an attacker than to its owner.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'Record or update a visit to a site',
    description:
      'Upserts one visit for the caller. Does not go through the revision queue: a visit is personal data, not a change to the shared record. The date and the note are both optional.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = (session.user as SessionUser).id
  await enforceRateLimit(event, 'contribute')

  const { siteId, visitedOn, note } = await readValidatedBody(event, visitSchema.parse)
  await requirePublishedSite(siteId)

  const [visit] = await useDatabase()
    .insert(siteVisits)
    .values({ userId, siteId, visitedOn: visitedOn ?? null, note: note ?? null })
    .onConflictDoUpdate({
      target: [siteVisits.userId, siteVisits.siteId],
      set: { visitedOn: visitedOn ?? null, note: note ?? null },
    })
    .returning({ siteId: siteVisits.siteId, visitedOn: siteVisits.visitedOn })

  /**
   * The audit line carries the site id but never the note. The note is the
   * visitor's own words about a place they were physically standing in, and
   * `REDACTED_FIELDS` in `server/utils/logger.ts` is the wrong mechanism for
   * something that simply should not be passed to the logger.
   */
  event.context.log.info({ audit: 'me.visit', userId, siteId }, 'visit recorded')

  return visit
})
