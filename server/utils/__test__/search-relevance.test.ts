import { describe, expect, it } from 'vitest'
import { escapeLikePattern } from '../search-relevance'

describe('escapeLikePattern', () => {
  it('makes LIKE wildcards literal', () => {
    expect(escapeLikePattern('100%_pure')).toBe('100\\%\\_pure')
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
  })

  it('leaves ordinary names alone', () => {
    expect(escapeLikePattern('Vitudurum')).toBe('Vitudurum')
  })
})
