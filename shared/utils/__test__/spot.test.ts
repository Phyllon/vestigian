import { describe, expect, it } from 'vitest'
import type { DevicePosition, SpotContext } from '#shared/types'
import {
  FIX_MAX_ACCURACY_METRES,
  FIX_MAX_AGE_MS,
  coordinateDecimalsForZoom,
  creditsForContext,
  decodeTerrariumElevation,
  describeExtentPresence,
  distanceFromFix,
  elevationStepForZoom,
  formatCoordinates,
  formatElevation,
  formatSpotDistance,
  haversineMetres,
  mergeYearSpans,
  snapCoordinate,
} from '../spot'

describe('how precisely a tapped mark can state where it is', () => {
  // A mark's coordinate has been rounded to a 4096-unit grid by the tile it
  // came from; claiming more digits than that grid carries is false precision.
  it('gives fewer decimals the further out the mark was tapped', () => {
    expect(coordinateDecimalsForZoom(12)).toBe(4)
    expect(coordinateDecimalsForZoom(9)).toBe(3)
    expect(coordinateDecimalsForZoom(6)).toBe(2)
    expect(coordinateDecimalsForZoom(3)).toBe(1)
  })

  it('stops at four decimals however far in the map is zoomed — the tiles stop at zoom 12', () => {
    expect(coordinateDecimalsForZoom(18)).toBe(4)
    expect(coordinateDecimalsForZoom(22)).toBe(4)
  })

  it('rounds elevation more coarsely where the coordinate itself is rough', () => {
    expect(elevationStepForZoom(12, 47)).toBe(10)
    expect(elevationStepForZoom(7, 47)).toBe(50)
    expect(elevationStepForZoom(5, 47)).toBe(100)
  })

  it('writes latitude first, the order a pasted coordinate is read in', () => {
    expect(formatCoordinates(8.8985, 47.5565, 4)).toBe('47.5565, 8.8985')
    expect(formatCoordinates(-2.3277, 55.0125, 2)).toBe('55.01, -2.33')
  })

  it('snaps to about eleven metres, the grain the derived answers are cached at', () => {
    expect(snapCoordinate(8.89854)).toBeCloseTo(8.8985, 6)
    expect(snapCoordinate(47.55646)).toBeCloseTo(47.5565, 6)
  })
})

describe('terrain elevation', () => {
  it('decodes the terrarium encoding, negative values included', () => {
    expect(decodeTerrariumElevation(128, 0, 0)).toBe(0)
    expect(decodeTerrariumElevation(129, 100, 128)).toBeCloseTo(356.5)
    // Below sea level — the Dead Sea shore — is R just under 128.
    expect(decodeTerrariumElevation(127, 47, 0)).toBe(-209)
  })

  it('states elevation to the step the coordinate supports, in the reader’s locale', () => {
    expect(formatElevation(417.7, 10, 'en')).toBe('420')
    expect(formatElevation(2464.6, 50, 'en')).toBe('2,450')
    expect(formatElevation(2464.6, 50, 'de')).toBe('2.450')
  })
})

describe('distance from the reader', () => {
  it('measures along the great circle', () => {
    expect(haversineMetres({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(111_195, -2)
    expect(haversineMetres({ lon: 8.9, lat: 47.5 }, { lon: 8.9, lat: 47.5 })).toBe(0)
  })

  const now = 1_700_000_000_000
  const fix = (overrides: Partial<DevicePosition> = {}): DevicePosition => ({
    coords: { lon: 8.9, lat: 47.5 },
    accuracy: 15,
    heading: null,
    timestamp: now - 1000,
    ...overrides,
  })
  const spot = { lon: 8.9, lat: 47.6 }

  it('is null with no fix — the info box never asks for one', () => {
    expect(distanceFromFix(spot, null, now)).toBeNull()
  })

  it('is null for a fix too coarse to say how far away anything is', () => {
    expect(distanceFromFix(spot, fix({ accuracy: FIX_MAX_ACCURACY_METRES + 1 }), now)).toBeNull()
  })

  it('is null for a fix the reader has probably walked away from', () => {
    expect(distanceFromFix(spot, fix({ timestamp: now - FIX_MAX_AGE_MS - 1 }), now)).toBeNull()
  })

  it('measures from a good, recent fix', () => {
    expect(distanceFromFix(spot, fix(), now)).toBeCloseTo(11_119, -2)
  })

  it('formats metres to ten and kilometres to what is readable', () => {
    expect(formatSpotDistance(123, 'en')).toBe('120 m')
    expect(formatSpotDistance(4, 'en')).toBe('10 m')
    expect(formatSpotDistance(1500, 'en')).toBe('1.5 km')
    expect(formatSpotDistance(12_340, 'en')).toBe('12 km')
    expect(formatSpotDistance(3400, 'de')).toBe('3,4 km')
  })
})

describe('the Roman state’s recorded extent at a spot', () => {
  it('merges the slices it is stored as into the runs a reader would see', () => {
    // The empire is stored as one row per recorded change; a spot inside it for
    // centuries comes back as dozens of consecutive rows.
    expect(
      mergeYearSpans([
        [-27, -19],
        [-58, -42],
        [-42, -27],
        [-19, 6],
      ]),
    ).toEqual([[-58, 6]])
  })

  it('keeps a gap as a gap', () => {
    expect(
      mergeYearSpans([
        [-58, 6],
        [100, 200],
      ]),
    ).toEqual([
      [-58, 6],
      [100, 200],
    ])
  })

  it('merges overlapping slices — the western and eastern states run side by side', () => {
    expect(
      mergeYearSpans([
        [395, 476],
        [395, 439],
        [433, 439],
      ]),
    ).toEqual([[395, 476]])
  })

  it('does not alter what it is given', () => {
    const input: [number, number][] = [
      [10, 20],
      [15, 30],
    ]
    mergeYearSpans(input)
    expect(input).toEqual([
      [10, 20],
      [15, 30],
    ])
  })

  it('answers inside or outside for the year the scrubber is on', () => {
    const spans: [number, number][] = [[-58, 409]]
    expect(describeExtentPresence(spans, 117)).toEqual({ state: 'inside', year: 117 })
    expect(describeExtentPresence(spans, 476)).toEqual({ state: 'outside', year: 476 })
    expect(describeExtentPresence(spans, -58)).toEqual({ state: 'inside', year: -58 })
  })

  it('answers outside for a spot the state never covered, in any year asked', () => {
    expect(describeExtentPresence([], 117)).toEqual({ state: 'outside', year: 117 })
  })

  it('gives the whole history when no year is chosen', () => {
    expect(describeExtentPresence([[-58, 409]], null)).toEqual({
      state: 'spans',
      spans: [[-58, 409]],
    })
    expect(describeExtentPresence([], null)).toEqual({ state: 'never' })
  })
})

describe('who the derived rows have to credit', () => {
  const context = (overrides: Partial<SpotContext> = {}): SpotContext => ({
    nearestTown: { name: 'Frauenfeld', distanceMetres: 144 },
    countryCode: 'CH',
    elevationMetres: 417.7,
    extentSpans: [[-58, 409]],
    ...overrides,
  })

  it('credits every dataset a shown row came from', () => {
    expect(creditsForContext(context()).map((credit) => credit.name)).toEqual([
      'GeoNames',
      'Natural Earth',
      'Mapterhorn',
      'OpenHistoricalMap',
    ])
  })

  it('leaves out a dataset whose row is not shown', () => {
    const names = creditsForContext(
      context({ nearestTown: null, countryCode: null, elevationMetres: null }),
    ).map((credit) => credit.name)
    expect(names).toEqual(['OpenHistoricalMap'])
    expect(
      creditsForContext(context({ extentSpans: null })).map((credit) => credit.name),
    ).not.toContain('OpenHistoricalMap')
  })
})
