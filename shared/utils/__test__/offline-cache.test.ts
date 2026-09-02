import { describe, expect, it } from 'vitest'
import {
  cacheNameForArea,
  isOfflineAreaCacheName,
  isTileRequestPath,
  tileLayerForPath,
} from '../offline-cache'

describe('cacheNameForArea / isOfflineAreaCacheName', () => {
  it('round-trips: a generated name is recognised as an offline-area cache', () => {
    const name = cacheNameForArea('utrecht-2026-06-01')
    expect(isOfflineAreaCacheName(name)).toBe(true)
  })

  it('does not misidentify an unrelated cache name, such as Workbox’s own precache', () => {
    expect(isOfflineAreaCacheName('workbox-precache-v2-https://vestigian.eu/')).toBe(false)
  })
})

describe('tileLayerForPath', () => {
  it('identifies the basemap proxy before the general data prefix', () => {
    // The whole reason for the ordering test: `/api/tiles/basemap/10/5/5.mvt`
    // starts with `/api/tiles/` too, and a naive first-match-wins list would
    // report it as the data layer if basemap were not checked first.
    expect(tileLayerForPath('/api/tiles/basemap/10/5/5.mvt')).toBe('basemap')
  })

  it('identifies antiquity and limes distinctly from data', () => {
    expect(tileLayerForPath('/api/tiles/antiquity/8/3/3.mvt')).toBe('antiquity')
    expect(tileLayerForPath('/api/tiles/limes/8/3/3.mvt')).toBe('limes')
  })

  it('falls back to the data layer for the plain tile route', () => {
    expect(tileLayerForPath('/api/tiles/8/3/3.mvt')).toBe('data')
  })

  it('returns null for anything that is not a tile request', () => {
    expect(tileLayerForPath('/api/sites/1')).toBeNull()
    expect(tileLayerForPath('/site/some-slug')).toBeNull()
  })
})

describe('isTileRequestPath', () => {
  it('agrees with tileLayerForPath about what counts as a tile request', () => {
    expect(isTileRequestPath('/api/tiles/9/1/1.mvt')).toBe(true)
    expect(isTileRequestPath('/api/moderation/queue')).toBe(false)
  })
})
