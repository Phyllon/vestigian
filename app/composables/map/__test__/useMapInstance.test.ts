import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { bindOverlayListenersOnce } from '../useMapInstance'

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
