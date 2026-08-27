import { z } from 'zod'
import { count, eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import { checkRoleChange, describeRoleChangeRejection } from '#shared/utils/authorization'

const roleSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(['contributor', 'moderator', 'admin']),
})

export default defineEventHandler(async (event) => {
  const actor = await requireAdmin(event)
  const { userId, role } = await readValidatedBody(event, roleSchema.parse)
  const database = useDatabase()

  const [target] = await database
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!target) throw createError({ statusCode: 404, message: 'No such account.' })

  // Counted so `checkRoleChange` can refuse to demote the last admin.
  const [admins] = await database
    .select({ total: count() })
    .from(users)
    .where(eq(users.role, 'admin'))

  const check = checkRoleChange({
    actor,
    targetUserId: userId,
    targetCurrentRole: target.role,
    nextRole: role,
    adminCount: admins!.total,
  })

  if (!check.allowed) {
    throw createError({
      statusCode: 403,
      message: describeRoleChangeRejection(check.reason!),
    })
  }

  await database.update(users).set({ role }).where(eq(users.id, userId))

  return { userId, role }
})
