import { describe, expect, it } from 'vitest'
import { buildAccuracyCircle } from '../useGeolocation'

describe('buildAccuracyCircle', () => {
  it('closes the ring so the polygon is valid GeoJSON', () => {
    const ring = buildAccuracyCircle({ lon: 8.5, lat: 47.4 }, 50).geometry.coordinates[0]!
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('grows with the reported accuracy', () => {
    const widthOf = (radius: number) => {
      const ring = buildAccuracyCircle({ lon: 0, lat: 0 }, radius).geometry.coordinates[0]!
      const lons = ring.map((point) => point[0])
      return Math.max(...lons) - Math.min(...lons)
    }
    expect(widthOf(200)).toBeGreaterThan(widthOf(50))
  })

  it('corrects for longitude convergence away from the equator', () => {
    const spanAt = (lat: number) => {
      const ring = buildAccuracyCircle({ lon: 0, lat }, 100).geometry.coordinates[0]!
      const lons = ring.map((point) => point[0])
      return Math.max(...lons) - Math.min(...lons)
    }
    // The same distance covers more degrees of longitude at higher latitudes.
    expect(spanAt(60)).toBeGreaterThan(spanAt(0) * 1.9)
  })

  it('keeps a circle circular in metres, not in degrees', () => {
    const ring = buildAccuracyCircle({ lon: 0, lat: 60 }, 100).geometry.coordinates[0]!
    const lonSpan = Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0]))
    const latSpan = Math.max(...ring.map((p) => p[1])) - Math.min(...ring.map((p) => p[1]))
    expect(lonSpan).not.toBeCloseTo(latSpan, 3)
  })
})
