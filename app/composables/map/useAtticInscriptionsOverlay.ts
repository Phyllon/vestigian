import { Popup } from 'maplibre-gl'
import type { Map as MapLibreMap, MapLayerMouseEvent, SymbolLayerSpecification } from 'maplibre-gl'
import { escapeHtmlForPopup } from './useBattleOverlay'
import { ATTIC_INSCRIPTION_ATTRIBUTION } from './useBasemapStyle'
import { bindOverlayListenersOnce } from './useMapInstance'
import { ATTIC_INSCRIPTION_ICON_ID } from './useSiteIcons'
import { formatPeriod } from '../data/useSiteQuery'

export const ATTIC_INSCRIPTION_SOURCE_ID = 'attic-inscriptions'
export const ATTIC_INSCRIPTION_LAYER_ID = 'vestigian-attic-inscriptions'

export interface AtticInscriptionFeatureProperties {
  aio_key: string
  title: string
  monument_type: string | null
  not_before: number | null
  not_after: number | null
}

/** One symbol layer, same shape as `buildInscriptionLayer`. */
export const buildAtticInscriptionLayer = (): SymbolLayerSpecification => ({
  id: ATTIC_INSCRIPTION_LAYER_ID,
  type: 'symbol',
  source: ATTIC_INSCRIPTION_SOURCE_ID,
  'source-layer': 'attic_inscriptions',
  layout: {
    'icon-image': ATTIC_INSCRIPTION_ICON_ID,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1, 14, 1.2],
    'icon-allow-overlap': true,
  },
})

export type AtticInscriptionPopupTranslate = (
  key: string,
  named?: Record<string, unknown>,
) => string

export const buildAtticInscriptionPopupHtml = (
  properties: AtticInscriptionFeatureProperties,
  t: AtticInscriptionPopupTranslate,
): string => {
  const lines = [`<strong>${escapeHtmlForPopup(properties.title)}</strong>`]

  if (properties.monument_type) lines.push(escapeHtmlForPopup(properties.monument_type))

  // Same MVT null-becomes-undefined normalisation `buildInscriptionPopupHtml`
  // already applies — see `.claude/rules/map-and-tiles.md`.
  const period = formatPeriod(properties.not_before ?? null, properties.not_after ?? null, t)
  if (period && period !== t('periodFormat.undated')) lines.push(escapeHtmlForPopup(period))

  const href = escapeHtmlForPopup(`/inscriptions/attic/${properties.aio_key}`)
  lines.push(`<a href="${href}">${t('epigraphy.popup.open')} ↗</a>`)

  return lines.join('<br>')
}

/**
 * Attic Inscriptions Online, a second reference overlay alongside
 * `useInscriptionsOverlay` — see `.claude/rules/epigraphy.md` for why this
 * is a separate table and a separate switch rather than folded into "Show
 * inscriptions". Same popup/attach/detach/keep-through-style-changes shape.
 */
export const useAtticInscriptionsOverlay = () => {
  const { isShowingAtticInscriptions, atticInscriptionTilesUrl } = useBasemapStyle()
  const { t } = useI18n()

  const showAtticInscriptionPopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (feature?.geometry.type !== 'Point') return

    new Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(feature.geometry.coordinates as [number, number])
      .setHTML(
        buildAtticInscriptionPopupHtml(feature.properties as AtticInscriptionFeatureProperties, t),
      )
      .addTo(map)
  }

  const attachAtticInscriptionsOverlay = (map: MapLibreMap): void => {
    if (!isShowingAtticInscriptions.value) return
    if (map.getSource(ATTIC_INSCRIPTION_SOURCE_ID)) return

    map.addSource(ATTIC_INSCRIPTION_SOURCE_ID, {
      type: 'vector',
      tiles: [`${atticInscriptionTilesUrl.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: ATTIC_INSCRIPTION_ATTRIBUTION,
    })

    map.addLayer(buildAtticInscriptionLayer())
    map.triggerRepaint()

    bindOverlayListenersOnce(map, ATTIC_INSCRIPTION_LAYER_ID, () => {
      map.on('click', ATTIC_INSCRIPTION_LAYER_ID, (event) => showAtticInscriptionPopup(map, event))
      map.on('mouseenter', ATTIC_INSCRIPTION_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', ATTIC_INSCRIPTION_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    })
  }

  const detachAtticInscriptionsOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(ATTIC_INSCRIPTION_LAYER_ID)) map.removeLayer(ATTIC_INSCRIPTION_LAYER_ID)
    if (map.getSource(ATTIC_INSCRIPTION_SOURCE_ID)) map.removeSource(ATTIC_INSCRIPTION_SOURCE_ID)
  }

  const keepAtticInscriptionsOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isShowingAtticInscriptions.value && !map.getSource(ATTIC_INSCRIPTION_SOURCE_ID)) {
        attachAtticInscriptionsOverlay(map)
      }
    })
  }

  return {
    isActive: isShowingAtticInscriptions,
    attachAtticInscriptionsOverlay,
    detachAtticInscriptionsOverlay,
    keepAtticInscriptionsOverlayThroughStyleChanges,
  }
}
