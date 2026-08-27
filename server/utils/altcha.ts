import { createChallenge, verifySolution } from 'altcha-lib'
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2'
import type { Challenge, Solution } from 'altcha-lib'
import type { H3Event } from 'h3'

/**
 * The signup challenge, self-hosted.
 *
 * This replaces Cloudflare Turnstile, and the trade is worth stating plainly
 * rather than discovering later. Turnstile scored a visitor against
 * Cloudflare's view of that browser across millions of other sites; nothing
 * self-hosted can replicate that, and ALTCHA does not try. It imposes
 * *computational cost* instead, which a funded attacker simply pays. ALTCHA's
 * own documentation says as much: proof of work alone "effectively combats
 * automated spam" but wants their hosted spam filter for anything harder.
 *
 * That downgrade is acceptable here because the challenge was never the
 * load-bearing layer. Login refuses an unverified address, and every new
 * account sits at trust level 0, so a bot that solves the puzzle, confirms an
 * inbox and submits an edit has achieved a row in the moderation queue. The
 * governance model already assumes bad actors; this only has to make automated
 * account creation cost something.
 *
 * What is gained: no third-party script on the signup page, no
 * `challenges.cloudflare.com` in the CSP, no visitor signals leaving the box —
 * the same reasoning that self-hosts the fonts, the images and the translator.
 * And no network call at all, which removes a failure mode the Turnstile
 * version had: it posted to Cloudflare with no timeout and no try/catch, so an
 * outage there took signup down with a 500.
 */

/**
 * PBKDF2 with a cost tuned to roughly a second on a mid-range phone.
 *
 * Argon2id and Scrypt are available and resist GPU farms far better, but they
 * cost real time and memory on the device of every legitimate signup. Start
 * here; move up if abuse is actually observed rather than in anticipation.
 */
const ALGORITHM = 'PBKDF2/SHA-256'

/**
 * Measured, not guessed. `cost` bounds a random counter search, so solve time
 * varies widely around its mean: at 12,000 this machine averaged 675 ms
 * single-threaded with a p90 of 1.7 s, while 60,000 averaged 2.7 s and had a
 * 13.7 s outlier. The widget solves with one worker per core, so a phone lands
 * in the same region rather than several times worse.
 *
 * A signup form is not the place to spend four seconds of someone's attention
 * on a puzzle they did not ask for.
 */
const COST = 12000

/** Long enough to fill in a form unhurried, short enough to bound replay. */
const CHALLENGE_LIFETIME_MS = 10 * 60 * 1000

const readSecret = (): string => {
  const { altchaSecret } = useRuntimeConfig()

  if (!altchaSecret) {
    // Fail closed, but say which knob is missing. The Turnstile version threw a
    // bare 500 here, which looked like an application fault rather than a
    // deployment one.
    throw createError({
      statusCode: 503,
      message: 'Bot protection is not configured. Set NUXT_ALTCHA_SECRET.',
    })
  }

  return altchaSecret
}

export const createSignupChallenge = async (): Promise<Challenge> =>
  createChallenge({
    algorithm: ALGORITHM,
    cost: COST,
    deriveKey,
    hmacSignatureSecret: readSecret(),
    expiresAt: new Date(Date.now() + CHALLENGE_LIFETIME_MS),
  })

interface AltchaPayload {
  challenge: Challenge
  solution: Solution
}

/**
 * The widget submits one base64 blob. Anything malformed is a failed challenge
 * rather than a crash — a bot sending rubbish should get the same answer as a
 * bot sending a wrong solution.
 */
export const decodeAltchaPayload = (payload: string | undefined): AltchaPayload | null => {
  if (!payload) return null

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as unknown

    if (typeof decoded !== 'object' || decoded === null) return null
    const candidate = decoded as Partial<AltchaPayload>

    if (!candidate.challenge?.parameters?.salt || typeof candidate.solution?.counter !== 'number') {
      return null
    }

    return candidate as AltchaPayload
  } catch {
    return null
  }
}

/**
 * Verifies a solved challenge, and refuses one that has been used before.
 *
 * The replay guard is ours to add. `verifySolution` checks the HMAC and the
 * expiry, both of which a replayed payload still satisfies — so without this a
 * single solved challenge would open an account every few seconds until it
 * expired, which is exactly the automation the puzzle exists to price.
 *
 * The salt is the natural key: `createChallenge` generates a fresh random one
 * per challenge, and it is covered by the signature, so it cannot be varied
 * without invalidating the payload.
 *
 * Named and shaped like the Turnstile function it replaces, so the call site in
 * `register.post.ts` did not have to learn anything new.
 */
export const assertHumanVisitor = async (
  event: H3Event,
  payload: string | undefined,
): Promise<void> => {
  const secret = readSecret()
  const decoded = decodeAltchaPayload(payload)

  if (!decoded) {
    throw createError({ statusCode: 400, message: 'Complete the verification challenge.' })
  }

  const result = await verifySolution({
    challenge: decoded.challenge,
    solution: decoded.solution,
    deriveKey,
    hmacSignatureSecret: secret,
  })

  if (!result.verified) {
    throw createError({
      statusCode: 400,
      message: result.expired
        ? 'That challenge expired. Reload the page and try again.'
        : 'Verification failed. Reload the page and try again.',
    })
  }

  await burnChallenge(event, decoded.challenge.parameters.salt)
}

/**
 * Records a solved challenge so it cannot be presented twice.
 *
 * Deliberately fails **closed**, unlike the rate limiter beside it. A cache
 * outage there costs some throttling; here it would silently restore unlimited
 * replay of one solved puzzle, which is the whole attack. Signup is rare enough
 * that refusing it during a Valkey outage is the cheaper failure.
 */
const burnChallenge = async (event: H3Event, salt: string): Promise<void> => {
  const key = `altcha:used:${salt}`

  try {
    const stored = await useRedis().set(key, '1', 'PX', CHALLENGE_LIFETIME_MS, 'NX')

    if (stored === null) {
      throw createError({
        statusCode: 400,
        message: 'That challenge has already been used. Reload the page and try again.',
      })
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 400) throw error

    // The 503 deliberately says nothing specific to the caller, which also
    // means a Valkey outage and a replayed puzzle are indistinguishable from
    // outside. Signup being closed is worth knowing about immediately, so the
    // real cause is recorded here rather than discarded.
    useLogger().error(
      { err: { message: (error as Error).message } },
      'signup challenge unverifiable: cache unreachable',
    )

    throw createError({
      statusCode: 503,
      message: 'Verification is temporarily unavailable. Try again shortly.',
    })
  }
}
