import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import { canRevokeTrust } from '#shared/utils/authorization'

const trustSchema = z.object({
  userId: z.number().int().positive(),
  revoked: z.boolean(),
  reason: z.string().trim().max(300).optional(),
})

/**
 * Revokes or restores a contributor's automatic publishing.
 *
 * Revoking does not touch their approved contribution count, so restoring
 * trust returns them to exactly where they were rather than resetting their
 * standing — a suspension, not a punishment that compounds.
 */
export default defineEventHandler(async (event) => {
  const moderator = await requireModerator(event)
  await enforceRateLimit(event, 'contribute')
  const { userId, revoked } = await readValidatedBody(event, trustSchema.parse)
  const database = useDatabase()

  const [target] = await database
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!target) throw createError({ statusCode: 404, message: 'No such account.' })

  if (!canRevokeTrust(moderator, target.role)) {
    throw createError({
      statusCode: 403,
      message: 'Trust applies to contributors only. Change the role instead.',
    })
  }

  // Only the flag is written. The level itself is derived by `evaluateTrust`
  // wherever it is needed, from the contribution count that revoking
  // deliberately leaves alone — so restoring returns someone to the standing
  // they had earned without this endpoint having to recompute it.
  await database.update(users).set({ trustRevoked: revoked }).where(eq(users.id, userId))

  moderationActionsTotal().inc({ action: 'trust' })
  event.context.log.info(
    { audit: 'moderation.trust', targetUserId: userId, revoked, moderatorId: moderator.id },
    revoked ? 'automatic publishing suspended' : 'trust restored',
  )

  return { userId, trustRevoked: revoked }
})
