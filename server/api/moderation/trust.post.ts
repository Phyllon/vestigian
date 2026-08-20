import { z } from 'zod'
import type { SessionUser, UserRole } from '#shared/types'

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
  const sql = useSql()

  const [target] = await sql<{ id: number; role: UserRole }[]>`
    SELECT id, role FROM users WHERE id = ${userId} LIMIT 1
  `

  if (!target) throw createError({ statusCode: 404, message: 'No such account.' })

  if (!canRevokeTrust(moderator, target.role)) {
    throw createError({
      statusCode: 403,
      message: 'Trust applies to contributors only. Change the role instead.',
    })
  }

  await sql`
    UPDATE users
    SET trust_revoked = ${revoked},
        trust_level = CASE
          WHEN ${revoked} THEN 0
          WHEN approved_contributions >= 2 THEN 1
          ELSE 0
        END
    WHERE id = ${userId}
  `

  return { userId, trustRevoked: revoked }
})
