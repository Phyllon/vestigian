import { describe, expect, it } from 'vitest'
import { isDisposableEmailDomain } from '../disposable-email'

describe('isDisposableEmailDomain', () => {
  it('rejects a known disposable domain', async () => {
    expect(await isDisposableEmailDomain('someone@mailinator.com')).toBe(true)
  })

  it('accepts a legitimate domain', async () => {
    expect(await isDisposableEmailDomain('someone@gmail.com')).toBe(false)
  })

  it('matches regardless of case', async () => {
    expect(await isDisposableEmailDomain('Someone@MAILINATOR.com')).toBe(true)
  })

  it('does not throw on a malformed address with no domain', async () => {
    expect(await isDisposableEmailDomain('not-an-email')).toBe(false)
  })
})
