import type { H3Event } from 'h3'

const VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface TurnstileResponse {
  success: boolean
  'error-codes'?: string[]
}

/**
 * Verifies the Turnstile token that accompanies a signup. A missing or invalid
 * token is a hard failure — this is the only gate between the registration
 * endpoint and an automated account farm.
 */
export const assertHumanVisitor = async (
  event: H3Event,
  token: string | undefined,
): Promise<void> => {
  const secret = process.env.NUXT_TURNSTILE_SECRET_KEY
  if (!secret) {
    if (import.meta.dev) return
    throw createError({ statusCode: 500, message: 'Bot protection is not configured.' })
  }

  if (!token) {
    throw createError({ statusCode: 400, message: 'Complete the verification challenge.' })
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: resolveClientIdentifier(event),
  })

  const result = await $fetch<TurnstileResponse>(VERIFY_ENDPOINT, { method: 'POST', body })

  if (!result.success) {
    throw createError({
      statusCode: 400,
      message: 'Verification failed. Reload the page and try again.',
    })
  }
}
