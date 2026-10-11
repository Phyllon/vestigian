import { describe, expect, it } from 'vitest'
import { parseFeaturedPreference, serialiseFeaturedPreference } from '../useFeaturedSites'

const OFF = { isEnabled: false, isBigPicture: false }

describe('parseFeaturedPreference', () => {
  it('is off when nothing was ever stored', () => {
    expect(parseFeaturedPreference(null)).toEqual(OFF)
  })

  it('reads back exactly what was written', () => {
    for (const preference of [
      OFF,
      { isEnabled: true, isBigPicture: false },
      { isEnabled: true, isBigPicture: true },
      { isEnabled: false, isBigPicture: true },
    ]) {
      expect(parseFeaturedPreference(serialiseFeaturedPreference(preference))).toEqual(preference)
    }
  })

  it('treats anything unreadable as off rather than guessing', () => {
    for (const raw of ['', 'not json', '{', 'null', '42', '"true"', '[]', 'true']) {
      expect(parseFeaturedPreference(raw), raw).toEqual(OFF)
    }
  })

  it('accepts only a real true, not a truthy lookalike', () => {
    expect(parseFeaturedPreference('{"isEnabled":"yes","isBigPicture":1}')).toEqual(OFF)
    expect(parseFeaturedPreference('{"isEnabled":true,"isBigPicture":"true"}')).toEqual({
      isEnabled: true,
      isBigPicture: false,
    })
  })

  it('ignores keys it does not know, so a later version cannot break an earlier one', () => {
    expect(parseFeaturedPreference('{"isEnabled":true,"layout":"wide"}')).toEqual({
      isEnabled: true,
      isBigPicture: false,
    })
  })

  it('returns a fresh object each time, so a caller cannot change the default', () => {
    const first = parseFeaturedPreference(null)
    first.isEnabled = true
    expect(parseFeaturedPreference(null)).toEqual(OFF)
  })
})

describe('serialiseFeaturedPreference', () => {
  it('writes only the two switches', () => {
    expect(
      serialiseFeaturedPreference({
        isEnabled: true,
        isBigPicture: false,
        extra: 'x',
      } as never),
    ).toBe('{"isEnabled":true,"isBigPicture":false}')
  })
})
