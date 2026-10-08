import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'

/**
 * What the sign-in forms need to say when the server answers 429: how long to
 * wait, how close the person is to the limit, and a countdown that keeps the
 * submit button honest.
 *
 * The server's own sentence ("Too many attempts. Try again in 893 seconds.") is
 * English only, in seconds, and indistinguishable from a wrong password in a
 * toast. This reads the structured `data` it now sends instead, so the wording
 * is the interface's, in the reader's language, in the unit a person thinks in.
 */

/** A wait expressed in the largest unit that does not hide it. */
export interface WaitPhrase {
  unit: 'seconds' | 'minutes'
  count: number
}

export interface RateLimitFailure {
  retryAfterSeconds: number
  /**
   * False when neither the body nor a `Retry-After` header said, and the figure
   * is only a placeholder. A form can still pause on a placeholder; anything
   * that would *state* the wait to a person must not.
   */
  retryAfterKnown: boolean
}

/** Used when a 429 arrives with no usable hint at all: a proxy's, not ours. */
const FALLBACK_RETRY_SECONDS = 60
/** A day is the longest window any policy has; anything above is not ours. */
const MAX_RETRY_SECONDS = 24 * 60 * 60

/** The most attempts left at which the form starts warning. */
export const WARN_AT_ATTEMPTS_REMAINING = 3

interface FetchFailureShape {
  statusCode?: number
  status?: number
  response?: { status?: number; headers?: { get?: (name: string) => string | null } }
  data?: { data?: { retryAfterSeconds?: unknown; attemptsRemaining?: unknown } }
}

const readFailure = (error: unknown): FetchFailureShape =>
  typeof error === 'object' && error !== null ? (error as FetchFailureShape) : {}

const toWholeSeconds = (value: unknown): number | null => {
  const seconds = typeof value === 'string' ? Number(value) : value
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 1) return null
  return Math.min(Math.ceil(seconds), MAX_RETRY_SECONDS)
}

/**
 * `null` when the error is not a rate-limit refusal. Prefers the body the app
 * sends, falls back to the standard `Retry-After` header, and only then to a
 * guess — a 429 is still a 429 even from a proxy that says nothing else.
 */
export const readRateLimitFailure = (error: unknown): RateLimitFailure | null => {
  const failure = readFailure(error)
  const status = failure.statusCode ?? failure.status ?? failure.response?.status
  if (status !== 429) return null

  const fromBody = toWholeSeconds(failure.data?.data?.retryAfterSeconds)
  const fromHeader = toWholeSeconds(failure.response?.headers?.get?.('retry-after'))
  const known = fromBody ?? fromHeader
  return { retryAfterSeconds: known ?? FALLBACK_RETRY_SECONDS, retryAfterKnown: known !== null }
}

/** Attempts left before the limit, or `null` when the server did not say. */
export const readAttemptsRemaining = (error: unknown): number | null => {
  const remaining = readFailure(error).data?.data?.attemptsRemaining
  return typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 0
    ? remaining
    : null
}

/** Whether to warn, given what the server reported. */
export const shouldWarnAboutAttempts = (attemptsRemaining: number | null): boolean =>
  attemptsRemaining !== null && attemptsRemaining <= WARN_AT_ATTEMPTS_REMAINING

/**
 * Seconds up to a minute, whole minutes (rounded up, so "1 minute" never means
 * "nearly gone") beyond that. 893 seconds is "15 minutes", not a number nobody
 * can hold in their head.
 */
export const describeWait = (seconds: number): WaitPhrase => {
  const whole = Math.max(1, Math.ceil(seconds))
  return whole < 60
    ? { unit: 'seconds', count: whole }
    : { unit: 'minutes', count: Math.ceil(whole / 60) }
}

/**
 * The slice of vue-i18n's `t` the wording needs, so the sentences can be built
 * and tested without a Vue app: a plural count (`{n}` is implicit) or named
 * parameters.
 */
export type WaitTranslate = (key: string, valueOrCount: number | Record<string, string>) => string

/** "15 minutes", "40 seconds" — in the reader's language, via `rateLimit.wait.*`. */
export const formatWait = (phrase: WaitPhrase, translate: WaitTranslate): string =>
  translate(`rateLimit.wait.${phrase.unit}`, phrase.count)

/**
 * The one sentence every form can show for a refusal, whatever it was doing.
 * Used to replace the server's English `message` (see the
 * `rate-limit-messages` plugin) so forms that simply print `data.message` need
 * no change of their own.
 */
export const buildRateLimitMessage = (
  retryAfterSeconds: number,
  translate: WaitTranslate,
): string =>
  translate('rateLimit.message', { wait: formatWait(describeWait(retryAfterSeconds), translate) })

/**
 * A countdown against a wall-clock deadline rather than a decremented counter,
 * so a background tab whose timers are throttled still shows the right time
 * when it comes back.
 */
export const useRateLimitCooldown = () => {
  const remainingSeconds = ref(0)
  const isCoolingDown = computed(() => remainingSeconds.value > 0)
  const phrase = computed<WaitPhrase>(() => describeWait(remainingSeconds.value))

  let endsAt = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const stopTimer = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const tick = (): void => {
    remainingSeconds.value = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
    if (remainingSeconds.value === 0) stopTimer()
  }

  const start = (seconds: number): void => {
    stopTimer()
    endsAt = Date.now() + seconds * 1000
    tick()
    if (remainingSeconds.value > 0) timer = setInterval(tick, 1000)
  }

  const clear = (): void => {
    stopTimer()
    remainingSeconds.value = 0
  }

  if (getCurrentScope()) onScopeDispose(stopTimer)

  return { remainingSeconds, isCoolingDown, phrase, start, clear }
}
