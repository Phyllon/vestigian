import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'

export const SECTOR_WATCH_SOURCE_ID = 'vestigian-sector-watch'
const OVERLOOKED_LAYER_ID = 'vestigian-sector-watch-overlooked'
const WATCHED_LAYER_ID = 'vestigian-sector-watch-watched'
const LINK_CLEAR_LAYER_ID = 'vestigian-sector-watch-link-clear'
const LINK_BRIDGED_LAYER_ID = 'vestigian-sector-watch-link-bridged'
const LINK_BROKEN_LAYER_ID = 'vestigian-sector-watch-link-broken'
const BLIND_CASING_LAYER_ID = 'vestigian-sector-watch-blind-casing'
const BLIND_LAYER_ID = 'vestigian-sector-watch-blind'
const TOWER_LAYER_ID = 'vestigian-sector-watch-tower'

const LAYER_IDS = [
  OVERLOOKED_LAYER_ID,
  WATCHED_LAYER_ID,
  LINK_CLEAR_LAYER_ID,
  LINK_BRIDGED_LAYER_ID,
  LINK_BROKEN_LAYER_ID,
  BLIND_CASING_LAYER_ID,
  BLIND_LAYER_ID,
  TOWER_LAYER_ID,
] as const

/**
 * The ground a sector's towers overlook, drawn over the shared map: a pale amber
 * wash where one tower sees, a deeper one where three or more do, the chain of
 * links between neighbouring towers (solid where two towers see each other,
 * dotted where they are joined round a blocked one, dashed plum where nothing
 * crosses) and, in plum with a pale casing, the stretches of the line no tower
 * overlooks.
 *
 * Amber for what is seen, as in a single tower's view; plum for what is not, so
 * "gap" reads as one colour across the chain and the line. Not oxide, which is
 * the frontier line's own colour and sits right beneath.
 *
 * Same shape as `useSightlineOverlay`: a `geojson` source, state in `useState`,
 * rebuilt after a style swap — with one difference. **The source exists only
 * while there is something in it.** It carries the frontier's and the elevation's
 * credit, and a map credit appears with its layer and leaves with it; a source
 * that sat empty would print "Frontier: OpenStreetMap contributors…" under every
 * map in the app.
 */
export const useSectorWatchOverlay = () => {
  const { sheetTone } = useBasemapStyle()

  const layers = useState<GeoJSON.FeatureCollection | null>('sector-watch-layers', () => null)

  const palette = computed(() =>
    sheetTone.value === 'dark'
      ? { amber: '#f0b94d', plum: '#e58ab8', halo: 'rgba(28, 24, 21, 0.8)' }
      : { amber: '#9a5b06', plum: '#8a2b5c', halo: 'rgba(255, 255, 255, 0.85)' },
  )

  const attachSectorWatchOverlay = (map: MapLibreMap): void => {
    if (map.getSource(SECTOR_WATCH_SOURCE_ID)) return
    const colours = palette.value

    map.addSource(SECTOR_WATCH_SOURCE_ID, {
      type: 'geojson',
      data: layers.value ?? { type: 'FeatureCollection', features: [] },
      // The layer is cut from the frontier's line and calculated over the terrain.
      attribution: `${LIMES_ATTRIBUTION}; ${ELEVATION_ATTRIBUTION}`,
    })

    map.addLayer({
      id: OVERLOOKED_LAYER_ID,
      type: 'fill',
      source: SECTOR_WATCH_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'overlooked'],
      paint: { 'fill-color': colours.amber, 'fill-opacity': 0.14, 'fill-antialias': false },
    })

    map.addLayer({
      id: WATCHED_LAYER_ID,
      type: 'fill',
      source: SECTOR_WATCH_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'watched'],
      paint: { 'fill-color': colours.amber, 'fill-opacity': 0.2, 'fill-antialias': false },
    })

    map.addLayer({
      id: BLIND_CASING_LAYER_ID,
      type: 'line',
      source: SECTOR_WATCH_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'blind'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': colours.halo, 'line-width': 8 },
    })

    map.addLayer({
      id: BLIND_LAYER_ID,
      type: 'line',
      source: SECTOR_WATCH_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'blind'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': colours.plum, 'line-width': 4 },
    })

    map.addLayer({
      id: LINK_CLEAR_LAYER_ID,
      type: 'line',
      source: SECTOR_WATCH_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'link'], ['==', ['get', 'state'], 'clear']],
      paint: { 'line-color': colours.amber, 'line-width': 2 },
    })

    map.addLayer({
      id: LINK_BRIDGED_LAYER_ID,
      type: 'line',
      source: SECTOR_WATCH_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'link'], ['==', ['get', 'state'], 'bridged']],
      paint: { 'line-color': colours.amber, 'line-width': 2, 'line-dasharray': [0.8, 1.6] },
    })

    map.addLayer({
      id: LINK_BROKEN_LAYER_ID,
      type: 'line',
      source: SECTOR_WATCH_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'link'], ['==', ['get', 'state'], 'broken']],
      paint: { 'line-color': colours.plum, 'line-width': 3, 'line-dasharray': [2, 1.5] },
    })

    map.addLayer({
      id: TOWER_LAYER_ID,
      type: 'circle',
      source: SECTOR_WATCH_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'tower'],
      paint: {
        'circle-radius': 3.5,
        'circle-color': colours.amber,
        'circle-stroke-color': colours.halo,
        'circle-stroke-width': 1.5,
      },
    })

    map.triggerRepaint()
  }

  const detachSectorWatchOverlay = (map: MapLibreMap): void => {
    for (const id of LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(SECTOR_WATCH_SOURCE_ID)) map.removeSource(SECTOR_WATCH_SOURCE_ID)
  }

  /**
   * Brings the map in line with the state: drawn and current while there are
   * layers, gone (source, layers and credit) when there are none.
   */
  const syncSectorWatchOverlay = (map: MapLibreMap): void => {
    if (!layers.value) {
      detachSectorWatchOverlay(map)
      return
    }
    const source = map.getSource(SECTOR_WATCH_SOURCE_ID) as GeoJSONSource | undefined
    if (source) {
      source.setData(layers.value)
    } else {
      attachSectorWatchOverlay(map)
    }
  }

  /** Style swaps wipe custom sources; rebuilt on the `styledata` that follows, if there is anything to draw. */
  const keepSectorWatchThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (layers.value && !map.getSource(SECTOR_WATCH_SOURCE_ID)) attachSectorWatchOverlay(map)
    })
  }

  const showSectorWatch = (collection: GeoJSON.FeatureCollection): void => {
    layers.value = collection
  }

  const clearSectorWatch = (): void => {
    layers.value = null
  }

  return {
    layers,
    syncSectorWatchOverlay,
    keepSectorWatchThroughStyleChanges,
    showSectorWatch,
    clearSectorWatch,
  }
}
