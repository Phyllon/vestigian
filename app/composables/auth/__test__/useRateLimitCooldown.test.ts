import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import {
  buildRateLimitMessage,
  describeWait,
  formatWait,
  readAttemptsRemaining,
  readRateLimitFailure,
  shouldWarnAboutAttempts,
  useRateLimitCooldown,
} from '../useRateLimitCooldown'

const refusal = (retryAfterSeconds: unknown, extra: Record<string, unknown> = {}) => ({
  statusCode: 429,
  data: { statusCode: 429, data: { retryAfterSeconds } },
  ...extra,
})

describe('readRateLimitFailure', () => {
  it('reads the structured retry time the app sends', () => {
    expect(readRateLimitFailure(refusal(893))).toEqual({
      retryAfterSeconds: 893,
      retryAfterKnown: true,
    })
  })

  it('falls back to the standard Retry-After header', () => {
    const error = refusal(undefined, {
      response: { status: 429, headers: { get: () => '120' } },
    })
    expect(readRateLimitFailure(error)).toEqual({ retryAfterSeconds: 120, retryAfterKnown: true })
  })

  it('still recognises a 429 that explains nothing, from a proxy for instance', () => {
    expect(readRateLimitFailure({ statusCode: 429 })).toEqual({
      retryAfterSeconds: 60,
      retryAfterKnown: false,
    })
  })

  it('is null for anything that is not a rate-limit refusal', () => {
    expect(
      readRateLimitFailure({ statusCode: 401, data: { data: { retryAfterSeconds: 5 } } }),
    ).toBeNull()
    expect(readRateLimitFailure(new Error('network'))).toBeNull()
    expect(readRateLimitFailure(undefined)).toBeNull()
  })

  it('does not trust nonsense or absurd values', () => {
    expect(readRateLimitFailure(refusal(-5))).toMatchObject({
      retryAfterSeconds: 60,
      retryAfterKnown: false,
    })
    expect(readRateLimitFailure(refusal('soon'))).toMatchObject({
      retryAfterSeconds: 60,
      retryAfterKnown: false,
    })
    expect(readRateLimitFailure(refusal(10 ** 9))).toMatchObject({
      retryAfterSeconds: 86_400,
      retryAfterKnown: true,
    })
  })
})

describe('readAttemptsRemaining and the warning threshold', () => {
  const remaining = (value: unknown) => ({
    statusCode: 401,
    data: { data: { attemptsRemaining: value } },
  })

  it('reads a whole non-negative number and nothing else', () => {
    expect(readAttemptsRemaining(remaining(2))).toBe(2)
    expect(readAttemptsRemaining(remaining(0))).toBe(0)
    expect(readAttemptsRemaining(remaining(-1))).toBeNull()
    expect(readAttemptsRemaining(remaining(1.5))).toBeNull()
    expect(readAttemptsRemaining(remaining('3'))).toBeNull()
    expect(readAttemptsRemaining({ statusCode: 401 })).toBeNull()
  })

  it('warns from three attempts left, never when the server said nothing', () => {
    expect(shouldWarnAboutAttempts(null)).toBe(false)
    expect(shouldWarnAboutAttempts(7)).toBe(false)
    expect(shouldWarnAboutAttempts(4)).toBe(false)
    expect(shouldWarnAboutAttempts(3)).toBe(true)
    expect(shouldWarnAboutAttempts(0)).toBe(true)
  })
})

describe('describeWait', () => {
  it('speaks seconds below a minute and rounded-up minutes above', () => {
    expect(describeWait(1)).toEqual({ unit: 'seconds', count: 1 })
    expect(describeWait(59)).toEqual({ unit: 'seconds', count: 59 })
    expect(describeWait(60)).toEqual({ unit: 'minutes', count: 1 })
    expect(describeWait(61)).toEqual({ unit: 'minutes', count: 2 })
    expect(describeWait(893)).toEqual({ unit: 'minutes', count: 15 })
    expect(describeWait(900)).toEqual({ unit: 'minutes', count: 15 })
  })

  it('never says zero', () => {
    expect(describeWait(0)).toEqual({ unit: 'seconds', count: 1 })
  })
})

describe('the sentence every form can show', () => {
  /** Stands in for vue-i18n: echoes the key and parameters it was given. */
  const translate = (key: string, valueOrCount: number | Record<string, string>): string =>
    typeof valueOrCount === 'number' ? `${key}#${valueOrCount}` : `${key}(${valueOrCount.wait})`

  it('formats a wait through the unit-specific key with the count as plural', () => {
    expect(formatWait({ unit: 'minutes', count: 15 }, translate)).toBe('rateLimit.wait.minutes#15')
    expect(formatWait({ unit: 'seconds', count: 40 }, translate)).toBe('rateLimit.wait.seconds#40')
  })

  it('builds the message from seconds, so 893 reads as minutes', () => {
    expect(buildRateLimitMessage(893, translate)).toBe(
      'rateLimit.message(rateLimit.wait.minutes#15)',
    )
    expect(buildRateLimitMessage(30, translate)).toBe(
      'rateLimit.message(rateLimit.wait.seconds#30)',
    )
  })
})

describe('useRateLimitCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('counts down to zero, then stops cooling down', () => {
    const scope = effectScope()
    const cooldown = scope.run(() => useRateLimitCooldown())!

    cooldown.start(3)
    expect(cooldown.isCoolingDown.value).toBe(true)
    expect(cooldown.remainingSeconds.value).toBe(3)

    vi.advanceTimersByTime(2000)
    expect(cooldown.remainingSeconds.value).toBe(1)

    vi.advanceTimersByTime(1000)
    expect(cooldown.remainingSeconds.value).toBe(0)
    expect(cooldown.isCoolingDown.value).toBe(false)
    scope.stop()
  })

  it('reads the wall clock, so a throttled background tab catches up in one tick', () => {
    const scope = effectScope()
    const cooldown = scope.run(() => useRateLimitCooldown())!

    cooldown.start(600)
    // The tab slept for ten minutes; the timer fires once afterwards.
    vi.setSystemTime(Date.now() + 590_000)
    vi.advanceTimersByTime(1000)

    expect(cooldown.remainingSeconds.value).toBe(9)
    scope.stop()
  })

  it('restarts cleanly and can be cleared', () => {
    const scope = effectScope()
    const cooldown = scope.run(() => useRateLimitCooldown())!

    cooldown.start(100)
    cooldown.start(5)
    expect(cooldown.remainingSeconds.value).toBe(5)

    cooldown.clear()
    expect(cooldown.isCoolingDown.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    scope.stop()
  })

  it('leaves no timer running once its scope is gone', () => {
    const scope = effectScope()
    const cooldown = scope.run(() => useRateLimitCooldown())!

    cooldown.start(100)
    expect(vi.getTimerCount()).toBe(1)

    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
