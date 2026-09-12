import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'

export const revokeSessionsSchema = z.object({ userId: databaseIdentifier })

/**
 * Ends every session an account has open, without sanctioning it.
 *
 * The honest answer to "I think that session is stolen" or "they left a laptop
 * in a lecture hall" — a block would be wrong there, and until
 * `sessions_valid_from` existed there was no answer at all: the session is a
 * stateless sealed cookie, so there was nothing to delete and nothing to
 * expire short of waiting out the seven-day `maxAge`.
 *
 * Deliberately **not** behind step-up. It takes nothing away that signing in
 * again does not restore, and putting a password prompt in front of the one
 * containment action that is available in a hurry would mean it is not
 * available in a hurry. Role changes and blocks are the irreversible pair;
 * this is not one of them.
 *
 * Permitted against an administrator, unlike a block, for exactly that reason.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'End every session an account has open',
    description:
      'Admin only. Bumps the account’s session epoch, so every sealed cookie issued before now is refused on its next request. Reversible by signing in again, so it needs no re-authentication and is permitted against any account.',
  },
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await enforceRateLimit(event, 'contribute')
  const { userId } = await readValidatedBody(event, revokeSessionsSchema.parse)
  const database = useDatabase()

  const [target] = await database
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!target) throw createError({ statusCode: 404, message: 'No such account.' })

  const now = new Date()
  await database.update(users).set({ sessionsValidFrom: now }).where(eq(users.id, userId))

  await recordAdminAction({
    actorId: admin.id,
    action: 'account.sessions-revoked',
    subjectType: 'account',
    subjectId: userId,
  })

  moderationActionsTotal().inc({ action: 'sessions-revoked' })
  event.context.log.info(
    { audit: 'admin.sessions-revoked', targetUserId: userId, actorId: admin.id },
    'sessions revoked',
  )

  return { userId, sessionsValidFrom: now.toISOString() }
})
