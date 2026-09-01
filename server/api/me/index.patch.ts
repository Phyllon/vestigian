import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

/**
 * A camera hash — `{zoom}/{lat}/{lon}`, the same string the map already writes
 * into the URL fragment. Validated here rather than parsed, because the codec
 * that reads it lives in `useMapInstance` on the client and this column is
 * write-through storage for it, not a second coordinate format.
 */
const cameraHash = z
  .string()
  .regex(
    /^\d{1,2}(\.\d+)?\/-?\d{1,2}(\.\d+)?\/-?\d{1,3}(\.\d+)?$/,
    'Expected a map position of the form zoom/latitude/longitude.',
  )
  .max(64)

export const profileSchema = z
  .object({
    displayName: z.string().trim().min(3).max(60).optional(),
    bio: z.string().trim().max(280).nullish(),
    homeGround: cameraHash.nullish(),
    publicProfile: z.boolean().optional(),
    notifyByEmail: z.boolean().optional(),
    preferredLocale: z.enum(['en', 'de', 'es', 'fr', 'it', 'nl']).nullish(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change.' })

/**
 * Profile fields, all optional — only what is present is written.
 *
 * Credentials are deliberately not here. A password or an email address is a
 * recovery path, not a preference, and both live under `auth/` where changing
 * one costs the current password and notifies the owner.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'Update the signed-in account’s profile and preferences',
    description:
      'Display name, bio, home ground, public-profile opt-in, email-notification preference and interface language. Only the fields present are written. Credentials are changed under /api/auth instead.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser
  await enforceRateLimit(event, 'contribute')

  const body = await readValidatedBody(event, profileSchema.parse)
  const database = useDatabase()

  /**
   * A display name is public — it is the byline on every record this account
   * contributes — so a collision is reported rather than hidden. That is the
   * same trade `auth/register.post.ts` documents: the enumeration guarantee is
   * worth less than a form that is not a dead end, and this one is behind a
   * session and a rate limit besides.
   */
  if (body.displayName !== undefined) {
    const [taken] = await database
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.displayName, body.displayName), ne(users.id, sessionUser.id)))
      .limit(1)

    if (taken) {
      throw createError({ statusCode: 409, message: 'That display name is already taken.' })
    }
  }

  const [updated] = await database
    .update(users)
    .set(body)
    .where(eq(users.id, sessionUser.id))
    .returning({
      displayName: users.displayName,
      bio: users.bio,
      homeGround: users.homeGround,
      publicProfile: users.publicProfile,
      notifyByEmail: users.notifyByEmail,
      preferredLocale: users.preferredLocale,
    })

  if (!updated) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  /**
   * The session cookie carries `displayName` and is sealed at login, so a
   * rename would otherwise show the old name in the header until the next
   * sign-in. Re-sealing here is safe because nothing else in the session is
   * being trusted — role and trust are re-read from the database by every
   * guard that acts on them, exactly as `server/utils/permissions.ts` sets out.
   */
  if (body.displayName !== undefined) {
    await replaceUserSession(event, {
      ...session,
      user: { ...sessionUser, displayName: updated.displayName },
    })
  }

  event.context.log.info(
    { audit: 'me.profile', userId: sessionUser.id, fields: Object.keys(body) },
    'profile updated',
  )

  return updated
})
