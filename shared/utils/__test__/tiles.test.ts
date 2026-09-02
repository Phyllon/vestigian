import { describe, expect, it } from 'vitest'
import { MAX_ENUMERATED_TILES, TileCountExceededError, enumerateTiles, sampleTiles } from '../tiles'
import type { BoundingBox } from '#shared/types'

const utrecht: BoundingBox = { west: 5.0, south: 52.0, east: 5.2, north: 52.15 }

describe('enumerateTiles', () => {
  it('covers a single tile at zoom 0', () => {
    const tiles = enumerateTiles(utrecht, 0, 0)
    expect(tiles).toEqual([{ z: 0, x: 0, y: 0 }])
  })

  it('produces more tiles at a higher zoom for the same bbox', () => {
    const low = enumerateTiles(utrecht, 8, 8)
    const high = enumerateTiles(utrecht, 12, 12)
    expect(high.length).toBeGreaterThan(low.length)
  })

  it('orders low zoom before high zoom, so a cancelled download keeps the overview', () => {
    const tiles = enumerateTiles(utrecht, 6, 9)
    const zooms = tiles.map((tile) => tile.z)
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b))
    expect(zooms[0]).toBe(6)
    expect(zooms.at(-1)).toBe(9)
  })

  it('produces no duplicate coordinates within a zoom level', () => {
    const tiles = enumerateTiles(utrecht, 10, 10)
    const keys = tiles.map((t) => `${t.z}/${t.x}/${t.y}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('handles minZoom and maxZoom given in either order', () => {
    expect(enumerateTiles(utrecht, 9, 6)).toEqual(enumerateTiles(utrecht, 6, 9))
  })

  it('refuses a request over the enumeration ceiling rather than truncating silently', () => {
    const world: BoundingBox = { west: -180, south: -85, east: 180, north: 85 }
    expect(() => enumerateTiles(world, 0, 14)).toThrow(TileCountExceededError)
  })

  it('names the actual count in the refusal, so the caller can explain it', () => {
    const world: BoundingBox = { west: -180, south: -85, east: 180, north: 85 }
    try {
      enumerateTiles(world, 0, 14)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(TileCountExceededError)
      expect((error as TileCountExceededError).count).toBeGreaterThan(MAX_ENUMERATED_TILES)
    }
  })
})

describe('sampleTiles', () => {
  it('returns everything when there is less than the sample size', () => {
    const tiles = enumerateTiles(utrecht, 4, 4)
    expect(sampleTiles(tiles, 100)).toEqual(tiles)
  })

  it('returns exactly the requested count when there is enough to sample from', () => {
    const tiles = enumerateTiles(utrecht, 10, 14)
    expect(tiles.length).toBeGreaterThan(50)
    expect(sampleTiles(tiles, 24)).toHaveLength(24)
  })

  it('spreads the sample across the whole set rather than clustering at the start', () => {
    const tiles = enumerateTiles(utrecht, 10, 13)
    const sample = sampleTiles(tiles, 20)
    const indices = sample.map((tile) => tiles.indexOf(tile))
    // The first sampled tile should not be from deep inside the list, and the
    // last should be near the end — a step-based sample, not a slice.
    expect(indices[0]).toBeLessThan(tiles.length * 0.1)
    expect(indices.at(-1)).toBeGreaterThan(tiles.length * 0.8)
  })
})
