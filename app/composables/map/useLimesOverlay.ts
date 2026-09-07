import type { Map as MapLibreMap } from 'maplibre-gl'
import { LIMES_ATTRIBUTION, buildLimesLayers } from './useBasemapStyle'

export const LIMES_SOURCE_ID = 'limes'

const LIMES_LAYER_IDS = buildLimesLayers().map((layer) => layer.id)

/**
 * The frontier, drawn as an overlay above whichever basemap is showing —
 * not a reading of the Barrington sheet in particular any more. See the note
 * on `isFollowingLimes` in `useBasemapStyle` for why: the line carries its
 * own dates and reads as an assertion on any sheet, the same way the Tabula
 * Peutingeriana overlay does, so it no longer has to be gated to one style.
 *
 * `limes-installations` — the borrowed Pleiades military places, promoted to
 * the frontier's own plan marks — reads the `atlas` vector source
 * (`useBasemapStyle`'s `buildAtlasStyle`), which exists only on the
 * Barrington view. It is skipped on every other basemap: the frontier line
 * and its contributed forts (`useViewportTiles`'s `LIMES_FORT_LAYER_ID`,
 * drawn on every basemap already) still show, just without that one
 * borrowed-place promotion.
 */
export const useLimesOverlay = () => {
  const { isFollowingLimes, limesTilesUrl } = useBasemapStyle()

  const attachLimesOverlay = (map: MapLibreMap): void => {
    if (!isFollowingLimes.value) return
    if (map.getSource(LIMES_SOURCE_ID)) return

    map.addSource(LIMES_SOURCE_ID, {
      type: 'vector',
      tiles: [`${limesTilesUrl.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: LIMES_ATTRIBUTION,
    })

    for (const layer of buildLimesLayers()) {
      if ('source' in layer && layer.source === 'atlas' && !map.getSource('atlas')) continue
      map.addLayer(layer)
    }

    /**
     * Reported: switching an overlay on drew nothing until the reader
     * scrolled or zoomed the map, at which point it appeared correctly —
     * the source and layer were always right, only the paint was missing.
     * MapLibre stops its render loop once idle and only resumes it via
     * `triggerRepaint()`; `addSource`/`addLayer` are supposed to call that
     * internally, but a toggle fired from a Vue event handler while the map
     * has been sitting untouched is exactly the condition under which that
     * internal scheduling has been seen to miss (also reported for
     * `useBattleOverlay`, `usePortOverlay`, `useRouteOverlay`,
     * `useMinorFeatureOverlay`, `useCoinHoardOverlay`, `useViewportTiles` —
     * every overlay that adds a layer after the map has already loaded).
     * Calling it explicitly here costs nothing when the map was already
     * about to repaint on its own, and fixes the case when it wasn't.
     */
    map.triggerRepaint()
  }

  const detachLimesOverlay = (map: MapLibreMap): void => {
    for (const id of LIMES_LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(LIMES_SOURCE_ID)) map.removeSource(LIMES_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepLimesOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isFollowingLimes.value && !map.getSource(LIMES_SOURCE_ID)) attachLimesOverlay(map)
    })
  }

  return {
    isActive: isFollowingLimes,
    attachLimesOverlay,
    detachLimesOverlay,
    keepLimesOverlayThroughStyleChanges,
  }
}
