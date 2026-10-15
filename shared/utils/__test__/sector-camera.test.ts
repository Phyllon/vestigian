import { describe, expect, it } from 'vitest'
import { cameraForSectorBounds, sectorFitPadding } from '../sector-camera'

describe('cameraForSectorBounds', () => {
  it('centres on the middle of the box', () => {
    const { center } = cameraForSectorBounds({ west: 10, south: 46, east: 14, north: 50 })
    expect(center).toEqual({ lat: 48, lon: 12 })
  })

  it('frames a long frontier wider than a short one', () => {
    const wall = cameraForSectorBounds({ west: -3.5, south: 54.8, east: -2, north: 55.1 })
    const danube = cameraForSectorBounds({ west: 8, south: 43, east: 30, north: 49 })
    expect(danube.zoom).toBeLessThan(wall.zoom)
  })

  it('lets a tall sector decide the zoom', () => {
    const tall = cameraForSectorBounds({ west: 10, south: 40, east: 10.5, north: 50 })
    const flat = cameraForSectorBounds({ west: 10, south: 40, east: 20, north: 40.5 })
    expect(tall.zoom).toBeLessThanOrEqual(flat.zoom)
  })

  it('stays inside the clamp for a degenerate box', () => {
    const { zoom } = cameraForSectorBounds({ west: 5, south: 5, east: 5, north: 5 })
    expect(zoom).toBe(11)
  })

  it('rounds down to half a zoom level', () => {
    const { zoom } = cameraForSectorBounds({ west: 0, south: 0, east: 7, north: 3 })
    expect(zoom * 2).toBe(Math.round(zoom * 2))
  })
})

describe('sectorFitPadding', () => {
  it('leaves the top of a phone free of the sheet', () => {
    expect(sectorFitPadding({ isCompact: true, mapHeight: 600 })).toMatchObject({ bottom: 364 })
  })

  it('keeps clear of the left-hand panel on a wide screen', () => {
    expect(sectorFitPadding({ isCompact: false, mapHeight: 800 })).toMatchObject({ left: 384 })
  })
})
