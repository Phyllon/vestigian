/**
 * Puts every structured 429 in the interface language, in minutes.
 *
 * Fifteen places in the interface print `error.data.message` as it comes from
 * the server, and the server's sentence is English and in seconds ("Try again
 * in 893 seconds"). Rewriting the message at the one point they all pass
 * through means a refusal anywhere — an upload, an edit, a moderator action, a
 * step-up — reads properly without touching each of them. Forms that want more
 * than a sentence (a countdown, a disabled button) read the structured
 * `data.retryAfterSeconds` themselves through `useRateLimitNotice`.
 *
 * Only a 429 that says how long is rewritten. One from a proxy with no
 * `Retry-After` is left exactly as received rather than given an invented wait.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const translate: WaitTranslate = (key, valueOrCount) =>
    nuxtApp.$i18n.t(key, valueOrCount as never) as string

  globalThis.$fetch = globalThis.$fetch.create({
    onResponseError: ({ response }) => {
      const body: unknown = response._data
      if (typeof body !== 'object' || body === null) return

      const failure = readRateLimitFailure({ status: response.status, data: body, response })
      if (!failure?.retryAfterKnown) return

      const rewritten = body as { message?: string }
      rewritten.message = buildRateLimitMessage(failure.retryAfterSeconds, translate)
    },
  })
})
