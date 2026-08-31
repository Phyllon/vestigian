import { describe, expect, it } from 'vitest'
import { articleLanguageOrder } from '../enrichment-sources'

describe('articleLanguageOrder', () => {
  it('keeps the default preference order with no target', () => {
    expect(articleLanguageOrder()).toEqual(['en', 'nl', 'de', 'es', 'it', 'fr'])
  })

  it('moves the requested language to the front', () => {
    expect(articleLanguageOrder('nl')).toEqual(['nl', 'en', 'de', 'es', 'it', 'fr'])
  })

  it('does not duplicate the requested language when it is already first', () => {
    expect(articleLanguageOrder('en')).toEqual(['en', 'nl', 'de', 'es', 'it', 'fr'])
  })
})
