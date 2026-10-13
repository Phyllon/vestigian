import { describe, expect, it } from 'vitest'
import { isDirectRequest } from '../internal-request'

describe('isDirectRequest', () => {
  it('accepts a scrape over the container network, which carries no proxy header', () => {
    expect(isDirectRequest({ host: 'app:3000', 'user-agent': 'Alloy/1.0' })).toBe(true)
  })

  it.each([
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-origin-key',
    'forwarded',
    'cf-connecting-ip',
  ])('refuses a request that arrived with %s', (name) => {
    expect(isDirectRequest({ host: 'vestigian.eu', [name]: 'anything' })).toBe(false)
  })

  it('does not count x-real-ip, which the CDN and the test suite both send', () => {
    expect(isDirectRequest({ host: 'app:3000', 'x-real-ip': '203.0.113.7' })).toBe(true)
  })

  it('refuses on presence alone, even when the value is empty', () => {
    expect(isDirectRequest({ 'x-forwarded-for': '' })).toBe(false)
  })
})
