import type { Map as MapLibreMap, MapLayerMouseEvent, SymbolLayerSpecification } from 'maplibre-gl'
import { escapeHtmlForPopup } from './useBattleOverlay'
import { PORT_ATTRIBUTION } from './useBasemapStyle'
import { bindOverlayListenersOnce } from './useMapInstance'
import { PORT_ICON_ID } from './useSiteIcons'

export const PORT_SOURCE_ID = 'ports'
export const PORT_LAYER_ID = 'vestigian-ports'

export interface PortFeatureProperties {
  title: string
  modern_name: string | null
  country: string | null
  foundation: string | null
  pleiades_url: string | null
  wikipedia_url: string | null
}

/** One symbol layer, no `match` expression needed — there is only one mark. */
export const buildPortLayer = (): SymbolLayerSpecification => ({
  id: PORT_LAYER_ID,
  type: 'symbol',
  source: PORT_SOURCE_ID,
  'source-layer': 'ports',
  layout: {
    'icon-image': PORT_ICON_ID,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1, 14, 1.2],
    'icon-allow-overlap': true,
  },
})

export type PortPopupTranslate = (
  key: 'portPopup.viewOnPleiades' | 'portPopup.viewOnWikipedia',
) => string

export const buildPortPopupHtml = (
  properties: PortFeatureProperties,
  t: PortPopupTranslate,
): string => {
  const lines = [`<strong>${escapeHtmlForPopup(properties.title)}</strong>`]

  if (properties.modern_name) lines.push(escapeHtmlForPopup(properties.modern_name))
  if (properties.country) lines.push(escapeHtmlForPopup(properties.country))
  if (properties.foundation) lines.push(escapeHtmlForPopup(properties.foundation))

  if (properties.pleiades_url) {
    const href = escapeHtmlForPopup(properties.pleiades_url)
    lines.push(
      `<a href="${href}" target="_blank" rel="noopener noreferrer">${t('portPopup.viewOnPleiades')} ↗</a>`,
    )
  }
  if (properties.wikipedia_url) {
    const href = escapeHtmlForPopup(properties.wikipedia_url)
    lines.push(
      `<a href="${href}" target="_blank" rel="noopener noreferrer">${t('portPopup.viewOnWikipedia')} ↗</a>`,
    )
  }

  return lines.join('<br>')
}

/**
 * Ancient ports and harbours, drawn as an overlay above whichever basemap
 * is showing — the same "a fact about the world, not a reading of one
 * sheet" reasoning `useBattleOverlay` already gives. Not wired into the
 * site/tracing selection machinery for the same reason battles aren't: a
 * port has no slug or detail panel to open, so a plain MapLibre `Popup`
 * bound directly to this layer's own click event is a smaller,
 * self-contained answer.
 */
export const usePortOverlay = () => {
  const { isShowingPorts, portTilesUrl } = useBasemapStyle()
  const { t } = useI18n()
  const { openOverlayPopup } = useOverlayPopup()

  const showPortPopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (feature?.geometry.type !== 'Point') return

    openOverlayPopup({
      map,
      position: feature.geometry.coordinates as [number, number],
      html: buildPortPopupHtml(feature.properties as PortFeatureProperties, t),
      maxWidth: '260px',
    })
  }

  const attachPortOverlay = (map: MapLibreMap): void => {
    if (!isShowingPorts.value) return
    if (map.getSource(PORT_SOURCE_ID)) return

    map.addSource(PORT_SOURCE_ID, {
      type: 'vector',
      tiles: [`${portTilesUrl.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: PORT_ATTRIBUTION,
    })

    map.addLayer(buildPortLayer())
    // See `useLimesOverlay`'s `attachLimesOverlay` for why this call is needed.
    map.triggerRepaint()

    bindOverlayListenersOnce(map, PORT_LAYER_ID, () => {
      map.on('click', PORT_LAYER_ID, (event) => showPortPopup(map, event))
      map.on('mouseenter', PORT_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', PORT_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    })
  }

  const detachPortOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(PORT_LAYER_ID)) map.removeLayer(PORT_LAYER_ID)
    if (map.getSource(PORT_SOURCE_ID)) map.removeSource(PORT_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepPortOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isShowingPorts.value && !map.getSource(PORT_SOURCE_ID)) attachPortOverlay(map)
    })
  }

  return {
    isActive: isShowingPorts,
    attachPortOverlay,
    detachPortOverlay,
    keepPortOverlayThroughStyleChanges,
  }
}
