import { z } from 'zod'
import type { SessionUser, TrustLevel, UserRole } from '#shared/types'

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'login')
  const credentials = await readValidatedBody(event, credentialsSchema.parse)
  const sql = useSql()

  const [account] = await sql<
    {
      id: number
      display_name: string
      password_hash: string
      role: UserRole
      trust_level: TrustLevel
      approved_contributions: number
      trust_revoked: boolean
      email_verified_at: Date | null
    }[]
  >`
    SELECT id, display_name, password_hash, role, trust_level,
           approved_contributions, trust_revoked, email_verified_at
    FROM users
    WHERE email = ${credentials.email.toLowerCase()}
    LIMIT 1
  `

  // Always hash, even with no match, so timing does not reveal the user table.
  const isValid = await verifyPasswordArgon(
    account?.password_hash ?? DUMMY_HASH,
    credentials.password,
  )

  if (!account || !isValid) {
    throw createError({ statusCode: 401, message: 'That email and password do not match.' })
  }

  if (!account.email_verified_at && !import.meta.dev) {
    throw createError({ statusCode: 403, message: 'Confirm your email address first.' })
  }

  const user: SessionUser = {
    id: account.id,
    displayName: account.display_name,
    role: account.role,
    trustLevel: evaluateTrust({
      approvedContributions: account.approved_contributions,
      trustRevoked: account.trust_revoked,
      role: account.role,
    }).level,
    approvedContributions: account.approved_contributions,
  }

  await setUserSession(event, { user, loggedInAt: Date.now() })
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${account.id}`

  return { user }
})
