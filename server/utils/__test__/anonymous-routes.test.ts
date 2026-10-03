import { describe, expect, it } from 'vitest'
import { describeRequester, isAnonymousRoute } from '../anonymous-routes'

describe('isAnonymousRoute', () => {
  it('covers the browser-timing beacon', () => {
    expect(isAnonymousRoute('/api/vitals')).toBe(true)
  })

  it('leaves every other route logged as before', () => {
    expect(isAnonymousRoute('/api/sites/:id')).toBe(false)
    expect(isAnonymousRoute('/api/auth/login')).toBe(false)
  })
})

describe('describeRequester', () => {
  const requester = { ip: '203.0.113.9', userAgent: 'Mozilla/5.0' }

  it('reports nothing about the sender of an anonymous route and never reads it', () => {
    let resolved = false
    const described = describeRequester('/api/vitals', () => {
      resolved = true
      return requester
    })

    expect(described).toEqual({})
    expect(resolved).toBe(false)
  })

  it('keeps the usual record elsewhere', () => {
    expect(describeRequester('/api/sites/:id', () => requester)).toEqual(requester)
  })
})
