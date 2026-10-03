import type { Map as MapLibreMap } from 'maplibre-gl'
import { MAP_LABEL_FONT, TABULA_PEUTINGERIANA_ATTRIBUTION } from './useBasemapStyle'

export const TABULA_PEUTINGERIANA_SOURCE_ID = 'vestigian-tabula-peutingeriana'
const ROADS_LAYER_ID = 'vestigian-tabula-peutingeriana-roads'
const PLACES_LAYER_ID = 'vestigian-tabula-peutingeriana-places'
const PLACE_LABELS_LAYER_ID = 'vestigian-tabula-peutingeriana-place-labels'

/**
 * A warm verdigris rather than the bronze this overlay first shipped with —
 * bronze is already this app's colour for a *contributed* linear feature
 * (`useViewportTiles`'s tracing layer, `ATLAS_COLOURS.infrastructure`'s own
 * neighbours), and at the original width and opacity the network read as
 * barely-there pencil rather than a citation worth looking at. Deliberately
 * not the frontier's oxide red either — the two overlays can be switched on
 * together (there is nothing that ties them to the same basemap any more,
 * see `useLimesOverlay`), and a reader following the limes needs to be able
 * to tell which line is which at a glance.
 */
const TABULA_PEUTINGERIANA_COLOUR = '#3d6b5c'
const TABULA_PEUTINGERIANA_LABEL_COLOUR = '#2c4d42'

/**
 * The Tabula Peutingeriana's places and roads, drawn over whatever basemap is
 * currently showing — a `geojson` source, not a tile source, for the same
 * reason `useNotebookOverlay` is one: 2,574 places and 2,397 roads is a few
 * hundred KB that fits in a single response, not something the MVT pipeline's
 * global cache generation should be charged for.
 *
 * Unlike the notebook overlay, this is off until a reader switches it on
 * (`isShowingTabulaPeutingerianaOverlay` in `useBasemapStyle`) — the data is
 * fetched lazily on first activation, not on every map load, since most
 * readers will never turn it on. The layer can be withdrawn with
 * `tabulaPeutingerianaEnabled` (see `nuxt.config.ts`).
 *
 * The lines and marks draw filled rather than as bare outlines — legible
 * against a basemap on its own now, not only once a reader already knows to
 * look for them — but the place labels stay annotation: the classical name
 * OmnesViae itself transcribed, with the modern place underneath in smaller
 * type where one is known, matching how omnesviae.org's own site pairs the
 * two. A real tracing here is one drawn and reviewed through
 * `applyRevision()`; this is a citation, not a claim.
 */
export const useTabulaPeutingerianaOverlay = () => {
  const { isShowingTabulaPeutingerianaOverlay } = useBasemapStyle()

  const data = shallowRef<GeoJSON.FeatureCollection | null>(null)
  const isLoading = ref(false)

  const load = async (): Promise<void> => {
    if (data.value || isLoading.value) return
    isLoading.value = true
    try {
      data.value = await $fetch<GeoJSON.FeatureCollection>(
        '/api/tabula-peutingeriana/network.geojson',
      )
    } catch {
      // Fails open, like enrichment and translation elsewhere in this app: an
      // overlay that cannot load leaves the map exactly as it was, rather
      // than blocking anything on the critical path.
      data.value = { type: 'FeatureCollection', features: [] }
    } finally {
      isLoading.value = false
    }
  }

  const attachTabulaPeutingerianaOverlay = (map: MapLibreMap): void => {
    if (!isShowingTabulaPeutingerianaOverlay.value || !data.value) return
    if (map.getSource(TABULA_PEUTINGERIANA_SOURCE_ID)) return

    map.addSource(TABULA_PEUTINGERIANA_SOURCE_ID, {
      type: 'geojson',
      data: data.value,
      attribution: TABULA_PEUTINGERIANA_ATTRIBUTION,
    })

    map.addLayer({
      id: ROADS_LAYER_ID,
      type: 'line',
      source: TABULA_PEUTINGERIANA_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'road'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': TABULA_PEUTINGERIANA_COLOUR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 10, 3],
        'line-opacity': 0.85,
        // A reconstructed leg (filled from the Itinerarium Antonini, not the
        // manuscript itself) is drawn distinctly from one the map itself
        // records — the same distinction Barrington's own `certain` column
        // already earns a dash for on `antiquity_lines`.
        'line-dasharray': [
          'case',
          ['get', 'isReconstructed'],
          ['literal', [2, 2]],
          ['literal', [1, 0]],
        ],
      },
    })

    map.addLayer({
      id: PLACES_LAYER_ID,
      type: 'circle',
      source: TABULA_PEUTINGERIANA_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'place'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 10, 6],
        'circle-color': TABULA_PEUTINGERIANA_COLOUR,
        'circle-opacity': 0.5,
        'circle-stroke-color': TABULA_PEUTINGERIANA_COLOUR,
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.95,
      },
    })

    /**
     * The classical name OmnesViae itself transcribed from the manuscript,
     * with the modern place it corresponds to underneath where one is known —
     * the same pairing the source's own site shows for a place. A separate
     * symbol layer rather than folded into the circles above, because a label
     * needs its own collision box and `text-optional` so a crowded stretch
     * loses names before it loses the marks themselves.
     */
    map.addLayer({
      id: PLACE_LABELS_LAYER_ID,
      type: 'symbol',
      source: TABULA_PEUTINGERIANA_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'place'],
      minzoom: 5,
      layout: {
        'text-field': [
          'case',
          ['!=', ['get', 'modernName'], null],
          ['format', ['get', 'label'], {}, '\n', {}, ['get', 'modernName'], { 'font-scale': 0.85 }],
          ['get', 'label'],
        ],
        'text-font': [MAP_LABEL_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 12, 13],
        'text-anchor': 'top',
        'text-offset': [0, 0.55],
        'text-max-width': 8,
        'text-padding': 4,
        'text-optional': true,
      },
      paint: {
        'text-color': TABULA_PEUTINGERIANA_LABEL_COLOUR,
        'text-halo-color': '#faf7ef',
        'text-halo-width': 1.2,
      },
    })

    // See `useLimesOverlay`'s `attachLimesOverlay` for why this call is needed.
    map.triggerRepaint()
  }

  const detachTabulaPeutingerianaOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(PLACE_LABELS_LAYER_ID)) map.removeLayer(PLACE_LABELS_LAYER_ID)
    if (map.getLayer(PLACES_LAYER_ID)) map.removeLayer(PLACES_LAYER_ID)
    if (map.getLayer(ROADS_LAYER_ID)) map.removeLayer(ROADS_LAYER_ID)
    if (map.getSource(TABULA_PEUTINGERIANA_SOURCE_ID))
      map.removeSource(TABULA_PEUTINGERIANA_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — the same arrangement as `keepOverlayThroughStyleChanges`. */
  const keepTabulaPeutingerianaOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (
        isShowingTabulaPeutingerianaOverlay.value &&
        !map.getSource(TABULA_PEUTINGERIANA_SOURCE_ID)
      ) {
        attachTabulaPeutingerianaOverlay(map)
      }
    })
  }

  return {
    isActive: isShowingTabulaPeutingerianaOverlay,
    isLoading,
    load,
    attachTabulaPeutingerianaOverlay,
    detachTabulaPeutingerianaOverlay,
    keepTabulaPeutingerianaOverlayThroughStyleChanges,
  }
}
