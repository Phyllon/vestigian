import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { LonLat } from '#shared/types'
import type { RayLine, SightlineMapGeometry, SightlineMode } from '#shared/utils/sightline-overlay'

export const SIGHTLINE_SOURCE_ID = 'vestigian-sightline'
const SEEN_LAYER_ID = 'vestigian-sightline-seen'
const FILL_LAYER_ID = 'vestigian-sightline-fill'
const RING_LAYER_ID = 'vestigian-sightline-ring'
const CASING_LAYER_ID = 'vestigian-sightline-casing'
const OUTLINE_LAYER_ID = 'vestigian-sightline-outline'
const RANGE_LAYER_ID = 'vestigian-sightline-range'
const RAY_SEEN_LAYER_ID = 'vestigian-sightline-ray-seen'
const RAY_HIDDEN_LAYER_ID = 'vestigian-sightline-ray-hidden'
const LINK_LAYER_ID = 'vestigian-sightline-link'
const PROBE_LAYER_ID = 'vestigian-sightline-probe'
const LABEL_LAYER_ID = 'vestigian-sightline-label'

export interface SightlineOverlayData {
  towerId: number
  mode: SightlineMode
  geometry: SightlineMapGeometry
  /** The line from the tower to the neighbour being looked at, when one is chosen. */
  link: [[number, number], [number, number]] | null
  /** The compass line being explained, as seen and hidden stretches. */
  rayLines: RayLine[]
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Lower is placed first when labels collide: the spokes win over rings, rings over the far mark. */
const LABEL_PRIORITY: Record<string, number> = { spoke: 0, farthest: 1, ring: 2 }

/** Everything a tower's state draws, as features. Kept out of the composable so it reads as a list. */
const featuresOf = (current: SightlineOverlayData): GeoJSON.Feature[] => {
  const { geometry, mode } = current
  const features: GeoJSON.Feature[] = []

  if (geometry.seenRings.length > 0) {
    features.push({
      type: 'Feature',
      properties: { role: 'seen', tone: mode },
      geometry: { type: 'MultiPolygon', coordinates: geometry.seenRings.map((ring) => [ring]) },
    })
  }

  if (geometry.outlines) {
    // Widest first, so the middle estimate's fill is not painted over by the others.
    for (const variant of ['high', 'low', 'central'] as const) {
      features.push({
        type: 'Feature',
        properties: { role: 'outline', variant },
        geometry: { type: 'Polygon', coordinates: [geometry.outlines[variant]] },
      })
    }
  }

  for (const circle of geometry.distanceCircles) {
    features.push({
      type: 'Feature',
      properties: { role: 'ring', tone: mode },
      geometry: { type: 'LineString', coordinates: circle.ring },
    })
  }

  for (const line of current.rayLines) {
    features.push({
      type: 'Feature',
      properties: { role: 'ray', isSeen: line.isSeen, tone: mode },
      geometry: { type: 'LineString', coordinates: line.coordinates },
    })
  }

  if (current.link) {
    features.push({
      type: 'Feature',
      properties: { role: 'link' },
      geometry: { type: 'LineString', coordinates: current.link },
    })
  }

  for (const label of geometry.labels) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'label',
        tone: mode,
        text: label.text,
        priority: LABEL_PRIORITY[label.role] ?? 3,
      },
      geometry: { type: 'Point', coordinates: [label.position.lon, label.position.lat] },
    })
  }

  return features
}

/**
 * A tower's calculated view, drawn over the shared map — and the numbers that go
 * with it, written where the thing they measure ends.
 *
 * **A `geojson` source and not a tile layer** for the reason the notebook's is:
 * it is one reader's current question, a few thousand vertices, and putting it in
 * a tile would key the tile cache to it. State lives in `useState` so the
 * component that fetched the answer and the canvas that draws it need not know
 * each other — the same arrangement as `useNotebookOverlay`.
 *
 * What is drawn, bottom to top: the ground **seen** at all (a pale wash of polar
 * cells, which is where a tower on a rim shows it is not blind); the **unbroken**
 * view (a filled outline at the middle height estimate, dashed outlines for the
 * lower and higher); **rings** at fixed distances; the compass line being
 * explained (seen stretches solid, hidden stretches dotted); and the labels.
 *
 * Amber for what the tower sees, a slate blue for where it is seen from. Not
 * oxide: the one accent belongs to the selected site, drawn right beside it. Not
 * bronze either, which means a linear feature.
 */
export const useSightlineOverlay = () => {
  const { sheetTone } = useBasemapStyle()

  const data = useState<SightlineOverlayData | null>('sightline-overlay', () => null)
  const probe = useState<LonLat | null>('sightline-probe', () => null)

  const palette = computed(() =>
    sheetTone.value === 'dark'
      ? {
          view: '#f0b94d',
          viewFill: '#f0b94d',
          from: '#8fb8d6',
          hidden: '#b8ae98',
          halo: 'rgba(28, 24, 21, 0.85)',
          text: '#f6e7c4',
        }
      : {
          view: '#9a5b06',
          viewFill: '#d98a1c',
          from: '#2f5f86',
          hidden: '#6b6256',
          halo: 'rgba(255, 255, 255, 0.85)',
          text: '#3d2602',
        },
  )

  const collection = computed((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = []
    const current = data.value
    if (current) features.push(...featuresOf(current))

    // A cursor on a profile is drawn whether or not a view is.
    if (probe.value) {
      features.push({
        type: 'Feature',
        properties: { role: 'probe' },
        geometry: { type: 'Point', coordinates: [probe.value.lon, probe.value.lat] },
      })
    }

    return features.length === 0 ? EMPTY : { type: 'FeatureCollection', features }
  })

  const attachSightlineOverlay = (map: MapLibreMap): void => {
    if (map.getSource(SIGHTLINE_SOURCE_ID)) return
    const colours = palette.value
    const toneColour = [
      'match',
      ['get', 'tone'],
      'seenFrom',
      colours.from,
      colours.view,
    ] as unknown as string

    map.addSource(SIGHTLINE_SOURCE_ID, { type: 'geojson', data: collection.value })

    // The ground seen at all. `fill-antialias` off: adjacent wedges share edges, and
    // antialiasing draws every shared edge as a pale seam.
    map.addLayer({
      id: SEEN_LAYER_ID,
      type: 'fill',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'seen'],
      paint: {
        'fill-color': [
          'match',
          ['get', 'tone'],
          'seenFrom',
          colours.from,
          colours.viewFill,
        ] as unknown as string,
        'fill-opacity': 0.13,
        'fill-antialias': false,
      },
    })

    map.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'outline'], ['==', ['get', 'variant'], 'central']],
      paint: { 'fill-color': colours.viewFill, 'fill-opacity': 0.18 },
    })

    map.addLayer({
      id: RING_LAYER_ID,
      type: 'line',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'ring'],
      paint: {
        'line-color': toneColour,
        'line-width': 1,
        'line-opacity': 0.6,
        'line-dasharray': [0.6, 3],
      },
    })

    // A pale or dark casing under the outline, so it holds over satellite imagery.
    map.addLayer({
      id: CASING_LAYER_ID,
      type: 'line',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'outline'], ['==', ['get', 'variant'], 'central']],
      paint: { 'line-color': colours.halo, 'line-width': 5 },
    })

    map.addLayer({
      id: OUTLINE_LAYER_ID,
      type: 'line',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'outline'], ['==', ['get', 'variant'], 'central']],
      paint: { 'line-color': colours.view, 'line-width': 2.25 },
    })

    // `line-dasharray` is not data-driven (see the limes layers), hence its own layer.
    map.addLayer({
      id: RANGE_LAYER_ID,
      type: 'line',
      source: SIGHTLINE_SOURCE_ID,
      filter: [
        'all',
        ['==', ['get', 'role'], 'outline'],
        ['in', ['get', 'variant'], ['literal', ['low', 'high']]],
      ],
      paint: {
        'line-color': colours.view,
        'line-width': 1.25,
        'line-dasharray': [3, 2],
        'line-opacity': 0.9,
      },
    })

    map.addLayer({
      id: RAY_HIDDEN_LAYER_ID,
      type: 'line',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'ray'], ['==', ['get', 'isSeen'], false]],
      paint: { 'line-color': colours.hidden, 'line-width': 3, 'line-dasharray': [1, 1.6] },
    })

    map.addLayer({
      id: RAY_SEEN_LAYER_ID,
      type: 'line',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'ray'], ['==', ['get', 'isSeen'], true]],
      paint: { 'line-color': toneColour, 'line-width': 4 },
    })

    map.addLayer({
      id: LINK_LAYER_ID,
      type: 'line',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'link'],
      paint: { 'line-color': colours.view, 'line-width': 3, 'line-dasharray': [1, 1.5] },
    })

    map.addLayer({
      id: PROBE_LAYER_ID,
      type: 'circle',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'probe'],
      paint: {
        'circle-radius': 6,
        'circle-color': colours.halo,
        'circle-stroke-color': colours.view,
        'circle-stroke-width': 3,
      },
    })

    // The numbers. Spokes are placed first and win a collision; rings give way.
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SIGHTLINE_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'label'],
      layout: {
        'text-field': ['get', 'text'],
        'text-font': [MAP_LABEL_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 16, 14],
        'text-anchor': 'center',
        'text-offset': [0, 0],
        'text-allow-overlap': false,
        'text-optional': false,
        'symbol-sort-key': ['get', 'priority'],
      },
      paint: {
        'text-color': [
          'match',
          ['get', 'tone'],
          'seenFrom',
          colours.from,
          colours.text,
        ] as unknown as string,
        'text-halo-color': colours.halo,
        'text-halo-width': 1.8,
      },
    })

    map.triggerRepaint()
  }

  /** Style swaps wipe custom sources; rebuilt on the `styledata` that follows. */
  const keepSightlineThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (!map.getSource(SIGHTLINE_SOURCE_ID)) attachSightlineOverlay(map)
    })
  }

  const refreshSightlineOverlay = (map: MapLibreMap): void => {
    const source = map.getSource(SIGHTLINE_SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(collection.value)
  }

  const showSightlines = (next: SightlineOverlayData): void => {
    data.value = next
  }

  const clearSightlines = (towerId?: number): void => {
    // A panel for another tower may already have replaced this one.
    if (towerId !== undefined && data.value?.towerId !== towerId) return
    data.value = null
    probe.value = null
  }

  return {
    data,
    probe,
    collection,
    attachSightlineOverlay,
    keepSightlineThroughStyleChanges,
    refreshSightlineOverlay,
    showSightlines,
    clearSightlines,
  }
}
