import type { Map as MapLibreMap, SymbolLayerSpecification } from 'maplibre-gl'
import type { ModernSchema } from './useBasemapStyle'
import {
  LIGHT_COLOURS,
  buildPlaceLabelsLayer,
  buildVectorSource,
  registerPmtilesProtocol,
  resolveModernSchema,
} from './useBasemapStyle'

/**
 * Deliberately distinct from `useBasemapStyle.ts`'s own `MODERN_LABELS_SOURCE_ID`
 * ('basemap') and `buildPlaceLabelsLayer`'s hardcoded `'place-labels'` id.
 * `vestigian`/`satellite` bake those exact ids into `currentStyle`, so this
 * overlay's own `attach`/`detach` — running from a separate `watch()`,
 * outside the `currentStyle` → `setStyle` pipeline — would otherwise race
 * MapLibre's own diffed `setStyle` over which one owns the same object the
 * instant a reader switches from an antiquity view straight to `vestigian`
 * with this toggle still on: `setStyle`'s diff wants to keep that id
 * (`vestigian` defines it too, just at a different opacity) exactly as
 * `detachModernLabelsOverlay` is trying to remove it. Separate ids mean the
 * two mechanisms can never contend for the same MapLibre object — at worst
 * a harmless single-frame overlap of two identical-looking label layers,
 * cleaned up the instant this overlay's own watcher runs.
 */
export const MODERN_LABELS_OVERLAY_SOURCE_ID = 'modern-labels-overlay'
export const MODERN_LABELS_OVERLAY_LAYER_ID = 'modern-labels-overlay'

/**
 * `buildPlaceLabelsLayer`'s output with the id/source overridden — pulled
 * out as its own pure function so the override can be asserted directly,
 * the same shape `useBattleOverlay.ts`'s `buildBattleLayer` already uses.
 */
export const buildModernLabelsOverlayLayer = (
  schema: ModernSchema,
  opacity: number,
): SymbolLayerSpecification => ({
  ...buildPlaceLabelsLayer(LIGHT_COLOURS, schema, opacity),
  id: MODERN_LABELS_OVERLAY_LAYER_ID,
  source: MODERN_LABELS_OVERLAY_SOURCE_ID,
})

/**
 * Modern city names over an antiquity sheet — DARE's raster tiles carry none
 * of their own, and Barrington's own place labels are ancient names, from
 * Pleiades, not a reader's present-day bearings. Reuses `buildVectorSource`/
 * `buildPlaceLabelsLayer` — the same vector source and symbol-layer shape
 * `vestigian`/`satellite` already draw — at the same full strength
 * `buildSatelliteStyle` settled on: a reader who explicitly switches this on
 * wants to read it, not squint at the quiet reference `vestigian`'s own
 * always-on labels are.
 *
 * Added imperatively via `map.addSource`/`addLayer` rather than baked into
 * `buildBasemapStyle`'s own return, the same shape every other
 * basemap-independent overlay in this file uses (`useBattleOverlay` etc.).
 * Unlike those overlays, there is no `bindOverlayListenersOnce` call here:
 * this layer carries no click or hover interaction for a style swap to
 * duplicate, so the one thing that mechanism guards against does not apply.
 */
export const useModernLabelsOverlay = () => {
  const { isShowingModernLabels, source } = useBasemapStyle()

  const attachModernLabelsOverlay = (map: MapLibreMap): void => {
    if (!isShowingModernLabels.value) return
    if (map.getSource(MODERN_LABELS_OVERLAY_SOURCE_ID)) return

    const basemapSource = source.value
    if (basemapSource.provider === 'pmtiles') registerPmtilesProtocol()

    map.addSource(MODERN_LABELS_OVERLAY_SOURCE_ID, buildVectorSource(basemapSource))
    map.addLayer(buildModernLabelsOverlayLayer(resolveModernSchema(basemapSource), 1))
    // See `useLimesOverlay`'s `attachLimesOverlay` for why this is needed —
    // MapLibre does not reliably schedule a repaint on its own when a layer
    // is added while the map is otherwise idle.
    map.triggerRepaint()
  }

  const detachModernLabelsOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(MODERN_LABELS_OVERLAY_LAYER_ID))
      map.removeLayer(MODERN_LABELS_OVERLAY_LAYER_ID)
    if (map.getSource(MODERN_LABELS_OVERLAY_SOURCE_ID)) {
      map.removeSource(MODERN_LABELS_OVERLAY_SOURCE_ID)
    }
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepModernLabelsOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isShowingModernLabels.value && !map.getSource(MODERN_LABELS_OVERLAY_SOURCE_ID)) {
        attachModernLabelsOverlay(map)
      }
    })
  }

  return {
    isActive: isShowingModernLabels,
    attachModernLabelsOverlay,
    detachModernLabelsOverlay,
    keepModernLabelsOverlayThroughStyleChanges,
  }
}
