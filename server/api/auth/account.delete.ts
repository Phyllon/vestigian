import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

/**
 * GDPR Art. 17 erasure, for the account itself.
 *
 * Anonymises the row rather than deleting it: `revisions.author_id`,
 * `sites.created_by`, `tracings.created_by` and `site_images.created_by` are
 * all `ON DELETE SET NULL`, so a hard delete would work too, but every one of
 * those tables would then read a plain "Deleted account" fallback with no way
 * to tell one erased contributor from another in the same history — an
 * anonymised row keeps that history exactly as legible as it is for anyone
 * else, without keeping anything that identifies the person. The address and
 * display name become unusable, reserved values (`.invalid` is the TLD
 * RFC 2606 sets aside for exactly this), so the original email is free to
 * register again elsewhere and cannot collide with the next account that
 * picks the same display name.
 *
 * Contribution *content* is not erased — see the Art. 17(3)(d) archival
 * reasoning in CLAUDE.md's GDPR section. What is erased is everything that
 * identifies who wrote it.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Delete the signed-in account',
    description:
      'Anonymises the account (email, display name, password) rather than removing the row, so past contributions keep a legible but unidentifiable history. Ends the session.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser
  await enforceRateLimit(event, 'record')

  const database = useDatabase()

  const [account] = await database
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  // Sent before the address is overwritten — the last message this address
  // will ever receive from Vestigia, per the project's rule that a decision
  // reaches the person it was made about before it becomes irreversible.
  const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')
  await sendAccountMail('account-deleted', {
    to: account.email,
    displayName: account.displayName,
    siteUrl,
  })

  await database
    .update(users)
    .set({
      email: `deleted-${sessionUser.id}@vestigia.invalid`,
      displayName: `Deleted account #${sessionUser.id}`,
      passwordHash: DUMMY_HASH,
      emailVerifiedAt: null,
    })
    .where(eq(users.id, sessionUser.id))

  event.context.log.info(
    { audit: 'auth.account-delete', userId: sessionUser.id },
    'account deleted',
  )

  await clearUserSession(event)

  return { status: 'deleted' }
})
