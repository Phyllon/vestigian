import type { LineLayerSpecification, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import { ROUTE_ATTRIBUTION } from './useBasemapStyle'
import { bindOverlayListenersOnce } from './useMapInstance'
import { ATLAS_MARK_INK } from './useSiteIcons'
import { escapeHtmlForPopup } from './popupHtml'

export const ROUTE_SOURCE_ID = 'routes'
export const ROUTE_LAYER_ID = 'vestigian-routes'

export type RouteType = 'road' | 'coastal' | 'overseas' | 'upstream' | 'downstream' | 'ferry'

export interface RouteFeatureProperties {
  route_type: RouteType
  source_title: string | null
  target_title: string | null
}

/**
 * One line layer, one hue — the design brief's "one hue for linear
 * features" rule already applied to tracings and the limes, kept here
 * rather than adding a second colour key nobody asked for. The six route
 * kinds are told apart by dash pattern instead: `road` closest to a
 * tracing's own dash, the four water kinds a tighter dash, `ferry`
 * dotted.
 */
export const buildRouteLayer = (): LineLayerSpecification => ({
  id: ROUTE_LAYER_ID,
  type: 'line',
  source: ROUTE_SOURCE_ID,
  'source-layer': 'routes',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': ATLAS_MARK_INK,
    'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 10, 2],
    'line-opacity': 0.85,
    'line-dasharray': [
      'match',
      ['get', 'route_type'],
      'road',
      ['literal', [4, 2]],
      'ferry',
      ['literal', [1, 2]],
      ['literal', [2, 2]],
    ],
  },
})

export type RoutePopupTranslate = (key: `routePopup.${RouteType}`) => string

export const buildRoutePopupHtml = (
  properties: RouteFeatureProperties,
  t: RoutePopupTranslate,
): string => {
  const kindLabel = escapeHtmlForPopup(t(`routePopup.${properties.route_type}`))
  const lines = [`<strong>${kindLabel}</strong>`]

  if (properties.source_title && properties.target_title) {
    const source = escapeHtmlForPopup(properties.source_title)
    const target = escapeHtmlForPopup(properties.target_title)
    lines.push(`${source} → ${target}`)
  }

  return lines.join('<br>')
}

/**
 * The ORBIS route network, drawn as an overlay above whichever basemap is
 * showing — the same "a fact about the world, not a reading of one sheet"
 * reasoning `useBattleOverlay`/`usePortOverlay` already give. Not wired
 * into the site/tracing selection machinery for the same reason: a route
 * has no slug or detail panel, so a plain MapLibre `Popup` bound directly
 * to this layer's own click event is the smaller, self-contained answer.
 */
export const useRouteOverlay = () => {
  const { isShowingRoutes, routeTilesUrl } = useBasemapStyle()
  const { t } = useI18n()
  const { openOverlayPopup } = useOverlayPopup()

  const showRoutePopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (!feature) return

    openOverlayPopup({
      map,
      position: [event.lngLat.lng, event.lngLat.lat],
      html: buildRoutePopupHtml(feature.properties as RouteFeatureProperties, t),
      maxWidth: '260px',
      withRing: false,
    })
  }

  const attachRouteOverlay = (map: MapLibreMap): void => {
    if (!isShowingRoutes.value) return
    if (map.getSource(ROUTE_SOURCE_ID)) return

    map.addSource(ROUTE_SOURCE_ID, {
      type: 'vector',
      tiles: [`${routeTilesUrl.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: ROUTE_ATTRIBUTION,
    })

    map.addLayer(buildRouteLayer())
    // See `useLimesOverlay`'s `attachLimesOverlay` for why this call is needed.
    map.triggerRepaint()

    bindOverlayListenersOnce(map, ROUTE_LAYER_ID, () => {
      map.on('click', ROUTE_LAYER_ID, (event) => showRoutePopup(map, event))
      map.on('mouseenter', ROUTE_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', ROUTE_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    })
  }

  const detachRouteOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID)
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepRouteOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isShowingRoutes.value && !map.getSource(ROUTE_SOURCE_ID)) attachRouteOverlay(map)
    })
  }

  return {
    isActive: isShowingRoutes,
    attachRouteOverlay,
    detachRouteOverlay,
    keepRouteOverlayThroughStyleChanges,
  }
}
