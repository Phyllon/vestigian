import { describe, expect, it } from 'vitest'
import { STEP_UP_TTL_SECONDS, stepUpKey } from '../step-up'

describe('stepUpKey', () => {
  it('namespaces the grant so it cannot collide with another Valkey key', () => {
    expect(stepUpKey(7, 1_767_225_600_000)).toBe('admin:stepup:7:1767225600000')
  })

  /**
   * The property the whole design rests on. Keying on the account id alone
   * would let *any* live session for that administrator use a grant the real
   * one minted from their own browser — including the stolen session step-up
   * exists to blunt. `loggedInAt` is sealed into the cookie at login and is
   * not something the holder of a different session can choose.
   */
  it('binds the grant to one session, not to the account', () => {
    expect(stepUpKey(7, 1000)).not.toBe(stepUpKey(7, 2000))
  })

  it('keeps two administrators apart at the same instant', () => {
    expect(stepUpKey(7, 1000)).not.toBe(stepUpKey(8, 1000))
  })

  it('expires well inside a working session', () => {
    expect(STEP_UP_TTL_SECONDS).toBeGreaterThan(60)
    expect(STEP_UP_TTL_SECONDS).toBeLessThanOrEqual(15 * 60)
  })
})
