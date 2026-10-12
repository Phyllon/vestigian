import { describe, expect, it } from 'vitest'
import {
  parseSeenSettingsOptions,
  serialiseSeenSettingsOptions,
  SETTINGS_OPTION_IDS,
} from '../useSettingsHints'

describe('parseSeenSettingsOptions', () => {
  it('has seen nothing when nothing was ever stored', () => {
    expect(parseSeenSettingsOptions(null)).toEqual([])
  })

  it('reads back exactly what was written', () => {
    expect(parseSeenSettingsOptions(serialiseSeenSettingsOptions([]))).toEqual([])
    expect(parseSeenSettingsOptions(serialiseSeenSettingsOptions(['every-site']))).toEqual([
      'every-site',
    ])
  })

  it('treats anything unreadable as nothing seen rather than guessing', () => {
    for (const raw of ['', 'not json', '[', 'null', '42', '"every-site"', '{}', 'true']) {
      expect(parseSeenSettingsOptions(raw), raw).toEqual([])
    }
  })

  it('keeps only ids this build knows, so a stray one cannot hide an option', () => {
    expect(parseSeenSettingsOptions('["every-site","dark-mode",7,null]')).toEqual(['every-site'])
    expect(parseSeenSettingsOptions('["dark-mode"]')).toEqual([])
  })

  it('never returns an id twice, however often it was stored', () => {
    const stored = JSON.stringify([...SETTINGS_OPTION_IDS, ...SETTINGS_OPTION_IDS])
    expect(parseSeenSettingsOptions(stored)).toEqual([...SETTINGS_OPTION_IDS])
  })
})
