import { LngLat } from 'maplibre-gl'
import type { FilterSpecification, Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'

export const OVERLAY_SOURCE_ID = 'vestigian-data'
export const SITE_LAYER_ID = 'vestigian-sites'
export const SITE_HALO_LAYER_ID = 'vestigian-site-halo'
export const CLUSTER_LAYER_ID = 'vestigian-clusters'
export const CLUSTER_COUNT_LAYER_ID = 'vestigian-cluster-count'
export const TRACING_LAYER_ID = 'vestigian-tracings'
export const SITE_LABEL_LAYER_ID = 'vestigian-site-labels'
/** Contributed fortifications, drawn as frontier plans while the limes is on. */
export const LIMES_FORT_LAYER_ID = 'vestigian-limes-forts'

interface OverlayPalette extends SiteIconPalette {
  /** Reserved for the selected site. The one oxide accent on this screen. */
  selection: string
  siteHalo: string
  tracing: string
  cluster: string
  clusterText: string
  label: string
  labelHalo: string
}

const LIGHT_OVERLAY: OverlayPalette = {
  ink: '#2b2621',
  linear: '#66593b',
  ground: '#faf7ef',
  ring: '#857759',
  selection: '#9a3b22',
  siteHalo: '#faf7ef',
  tracing: '#7a6c49',
  cluster: '#7d2e1c',
  clusterText: '#faf7ef',
  label: '#1c1815',
  labelHalo: '#faf7ef',
}

const DARK_OVERLAY: OverlayPalette = {
  ink: '#e7dfcd',
  linear: '#bfae7e',
  ground: '#211d17',
  ring: '#4d4534',
  selection: '#d38a72',
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
  const { sheetTone, isFollowingLimes } = useBasemapStyle()

  /**
   * Keyed on the sheet, not the theme. Over an antiquity raster the ground is
   * parchment whatever the reader chose, and the night palette drawn there is a
   * pale marker on a pale sheet — the overlay vanishes with nothing logged.
   */
  const palette = computed<OverlayPalette>(() =>
    sheetTone.value === 'dark' ? DARK_OVERLAY : LIGHT_OVERLAY,
  )

  const attachOverlay = (map: MapLibreMap): void => {
    if (map.getSource(OVERLAY_SOURCE_ID)) return
    const colours = palette.value

    map.addSource(OVERLAY_SOURCE_ID, {
      type: 'vector',
      tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 14,
      attribution:
        'Site data CC BY-SA, contributed to <a href="https://vici.org">Vici.org</a> and Vestigian',
    })

    /**
     * After the source and before the layers, and both halves matter.
     *
     * Before the layers, because MapLibre draws nothing for a symbol whose icon
     * is not in the registry and says nothing about it either.
     *
     * After the source, because `addImage` and `removeImage` each fire a
     * `styledata` event, which is the event this overlay is rebuilt on. Adding
     * the source first is what makes the guard at the top of this function true
     * for that re-entrant call. Registered first instead, the icons re-enter
     * before there is a source to find, and the second view the reader switches
     * to dies in `Maximum call stack size exceeded`.
     */
    registerSiteIcons(map, colours)
    registerAtlasIcons(map, colours)
    registerLimesIcons(map, colours)
    registerBattleIcon(map, colours)

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
        // Counted clusters are the loudest thing on the sheet below zoom 9, and
        // the frontier has to be the loudest thing while it is showing. They
        // still say where the records are; they stop shouting it.
        'circle-opacity': isFollowingLimes.value ? 0.35 : 0.85,
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
        'text-font': [MAP_LABEL_FONT],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': colours.clusterText,
        'text-opacity': isFollowingLimes.value ? 0.45 : 1,
      },
    })

    /**
     * Selection is a ring drawn under the marker rather than a change to the
     * marker itself, so the glyph still says what the site is while it is open.
     * Feature state drives it without a data round trip.
     */
    map.addLayer({
      id: SITE_HALO_LAYER_ID,
      type: 'circle',
      source: OVERLAY_SOURCE_ID,
      'source-layer': 'sites',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 11, 17, 17],
        'circle-color': colours.selection,
        'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.16, 0],
        'circle-stroke-color': colours.selection,
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 0],
      },
    })

    map.addLayer({
      id: SITE_LAYER_ID,
      type: 'symbol',
      source: OVERLAY_SOURCE_ID,
      'source-layer': 'sites',
      /**
       * While the frontier is showing, the fortifications are drawn by the
       * layer below instead. Without this they are drawn by both and every fort
       * on the Rhine carries two stacked glyphs.
       */
      ...(isFollowingLimes.value
        ? { filter: ['!=', ['get', 'category'], 'fortification'] as FilterSpecification }
        : {}),
      layout: {
        'icon-image': buildSiteIconExpression(),
        // Full size only once the drawing is worth reading; smaller at the zoom
        // where the map is about density rather than about individual records.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.62, 13, 0.85, 17, 1],
        /**
         * Never let collision hide a marker. A dropped site is a record the
         * reader has no way of knowing exists, and it cannot be tapped either
         * — worse than an overlapping pair they can zoom apart.
         */
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })

    /**
     * The contributed frontier posts, drawn as plans instead of crenellations.
     *
     * A separate layer rather than a branch inside `vestigian-sites`, because
     * the two differ in more than their icon: this one comes forward, sits
     * above the frontier line, and is the reason a reader can tell 6,914
     * watchtowers from 5,551 forts along the Rhine at a glance.
     *
     * Its visibility is read here rather than watched. Every change to the
     * switch changes the style, `setStyle` fires `styledata`, and
     * `keepOverlayThroughStyleChanges` runs this function again — so the value
     * is always current at the moment the layer is added, and a watcher would
     * be a second mechanism doing the same job one tick later.
     */
    map.addLayer({
      id: LIMES_FORT_LAYER_ID,
      type: 'symbol',
      source: OVERLAY_SOURCE_ID,
      'source-layer': 'sites',
      minzoom: 7,
      filter: ['==', ['get', 'category'], 'fortification'],
      layout: {
        visibility: isFollowingLimes.value ? 'visible' : 'none',
        'icon-image': buildLimesRecordIconExpression(),
        // Larger than the general site marker. These are plans rather than
        // silhouettes, so they need the room to be read as plans.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.65, 11, 1, 16, 1.3],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
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
        'text-font': [MAP_LABEL_FONT],
        'text-size': 12,
        'text-offset': [0, 1.35],
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

  /**
   * Live-patches the dimming the frontier switch drives, without a style
   * reload.
   *
   * `attachOverlay` reads `isFollowingLimes` once, when the layers are built,
   * and relied on that being enough: toggling the switch used to always
   * change `currentStyle`'s content too (the frontier was baked into the
   * Barrington style), so `setStyle`'s diff always produced a real update and
   * the `styledata` hook above rebuilt these layers with the current value.
   * Now that the frontier can be switched on over *any* basemap, toggling it
   * on a view that does not read `isFollowingLimes` at all — `vestigian`, say
   * — leaves `buildBasemapStyle`'s output byte-identical, MapLibre's diff
   * finds nothing to do, and the layers built at attach time would go stale
   * silently. Called directly on every change instead of trusting a style
   * swap to carry it.
   */
  const refreshLimesDimming = (map: MapLibreMap): void => {
    if (!map.getSource(OVERLAY_SOURCE_ID)) return
    const following = isFollowingLimes.value

    map.setPaintProperty(CLUSTER_LAYER_ID, 'circle-opacity', following ? 0.35 : 0.85)
    map.setPaintProperty(CLUSTER_COUNT_LAYER_ID, 'text-opacity', following ? 0.45 : 1)
    map.setFilter(
      SITE_LAYER_ID,
      following ? (['!=', ['get', 'category'], 'fortification'] as FilterSpecification) : null,
    )
    map.setLayoutProperty(LIMES_FORT_LAYER_ID, 'visibility', following ? 'visible' : 'none')
  }

  /**
   * Everything under the tap, not just the topmost thing.
   *
   * `queryRenderedFeatures` returns hits in render order, so taking the first
   * one hands the reader whichever marker happened to be drawn last — which is
   * arbitrary from where they are sitting. Markers are drawn with
   * `icon-allow-overlap`, so at a dense site several of them genuinely occupy
   * the same few pixels, and some records share a coordinate exactly and can
   * never be separated by zooming. The caller gets the whole list and asks.
   *
   * A feature that straddles a tile boundary is returned once per tile it
   * appears in, hence the deduplication.
   */
  const findFeaturesAtPoint = (
    map: MapLibreMap,
    point: { x: number; y: number },
  ): MapGeoJSONFeature[] => {
    // A generous touch target: 8px around the tap, since a finger is not a cursor.
    const box: [[number, number], [number, number]] = [
      [point.x - 8, point.y - 8],
      [point.x + 8, point.y + 8],
    ]

    const seen = new Set<string>()

    return map
      .queryRenderedFeatures(box, {
        // The frontier layer has to be listed too. While the limes is showing
        // it is the only layer drawing fortifications, so leaving it out makes
        // every fort on the frontier untappable — and it is a hidden layer the
        // rest of the time, which `queryRenderedFeatures` skips on its own.
        layers: [SITE_LAYER_ID, LIMES_FORT_LAYER_ID, CLUSTER_LAYER_ID, TRACING_LAYER_ID],
      })
      .filter((feature) => {
        const key = `${feature.layer.id}:${feature.id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }

  return {
    attachOverlay,
    keepOverlayThroughStyleChanges,
    refreshLimesDimming,
    findFeaturesAtPoint,
    palette,
  }
}

export interface FeatureDescriptionRequest {
  map: MapLibreMap
  features: MapGeoJSONFeature[]
  point: { x: number; y: number }
}

/**
 * Turns raw tile features into something the picker can list: what kind of
 * record it is, what it is called, and how far it actually sits from the tap.
 *
 * Distance is what makes the list usable — within an 8px box two entries are
 * indistinguishable by position alone, and "at this point" versus "40 m away"
 * is often the only thing that tells the reader which one they meant. Line
 * features get no distance: the nearest point of a road to the tap says
 * nothing useful about the road.
 *
 * Sorted nearest first, so a single confident hit stays at the top where a
 * reader who taps and immediately picks the first row gets what they expected.
 */
export const describeFeatures = (request: FeatureDescriptionRequest): MapFeatureCandidate[] => {
  const origin = request.map.unproject([request.point.x, request.point.y])

  return request.features
    .filter((feature) => feature.layer.id !== CLUSTER_LAYER_ID && typeof feature.id === 'number')
    .map((feature) => {
      const isPoint = feature.geometry.type === 'Point'
      const [lon, lat] = isPoint ? (feature.geometry as GeoJSON.Point).coordinates : [0, 0]

      return {
        kind: feature.layer.id === TRACING_LAYER_ID ? ('tracing' as const) : ('site' as const),
        id: feature.id as number,
        title: String(feature.properties?.title ?? 'Untitled'),
        category: String(feature.properties?.category ?? 'other'),
        distanceMetres: isPoint ? origin.distanceTo(new LngLat(lon!, lat!)) : null,
      }
    })
    .sort(
      (a, b) =>
        (a.distanceMetres ?? Number.MAX_SAFE_INTEGER) -
        (b.distanceMetres ?? Number.MAX_SAFE_INTEGER),
    )
}
