import type { H3Event } from 'h3'
import type { SessionUser } from '#shared/types'

/**
 * A short-lived proof that the administrator at the keyboard is the account
 * holder, demanded again at the moment of a sanction rather than assumed from
 * a cookie that may be days old.
 *
 * The panel can promote another account to administrator and can lock someone
 * out. A stolen or borrowed admin session should therefore buy an attacker
 * read-only reconnaissance, not the ability to mint a second permanent
 * administrator — which is exactly the difference this makes, since the grant
 * needs the password again (and a TOTP code, when the account has one).
 */
export const STEP_UP_TTL_SECONDS = 15 * 60

/**
 * Keyed on the session's own `loggedInAt` as well as the account id.
 *
 * Keying on the id alone would let *any* live session for that administrator
 * ride a grant the real one minted from their own browser — including the
 * stolen session this check exists to blunt. `loggedInAt` is sealed into the
 * cookie at login and is not something a holder of a different session can
 * choose, so a grant is bound to the one session that earned it.
 */
export const stepUpKey = (userId: number, loggedInAt: number): string =>
  `admin:stepup:${userId}:${loggedInAt}`

/** The sealed `loggedInAt`, or 0 for a session old enough not to carry one. */
export const readSessionIssuedAt = async (event: H3Event): Promise<number> => {
  const session = await requireUserSession(event)
  return Number(session.loggedInAt ?? 0)
}

export const grantStepUp = async (event: H3Event, user: SessionUser): Promise<number> => {
  const issuedAt = await readSessionIssuedAt(event)
  await useRedis().set(stepUpKey(user.id, issuedAt), '1', 'EX', STEP_UP_TTL_SECONDS)
  return STEP_UP_TTL_SECONDS
}

/**
 * Throws 428 unless this session holds a live grant.
 *
 * **Fails closed**, and that is the one place in this codebase where a cache
 * outage denies rather than permits. `enforceRateLimit` fails open on purpose
 * — a Valkey problem must not lock every visitor out of an atlas — but the
 * same reasoning inverts here: a Valkey problem that let every privileged
 * action through unchecked would turn an outage into a window for exactly the
 * actions that cannot be undone from inside the app.
 *
 * 428 Precondition Required rather than 403: the client's correct response is
 * to ask for the password and try again, which is a precondition to satisfy,
 * not a refusal to report.
 */
export const requireStepUp = async (event: H3Event, user: SessionUser): Promise<void> => {
  const issuedAt = await readSessionIssuedAt(event)

  let granted: string | null

  try {
    granted = await useRedis().get(stepUpKey(user.id, issuedAt))
  } catch (error) {
    event.context.log.error(
      { audit: 'admin.step-up', userId: user.id, err: { message: (error as Error).message } },
      'step-up could not be checked; refusing',
    )
    throw createError({
      statusCode: 503,
      message: 'Cannot confirm your identity right now. Try again shortly.',
    })
  }

  if (!granted) {
    throw createError({
      statusCode: 428,
      message: 'Confirm your password before making this change.',
      data: { stepUpRequired: true },
    })
  }
}

/**
 * Spends the grant. Called after a sanction lands, so one confirmation buys
 * one action rather than a fifteen-minute window in which every further click
 * is unguarded — the window only limits how long an *unused* confirmation
 * stays good.
 */
export const consumeStepUp = async (event: H3Event, user: SessionUser): Promise<void> => {
  const issuedAt = await readSessionIssuedAt(event)

  try {
    await useRedis().del(stepUpKey(user.id, issuedAt))
  } catch {
    // The grant expires on its own within fifteen minutes regardless, and a
    // failure to delete it must not undo the action it authorised.
  }
}
