import { describe, expect, it } from 'vitest'
import { isDisposableEmailDomain } from '../disposable-email'

describe('isDisposableEmailDomain', () => {
  it('rejects a known disposable domain', () => {
    expect(isDisposableEmailDomain('someone@mailinator.com')).toBe(true)
  })

  it('accepts a legitimate domain', () => {
    expect(isDisposableEmailDomain('someone@gmail.com')).toBe(false)
  })

  it('matches regardless of case', () => {
    expect(isDisposableEmailDomain('Someone@MAILINATOR.com')).toBe(true)
  })

  it('does not throw on a malformed address with no domain', () => {
    expect(isDisposableEmailDomain('not-an-email')).toBe(false)
  })
})
