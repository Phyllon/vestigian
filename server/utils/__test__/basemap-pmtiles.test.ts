import { describe, expect, it } from 'vitest'
import { readBasemapTile } from '../basemap-pmtiles'

/**
 * `readBasemapTile` reads from a real PMTiles archive over HTTP, and no such
 * archive exists in this environment — this project has never had a
 * `NUXT_PUBLIC_BASEMAP_PMTILES_URL` to test against, dev included, since dev
 * deliberately uses OpenFreeMap instead (see CLAUDE.md's basemap section).
 * What is testable without one is the one thing this file is actually
 * responsible for getting right: refusing cleanly when there is nothing to
 * read. The tile-type-to-content-type mapping and the directory-cache reuse
 * are exercised by the `pmtiles` library's own test suite, not restated here.
 */
describe('readBasemapTile', () => {
  it('returns undefined rather than throwing when no archive is configured', async () => {
    await expect(readBasemapTile('', { z: 5, x: 10, y: 10 })).resolves.toBeUndefined()
  })
})
