import { describe, expect, it } from 'vitest'
import type { SpotSourceId } from '#shared/types'
import { REFERENCE_SOURCES } from '#shared/utils/reference-sources'
import {
  ATLAS_ATTRIBUTION,
  ATTIC_INSCRIPTION_ATTRIBUTION,
  BATTLE_ATTRIBUTION,
  COIN_HOARD_ATTRIBUTION,
  HILLFORT_ATTRIBUTION,
  INSCRIPTION_ATTRIBUTION,
  ISICILY_ATTRIBUTION,
  MINOR_FEATURE_ATTRIBUTION,
  MINT_ATTRIBUTION,
  MONUMENT_ATTRIBUTION,
  PORT_ATTRIBUTION,
} from '../useBasemapStyle'

/**
 * The info box credits a record's source from `REFERENCE_SOURCES`; the map's
 * own credit line states the same thing as an HTML string with wording of its
 * own. A licence changed in one and not the other would be a published
 * misstatement, so this holds them together.
 */
const creditsBySource: Record<SpotSourceId, string[]> = {
  pleiades: [ATLAS_ATTRIBUTION],
  wikidata: [BATTLE_ATTRIBUTION, MONUMENT_ATTRIBUTION],
  'ancient-ports': [PORT_ATTRIBUTION],
  chrr: [COIN_HOARD_ATTRIBUTION],
  awmc: [MINOR_FEATURE_ATTRIBUTION],
  edh: [INSCRIPTION_ATTRIBUTION],
  'attic-inscriptions': [ATTIC_INSCRIPTION_ATTRIBUTION],
  nomisma: [MINT_ATTRIBUTION],
  isicily: [ISICILY_ATTRIBUTION],
  'hillforts-atlas': [HILLFORT_ATTRIBUTION],
}

describe('the source named in a mark’s info box', () => {
  it.each(Object.entries(creditsBySource) as [SpotSourceId, string[]][])(
    'agrees with the map’s credit line for %s',
    (id, credits) => {
      const source = REFERENCE_SOURCES[id]
      for (const credit of credits) {
        expect(credit).toContain(`href="${source.url}"`)
        expect(credit).toContain(source.name)
        expect(credit).toContain(`(${source.licence})`)
      }
    },
  )

  it('has an entry for every source a layer can name', () => {
    expect(Object.keys(REFERENCE_SOURCES).sort()).toEqual(Object.keys(creditsBySource).sort())
  })
})
