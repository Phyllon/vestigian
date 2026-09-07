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
