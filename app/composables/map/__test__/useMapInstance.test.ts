import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  bindOverlayListenersOnce,
  isOverClickableOverlay,
  registerClickableOverlayLayer,
} from '../useMapInstance'

// A stub is enough — the guard only needs object identity, never a real
// MapLibre instance.
const fakeMap = (): MapLibreMap => ({}) as MapLibreMap

describe('bindOverlayListenersOnce', () => {
  it('binds listeners on the first call for a given map and layer', () => {
    const bind = vi.fn()
    bindOverlayListenersOnce(fakeMap(), 'vestigian-battles', bind)
    expect(bind).toHaveBeenCalledOnce()
  })

  it('does not rebind on a second call for the same map and layer', () => {
    // This is the exact repeated-`styledata`-reattachment shape a theme
    // switch produces: `attachXOverlay` calling this every time, for the
    // one map instance that lives for the whole session.
    const map = fakeMap()
    const bind = vi.fn()
    bindOverlayListenersOnce(map, 'vestigian-battles', bind)
    bindOverlayListenersOnce(map, 'vestigian-battles', bind)
    bindOverlayListenersOnce(map, 'vestigian-battles', bind)
    expect(bind).toHaveBeenCalledOnce()
  })

  it('binds independently per layer id on the same map', () => {
    const map = fakeMap()
    const battleBind = vi.fn()
    const portBind = vi.fn()
    bindOverlayListenersOnce(map, 'vestigian-battles', battleBind)
    bindOverlayListenersOnce(map, 'vestigian-ports', portBind)
    expect(battleBind).toHaveBeenCalledOnce()
    expect(portBind).toHaveBeenCalledOnce()
  })

  it('binds independently per map instance for the same layer id', () => {
    // A remount creates a genuinely new Map — its listeners should not be
    // considered already bound just because an earlier instance's were.
    const bind = vi.fn()
    bindOverlayListenersOnce(fakeMap(), 'vestigian-battles', bind)
    bindOverlayListenersOnce(fakeMap(), 'vestigian-battles', bind)
    expect(bind).toHaveBeenCalledTimes(2)
  })
})

interface QueryMapOptions {
  existingLayers: string[]
  hitCount: number
}

const queryMap = (options: QueryMapOptions) => {
  const queryRenderedFeatures = vi.fn((..._arguments: unknown[]) =>
    new Array(options.hitCount).fill({}),
  )
  const map = {
    getLayer: (id: string) => (options.existingLayers.includes(id) ? { id } : undefined),
    queryRenderedFeatures,
  } as unknown as MapLibreMap
  return { map, queryRenderedFeatures }
}

describe('isOverClickableOverlay', () => {
  it('asks only about layers that exist, since an unknown id makes MapLibre throw', () => {
    registerClickableOverlayLayer('test-present-layer')
    registerClickableOverlayLayer('test-absent-layer')
    const { map, queryRenderedFeatures } = queryMap({
      existingLayers: ['test-present-layer'],
      hitCount: 1,
    })

    expect(isOverClickableOverlay(map, { x: 100, y: 100 })).toBe(true)

    const [box, options] = queryRenderedFeatures.mock.calls[0] as unknown as [
      number[][],
      { layers: string[] },
    ]
    expect(box).toEqual([
      [94, 94],
      [106, 106],
    ])
    expect(options.layers).toContain('test-present-layer')
    expect(options.layers).not.toContain('test-absent-layer')
  })

  it('is false, without querying, when no clickable layer is on the map', () => {
    const { map, queryRenderedFeatures } = queryMap({ existingLayers: [], hitCount: 3 })

    expect(isOverClickableOverlay(map, { x: 0, y: 0 })).toBe(false)
    expect(queryRenderedFeatures).not.toHaveBeenCalled()
  })

  it('is false over empty map', () => {
    registerClickableOverlayLayer('test-present-layer')
    const { map } = queryMap({ existingLayers: ['test-present-layer'], hitCount: 0 })

    expect(isOverClickableOverlay(map, { x: 10, y: 10 })).toBe(false)
  })

  it('knows every layer an overlay binds through bindOverlayListenersOnce', () => {
    bindOverlayListenersOnce({} as MapLibreMap, 'test-bound-layer', () => {})
    const { map, queryRenderedFeatures } = queryMap({
      existingLayers: ['test-bound-layer'],
      hitCount: 1,
    })

    expect(isOverClickableOverlay(map, { x: 5, y: 5 })).toBe(true)
    expect(queryRenderedFeatures).toHaveBeenCalledOnce()
  })
})
