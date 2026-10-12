import { describe, expect, it } from 'vitest'
import { EXAMPLE_PARTNERS, PARTNERS, listPartners } from '../partners'

describe('listPartners', () => {
  it('shows no invented organisation unless asked to', () => {
    const listed = listPartners({ includeExamples: false })
    expect(listed.every((partner) => partner.isExample !== true)).toBe(true)
  })

  it('lists the examples when asked, and only those flagged as examples', () => {
    const listed = listPartners({ includeExamples: true })
    expect(listed).toHaveLength(PARTNERS.length + EXAMPLE_PARTNERS.length)
    expect(EXAMPLE_PARTNERS.every((partner) => partner.isExample === true)).toBe(true)
  })

  it('is alphabetical whatever order the data file is in', () => {
    const names = listPartners({ includeExamples: true }).map((partner) => partner.name)
    const sorted = [...names].sort((first, second) =>
      first.localeCompare(second, 'en', { sensitivity: 'base' }),
    )
    expect(names).toEqual(sorted)
  })

  it('does not reorder the source lists it reads', () => {
    const before = EXAMPLE_PARTNERS.map((partner) => partner.id)
    listPartners({ includeExamples: true })
    expect(EXAMPLE_PARTNERS.map((partner) => partner.id)).toEqual(before)
  })

  it('keeps every id unique and URL-safe, since it is an anchor and an i18n key', () => {
    const ids = [...PARTNERS, ...EXAMPLE_PARTNERS].map((partner) => partner.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      const parts = id.split('-')
      expect(
        parts.every((part) => /^[a-z0-9]+$/.test(part)),
        id,
      ).toBe(true)
    }
  })

  it('never links a partner mark off our own origin', () => {
    for (const partner of [...PARTNERS, ...EXAMPLE_PARTNERS]) {
      if (partner.mark) expect(partner.mark.path, partner.id).toMatch(/^\/partner-assets\//)
    }
  })
})
