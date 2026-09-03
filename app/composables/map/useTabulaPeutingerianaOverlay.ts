import type { Map as MapLibreMap } from 'maplibre-gl'

export const TABULA_PEUTINGERIANA_SOURCE_ID = 'vestigian-tabula-peutingeriana'
const ROADS_LAYER_ID = 'vestigian-tabula-peutingeriana-roads'
const PLACES_LAYER_ID = 'vestigian-tabula-peutingeriana-places'

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
 * readers will never turn it on: the source states no licence and the
 * feature is off by default in production until that is resolved (see
 * `nuxt.config.ts`'s `tabulaPeutingerianaEnabled`).
 *
 * Both layers draw as annotation — thin lines, small unfilled marks with no
 * disc — the same treatment `useSiteIcons.ts` already gives a borrowed
 * Pleiades place on the Barrington sheet: ink for what this project's own
 * contributors have traced, pencil for what is only referenced. A real
 * tracing here is one drawn and reviewed through `applyRevision()`; this is
 * a citation, not a claim.
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

    map.addSource(TABULA_PEUTINGERIANA_SOURCE_ID, { type: 'geojson', data: data.value })

    map.addLayer({
      id: ROADS_LAYER_ID,
      type: 'line',
      source: TABULA_PEUTINGERIANA_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'road'],
      paint: {
        'line-color': '#9a7b4f',
        'line-width': 1,
        'line-opacity': 0.6,
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
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 10, 4],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#9a7b4f',
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.85,
      },
    })
  }

  const detachTabulaPeutingerianaOverlay = (map: MapLibreMap): void => {
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
