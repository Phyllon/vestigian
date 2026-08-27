/**
 * Signing out is deliberately not gated on holding a session — clearing a
 * cookie that is already absent is a no-op, and refusing the request would only
 * strand someone whose session had expired on a page that still shows them as
 * signed in. It is rate limited because it is unauthenticated and writes a
 * response header.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'record')
  await clearUserSession(event)
  return { status: 'signed-out' }
})
