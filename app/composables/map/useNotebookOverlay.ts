import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'

export const NOTEBOOK_SOURCE_ID = 'vestigian-notebook'
const VISITED_LAYER_ID = 'vestigian-notebook-visited'
const BOOKMARK_LAYER_ID = 'vestigian-notebook-bookmarked'

/**
 * The reader's own traces, drawn over the shared map.
 *
 * **A `geojson` source, not a tile source, and that is the whole design.** Tile
 * invalidation in this project is one global counter (`bumpDataVersion()`),
 * which is what lets a tile stay cached far longer than editable content
 * normally allows. Putting per-user state inside `ST_AsMVT` would make every
 * tile's cache key per-user and throw that away — for a few hundred points that
 * fit in a single response. See `server/api/me/map.geojson.get.ts`.
 *
 * Drawn as a ring *around* the existing marker rather than as a marker of its
 * own. Two glyphs stacked on one coordinate is the mistake the limes layers had
 * to fix between contributed and Pleiades fortifications, and it is worse here:
 * the site's category mark is the information, and a visit is an annotation on
 * it.
 *
 * Colour: verdigris for visited, bronze for saved. Both are already load-bearing
 * in this palette — verdigris means approved, bronze means linear feature — and
 * neither is oxide, which the brief reserves for one accent per screen and the
 * map already spends on the selected site.
 */
export const useNotebookOverlay = () => {
  const { loggedIn } = useSession()
  const { load, overlay } = useNotebook()
  const { sheetTone } = useBasemapStyle()

  const palette = computed(() =>
    sheetTone.value === 'dark'
      ? { visited: '#7fae96', bookmarked: '#bfae7e' }
      : { visited: '#3f7a5c', bookmarked: '#857759' },
  )

  const attachNotebookOverlay = (map: MapLibreMap): void => {
    if (!loggedIn.value || map.getSource(NOTEBOOK_SOURCE_ID)) return
    const colours = palette.value

    map.addSource(NOTEBOOK_SOURCE_ID, { type: 'geojson', data: overlay.value })

    map.addLayer({
      id: BOOKMARK_LAYER_ID,
      type: 'circle',
      source: NOTEBOOK_SOURCE_ID,
      filter: ['all', ['==', ['get', 'bookmarked'], true], ['!=', ['get', 'visited'], true]],
      paint: {
        // Hollow: an intention, not a record. Only the outline is drawn, so the
        // site's own category mark stays legible inside it.
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 16, 13],
        'circle-stroke-color': colours.bookmarked,
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.9,
      },
    })

    map.addLayer({
      id: VISITED_LAYER_ID,
      type: 'circle',
      source: NOTEBOOK_SOURCE_ID,
      filter: ['==', ['get', 'visited'], true],
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 16, 13],
        'circle-stroke-color': colours.visited,
        // Heavier than the bookmark ring: having been somewhere is the stronger
        // statement of the two, and stroke weight says so without a third hue.
        'circle-stroke-width': 2.5,
      },
    })
  }

  /**
   * Style swaps wipe every custom source and layer, so this is rebuilt on the
   * `styledata` that follows — the same arrangement, and for the same reason,
   * as `keepOverlayThroughStyleChanges` in `useViewportTiles`.
   */
  const keepNotebookThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (!map.getSource(NOTEBOOK_SOURCE_ID)) attachNotebookOverlay(map)
    })
  }

  /**
   * Pushes the current notebook into the source. Called on load and whenever a
   * toggle changes it, so marking a visit redraws the ring without a refetch —
   * which is why `useNotebook` keeps coordinates on each entry.
   */
  const refreshNotebookOverlay = (map: MapLibreMap): void => {
    const source = map.getSource(NOTEBOOK_SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(overlay.value)
  }

  return {
    load,
    overlay,
    attachNotebookOverlay,
    keepNotebookThroughStyleChanges,
    refreshNotebookOverlay,
  }
}
