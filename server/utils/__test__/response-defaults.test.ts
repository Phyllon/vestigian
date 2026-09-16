import { describe, expect, it } from 'vitest'
import { resolveResponseHeaderDefaults } from '../response-defaults'

describe('resolveResponseHeaderDefaults', () => {
  it('defaults cache-control to private, no-store when nothing set one yet', () => {
    expect(resolveResponseHeaderDefaults(undefined)).toEqual({
      cacheControl: 'private, no-store',
      crossOriginResourcePolicy: 'same-origin',
    })
  })

  it('treats an empty string the same as nothing set', () => {
    expect(resolveResponseHeaderDefaults('').cacheControl).toBe('private, no-store')
  })

  it('leaves cache-control alone once a routeRule or handler already set one', () => {
    expect(
      resolveResponseHeaderDefaults('public, max-age=3600, stale-while-revalidate=86400')
        .cacheControl,
    ).toBeUndefined()
    expect(resolveResponseHeaderDefaults('no-store').cacheControl).toBeUndefined()
  })

  it('always applies cross-origin-resource-policy, regardless of cache-control', () => {
    expect(resolveResponseHeaderDefaults(undefined).crossOriginResourcePolicy).toBe('same-origin')
    expect(resolveResponseHeaderDefaults('public, max-age=60').crossOriginResourcePolicy).toBe(
      'same-origin',
    )
  })
})
