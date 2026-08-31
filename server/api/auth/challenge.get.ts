import type { Challenge } from 'altcha-lib'

/**
 * Issues a proof-of-work challenge for the signup form.
 *
 * Rate limited despite being a GET that reads nothing: each call signs a fresh
 * payload with the server's HMAC secret, so without a limit this is a free
 * oracle for anyone wanting an unlimited supply of valid challenges to solve
 * offline and spend later.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Issue a signup proof-of-work challenge',
    description:
      'A signed, expiring ALTCHA challenge for the registration form. Not cacheable — each call is a fresh puzzle.',
  },
})

export default defineEventHandler(async (event): Promise<Challenge> => {
  await enforceRateLimit(event, 'challenge')

  // A signed, expiring challenge is not cacheable — a shared copy would hand
  // the same puzzle to everyone, which is the replay this is meant to prevent.
  setResponseHeader(event, 'cache-control', 'no-store')

  return createSignupChallenge()
})
