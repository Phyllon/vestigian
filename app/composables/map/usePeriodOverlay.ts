import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  EMPIRE_EXTENT_ATTRIBUTION,
  buildPeriodExtentLayers,
  resolvePeriodExtentColours,
} from './useBasemapStyle'

export const PERIOD_SOURCE_ID = 'atlas-period'

const PERIOD_LAYER_IDS = buildPeriodExtentLayers().map((layer) => layer.id)

/**
 * The empire's extent at a chosen date, drawn as an overlay above whichever
 * basemap is showing — the same "a fact independent of one sheet" reasoning
 * `useLimesOverlay` already gives for the frontier. It used to be baked into
 * `buildAtlasStyle`, shown only while the Barrington sheet was active; see
 * `buildPeriodExtentLayers`'s own docstring for why that changed.
 *
 * Unlike every other overlay here, the source's own URL changes with
 * `periodYear` — the year is baked into the tile path, not a query param
 * (`/api/tiles/antiquity-empire/:year/...`). `attachPeriodOverlay` is
 * therefore not idempotent across a year change the way `attachLimesOverlay`
 * is across an unchanging source: the caller (`MapCanvas`'s watcher on
 * `periodYear`) detaches before re-attaching whenever the year itself moves,
 * not only when the scrubber switches between "off" and "on".
 *
 * The fill's own colour also depends on `view` — `resolvePeriodExtentColours`
 * is read fresh on every attach, so switching basemaps while the scrubber is
 * on picks up the right palette for free: a basemap switch rebuilds
 * `currentStyle` and calls `setStyle`, which wipes this overlay's source the
 * same as every other one, and `keepPeriodOverlayThroughStyleChanges`'s own
 * `styledata` handler then calls this function again.
 */
export const usePeriodOverlay = () => {
  const { periodYear, empireExtentTilesUrl, view } = useBasemapStyle()

  const isActive = computed(() => periodYear.value !== null)

  const attachPeriodOverlay = (map: MapLibreMap): void => {
    if (periodYear.value === null) return
    if (map.getSource(PERIOD_SOURCE_ID)) return

    map.addSource(PERIOD_SOURCE_ID, {
      type: 'vector',
      tiles: [`${empireExtentTilesUrl.value}/${periodYear.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: EMPIRE_EXTENT_ATTRIBUTION,
    })

    const colours = resolvePeriodExtentColours(view.value)
    for (const layer of buildPeriodExtentLayers(colours)) map.addLayer(layer)

    // See `useLimesOverlay`'s `attachLimesOverlay` for why this is needed —
    // MapLibre does not reliably schedule a repaint on its own when a layer
    // is added while the map is otherwise idle.
    map.triggerRepaint()
  }

  const detachPeriodOverlay = (map: MapLibreMap): void => {
    for (const id of PERIOD_LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(PERIOD_SOURCE_ID)) map.removeSource(PERIOD_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepPeriodOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isActive.value && !map.getSource(PERIOD_SOURCE_ID)) attachPeriodOverlay(map)
    })
  }

  return {
    isActive,
    attachPeriodOverlay,
    detachPeriodOverlay,
    keepPeriodOverlayThroughStyleChanges,
  }
}
