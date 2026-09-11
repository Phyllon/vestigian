import { Popup } from 'maplibre-gl'
import type { Map as MapLibreMap, MapLayerMouseEvent, SymbolLayerSpecification } from 'maplibre-gl'
import { escapeHtmlForPopup } from './useBattleOverlay'
import { COIN_HOARD_ATTRIBUTION } from './useBasemapStyle'
import { bindOverlayListenersOnce } from './useMapInstance'
import { COIN_HOARD_ICON_ID } from './useSiteIcons'

export const COIN_HOARD_SOURCE_ID = 'coin-hoards'
export const COIN_HOARD_LAYER_ID = 'vestigian-coin-hoards'

export interface CoinHoardFeatureProperties {
  name: string
  hoard_count: number
  geonames_url: string | null
}

/** One symbol layer, no `match` expression needed — there is only one mark. */
export const buildCoinHoardLayer = (): SymbolLayerSpecification => ({
  id: COIN_HOARD_LAYER_ID,
  type: 'symbol',
  source: COIN_HOARD_SOURCE_ID,
  'source-layer': 'coin_hoards',
  layout: {
    'icon-image': COIN_HOARD_ICON_ID,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1, 14, 1.2],
    'icon-allow-overlap': true,
  },
})

export type CoinHoardPopupTranslate = (
  key: 'coinHoardPopup.hoardCount' | 'coinHoardPopup.viewOnGeonames',
  count?: number,
) => string

export const buildCoinHoardPopupHtml = (
  properties: CoinHoardFeatureProperties,
  t: CoinHoardPopupTranslate,
): string => {
  const lines = [
    `<strong>${escapeHtmlForPopup(properties.name)}</strong>`,
    escapeHtmlForPopup(t('coinHoardPopup.hoardCount', properties.hoard_count)),
  ]

  if (properties.geonames_url) {
    const href = escapeHtmlForPopup(properties.geonames_url)
    const label = t('coinHoardPopup.viewOnGeonames')
    lines.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`)
  }

  return lines.join('<br>')
}

/**
 * CHRR coin-hoard findspots, drawn as an overlay above whichever basemap
 * is showing — the same "a fact about the world, not a reading of one
 * sheet" reasoning `useBattleOverlay`/`usePortOverlay` already give. Not
 * wired into the site/tracing selection machinery for the same reason: a
 * findspot has no slug or detail panel, so a plain MapLibre `Popup` bound
 * directly to this layer's own click event is the smaller, self-contained
 * answer.
 */
export const useCoinHoardOverlay = () => {
  const { isShowingCoinHoards, coinHoardTilesUrl } = useBasemapStyle()
  const { t } = useI18n()

  const showCoinHoardPopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (feature?.geometry.type !== 'Point') return

    new Popup({ closeButton: true, maxWidth: '240px' })
      .setLngLat(feature.geometry.coordinates as [number, number])
      .setHTML(buildCoinHoardPopupHtml(feature.properties as CoinHoardFeatureProperties, t))
      .addTo(map)
  }

  const attachCoinHoardOverlay = (map: MapLibreMap): void => {
    if (!isShowingCoinHoards.value) return
    if (map.getSource(COIN_HOARD_SOURCE_ID)) return

    map.addSource(COIN_HOARD_SOURCE_ID, {
      type: 'vector',
      tiles: [`${coinHoardTilesUrl.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: COIN_HOARD_ATTRIBUTION,
    })

    map.addLayer(buildCoinHoardLayer())
    // See `useLimesOverlay`'s `attachLimesOverlay` for why this call is needed.
    map.triggerRepaint()

    bindOverlayListenersOnce(map, COIN_HOARD_LAYER_ID, () => {
      map.on('click', COIN_HOARD_LAYER_ID, (event) => showCoinHoardPopup(map, event))
      map.on('mouseenter', COIN_HOARD_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', COIN_HOARD_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    })
  }

  const detachCoinHoardOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(COIN_HOARD_LAYER_ID)) map.removeLayer(COIN_HOARD_LAYER_ID)
    if (map.getSource(COIN_HOARD_SOURCE_ID)) map.removeSource(COIN_HOARD_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepCoinHoardOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isShowingCoinHoards.value && !map.getSource(COIN_HOARD_SOURCE_ID)) {
        attachCoinHoardOverlay(map)
      }
    })
  }

  return {
    isActive: isShowingCoinHoards,
    attachCoinHoardOverlay,
    detachCoinHoardOverlay,
    keepCoinHoardOverlayThroughStyleChanges,
  }
}
