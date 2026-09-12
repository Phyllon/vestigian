import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import { checkRoleChange, describeRoleChangeRejection } from '#shared/utils/authorization'

export const roleSchema = z.object({
  userId: databaseIdentifier,
  role: z.enum(['contributor', 'moderator', 'admin']),
})

/**
 * The one endpoint that can create a second permanent administrator.
 *
 * `checkRoleChange` refuses to demote an admin unconditionally, so a grant
 * made here cannot be taken back from inside the application — which is what
 * puts it behind `requireStepUp`. A stolen admin session should buy an
 * attacker the ability to read the panel, not the ability to plant an
 * administrator that only direct database access can remove.
 */
defineRouteMeta({
  openAPI: {
    tags: ['moderation'],
    summary: "Change a user's role",
    description:
      'Admin only, and requires re-authentication (428 until a step-up grant is held). Nobody can change their own role, and no admin can demote another admin — removing an admin requires direct database access.',
  },
})

export default defineEventHandler(async (event) => {
  const actor = await requireAdmin(event)
  await enforceRateLimit(event, 'contribute')
  const { userId, role } = await readValidatedBody(event, roleSchema.parse)
  const database = useDatabase()

  const [target] = await database
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!target) throw createError({ statusCode: 404, message: 'No such account.' })

  const check = checkRoleChange({
    actor,
    targetUserId: userId,
    targetCurrentRole: target.role,
    nextRole: role,
  })

  if (!check.allowed) {
    throw createError({
      statusCode: 403,
      message: describeRoleChangeRejection(check.reason!),
    })
  }

  // After the rules, before the write: a refused change should not have cost
  // the administrator their password.
  await requireStepUp(event, actor)

  await database.update(users).set({ role }).where(eq(users.id, userId))

  await consumeStepUp(event, actor)

  await recordAdminAction({
    actorId: actor.id,
    action: 'account.role-changed',
    subjectType: 'account',
    subjectId: userId,
    detail: { previousRole: target.role, nextRole: role },
  })

  moderationActionsTotal().inc({ action: 'role' })
  event.context.log.info(
    {
      audit: 'moderation.role',
      targetUserId: userId,
      previousRole: target.role,
      nextRole: role,
      actorId: actor.id,
    },
    'role changed',
  )

  return { userId, role }
})
