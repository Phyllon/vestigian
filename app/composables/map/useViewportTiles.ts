import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'

export const OVERLAY_SOURCE_ID = 'vestigia-data'
export const SITE_LAYER_ID = 'vestigia-sites'
export const CLUSTER_LAYER_ID = 'vestigia-clusters'
export const CLUSTER_COUNT_LAYER_ID = 'vestigia-cluster-count'
export const TRACING_LAYER_ID = 'vestigia-tracings'
export const SITE_LABEL_LAYER_ID = 'vestigia-site-labels'

interface OverlayPalette {
  site: string
  siteHalo: string
  tracing: string
  cluster: string
  clusterText: string
  label: string
  labelHalo: string
}

const LIGHT_OVERLAY: OverlayPalette = {
  site: '#9a3b22',
  siteHalo: '#faf7ef',
  tracing: '#7a6c49',
  cluster: '#7d2e1c',
  clusterText: '#faf7ef',
  label: '#1c1815',
  labelHalo: '#faf7ef',
}

const DARK_OVERLAY: OverlayPalette = {
  site: '#d38a72',
  siteHalo: '#17140f',
  tracing: '#9c8c62',
  cluster: '#b04d31',
  clusterText: '#17140f',
  label: '#f2ede1',
  labelHalo: '#17140f',
}

/**
 * Sites, clusters and tracings, drawn from the MVT endpoint. MapLibre requests
 * only the tiles inside the viewport and caches what it already has, so panning
 * costs one request per newly exposed tile rather than a refetch of everything
 * on screen. This is what makes the viewport feel instant at continental zoom.
 */
export const useViewportTiles = () => {
  const { isDark } = useBasemapStyle()

  const palette = computed<OverlayPalette>(() => (isDark.value ? DARK_OVERLAY : LIGHT_OVERLAY))

  const attachOverlay = (map: MapLibreMap): void => {
    if (map.getSource(OVERLAY_SOURCE_ID)) return
    const colours = palette.value

    map.addSource(OVERLAY_SOURCE_ID, {
      type: 'vector',
      tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 14,
      attribution:
        'Site data CC BY-SA, contributed to <a href="https://vici.org">Vici.org</a> and Vestigia',
    })

    map.addLayer({
      id: TRACING_LAYER_ID,
      type: 'line',
      source: OVERLAY_SOURCE_ID,
      'source-layer': 'tracings',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': colours.tracing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 16, 4],
        // Dashed, because a tracing is an interpretation and should not read
        // as a surveyed certainty the way a solid line would.
        'line-dasharray': [4, 2],
        'line-opacity': 0.9,
      },
    })

    map.addLayer({
      id: CLUSTER_LAYER_ID,
      type: 'circle',
      source: OVERLAY_SOURCE_ID,
      'source-layer': 'clusters',
      paint: {
        'circle-color': colours.cluster,
        'circle-opacity': 0.85,
        'circle-stroke-color': colours.siteHalo,
        'circle-stroke-width': 1.5,
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'site_count'],
          1,
          9,
          10,
          14,
          100,
          20,
          1000,
          28,
        ],
      },
    })

    map.addLayer({
      id: CLUSTER_COUNT_LAYER_ID,
      type: 'symbol',
      source: OVERLAY_SOURCE_ID,
      'source-layer': 'clusters',
      layout: {
        'text-field': ['to-string', ['get', 'site_count']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': colours.clusterText },
    })

    map.addLayer({
      id: SITE_LAYER_ID,
      type: 'circle',
      source: OVERLAY_SOURCE_ID,
      'source-layer': 'sites',
      paint: {
        'circle-color': colours.site,
        'circle-stroke-color': colours.siteHalo,
        'circle-stroke-width': 1.5,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 18, 9],
        // Feature state drives hover and selection without a data round trip.
        'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0.9],
      },
    })

    map.addLayer({
      id: SITE_LABEL_LAYER_ID,
      type: 'symbol',
      source: OVERLAY_SOURCE_ID,
      'source-layer': 'sites',
      minzoom: 12,
      layout: {
        'text-field': ['get', 'title'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: {
        'text-color': colours.label,
        'text-halo-color': colours.labelHalo,
        'text-halo-width': 1.4,
      },
    })
  }

  /**
   * Style swaps wipe every custom source and layer, so the overlay is rebuilt
   * on the styledata event that follows. Without this, switching to the modern
   * view would silently empty the map of its content.
   */
  const keepOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (!map.getSource(OVERLAY_SOURCE_ID)) attachOverlay(map)
    })
  }

  const findFeatureAtPoint = (
    map: MapLibreMap,
    point: { x: number; y: number },
  ): MapGeoJSONFeature | null => {
    // A generous touch target: 8px around the tap, since a finger is not a cursor.
    const box: [[number, number], [number, number]] = [
      [point.x - 8, point.y - 8],
      [point.x + 8, point.y + 8],
    ]
    const [feature] = map.queryRenderedFeatures(box, {
      layers: [SITE_LAYER_ID, CLUSTER_LAYER_ID, TRACING_LAYER_ID],
    })
    return feature ?? null
  }

  return {
    attachOverlay,
    keepOverlayThroughStyleChanges,
    findFeatureAtPoint,
    palette,
  }
}
