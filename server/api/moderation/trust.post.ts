import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

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
  const moderator = (await requireModerator(event)) as SessionUser
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

  await database
    .update(users)
    .set({
      trustRevoked: revoked,
      // Recomputed from the count that revoking deliberately leaves alone, so
      // restoring returns someone to the level they had earned.
      trustLevel: revoked
        ? 0
        : sql`CASE WHEN ${users.approvedContributions} >= 2 THEN 1 ELSE 0 END`,
    })
    .where(eq(users.id, userId))

  return { userId, trustRevoked: revoked }
})
