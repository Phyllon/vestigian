import { z } from 'zod'
import type { SessionUser, UserRole } from '#shared/types'

const roleSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(['contributor', 'moderator', 'admin']),
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const actor = session.user as SessionUser
  const { userId, role } = await readValidatedBody(event, roleSchema.parse)
  const sql = useSql()

  const [target] = await sql<{ id: number; role: UserRole }[]>`
    SELECT id, role FROM users WHERE id = ${userId} LIMIT 1
  `

  if (!target) throw createError({ statusCode: 404, message: 'No such account.' })

  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM users WHERE role = 'admin'
  `

  const check = checkRoleChange({
    actor,
    targetUserId: userId,
    targetCurrentRole: target.role,
    nextRole: role,
    adminCount: count!,
  })

  if (!check.allowed) {
    throw createError({
      statusCode: 403,
      message: describeRoleChangeRejection(check.reason!),
    })
  }

  await sql`UPDATE users SET role = ${role}::user_role WHERE id = ${userId}`

  return { userId, role }
})
