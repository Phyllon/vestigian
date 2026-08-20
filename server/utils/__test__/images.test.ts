import { describe, expect, it } from 'vitest'
import {
  buildRenditionPath,
  isPublishableLicence,
  normaliseLicence,
  signRenditionPath,
  UNKNOWN_LICENCE,
} from '../images'

describe('normaliseLicence', () => {
  it('maps the spellings that occur in the imported data', () => {
    expect(normaliseLicence('CC BY-SA')).toBe('CC-BY-SA-3.0')
    expect(normaliseLicence('  cc-by-sa-3.0 ')).toBe('CC-BY-SA-3.0')
    expect(normaliseLicence('CC BY-SA 4.0')).toBe('CC-BY-SA-4.0')
    expect(normaliseLicence('Public Domain')).toBe('CC0-1.0')
  })

  it('never guesses at an unrecognised string', () => {
    expect(normaliseLicence('ask the photographer')).toBe(UNKNOWN_LICENCE)
    expect(normaliseLicence('')).toBe(UNKNOWN_LICENCE)
    expect(normaliseLicence(null)).toBe(UNKNOWN_LICENCE)
  })
})

describe('isPublishableLicence', () => {
  it('withholds unknown and all-rights-reserved images from the public map', () => {
    expect(isPublishableLicence(UNKNOWN_LICENCE)).toBe(false)
    expect(isPublishableLicence('ARR')).toBe(false)
    expect(isPublishableLicence('CC-BY-SA-3.0')).toBe(true)
  })
})

describe('buildRenditionPath', () => {
  it('encodes the key so slashes cannot escape the path', () => {
    const path = buildRenditionPath({
      storageKey: 'sites/4711/original.jpg',
      width: 800,
      height: 600,
      fit: 'cover',
    })
    expect(path).toContain('/rs:fill:800:600/')
    expect(path.split('/').pop()).not.toContain('sites')
    expect(path.endsWith('.webp')).toBe(true)
  })

  it('distinguishes cover from contain', () => {
    const base = { storageKey: 'a.jpg', width: 10, height: 10 } as const
    expect(buildRenditionPath({ ...base, fit: 'contain' })).toContain('rs:fit:')
  })
})

describe('signRenditionPath', () => {
  it('produces a stable signature for the same path', () => {
    const key = 'a1b2'
    const salt = 'c3d4'
    const path = '/rs:fill:100:100/abc.webp'
    expect(signRenditionPath(path, key, salt)).toBe(signRenditionPath(path, key, salt))
  })

  it('changes when the requested size changes', () => {
    const key = 'a1b2'
    const salt = 'c3d4'
    expect(signRenditionPath('/rs:fill:100:100/abc.webp', key, salt)).not.toBe(
      signRenditionPath('/rs:fill:200:200/abc.webp', key, salt),
    )
  })
})
