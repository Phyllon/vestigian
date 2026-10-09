import type { Map as MapLibreMap, MapLayerMouseEvent, SymbolLayerSpecification } from 'maplibre-gl'
import { escapeHtmlForPopup } from './useBattleOverlay'
import { INSCRIPTION_ATTRIBUTION } from './useBasemapStyle'
import { bindOverlayListenersOnce } from './useMapInstance'
import { INSCRIPTION_ICON_ID, MARKER_ICON_SIZE } from './useSiteIcons'
import { formatPeriod } from '../data/useSiteQuery'

export const INSCRIPTION_SOURCE_ID = 'inscriptions'
export const INSCRIPTION_LAYER_ID = 'vestigian-inscriptions'

export interface InscriptionFeatureProperties {
  edh_id: string
  title: string
  inscription_type: string | null
  material: string | null
  not_before: number | null
  not_after: number | null
}

/** One symbol layer, no `match` expression needed — there is only one mark,
 *  the same shape as `buildPortLayer`. */
export const buildInscriptionLayer = (): SymbolLayerSpecification => ({
  id: INSCRIPTION_LAYER_ID,
  type: 'symbol',
  source: INSCRIPTION_SOURCE_ID,
  'source-layer': 'inscriptions',
  layout: {
    'icon-image': INSCRIPTION_ICON_ID,
    'icon-size': MARKER_ICON_SIZE,
    'icon-allow-overlap': true,
  },
})

export type InscriptionPopupTranslate = (key: string, named?: Record<string, unknown>) => string

/** The same "known term → readable label, else the raw normalised value"
 *  fallback `/inscriptions` itself already uses. */
const typeLabel = (value: string | null, t: InscriptionPopupTranslate): string | null => {
  if (!value) return null
  const key = `epigraphy.types.${value}`
  const translated = t(key)
  return translated !== key ? translated : value
}

export const buildInscriptionPopupHtml = (
  properties: InscriptionFeatureProperties,
  t: InscriptionPopupTranslate,
): string => {
  const lines = [`<strong>${escapeHtmlForPopup(properties.title)}</strong>`]

  const type = typeLabel(properties.inscription_type, t)
  if (type) lines.push(escapeHtmlForPopup(type))
  if (properties.material) lines.push(escapeHtmlForPopup(properties.material))

  // MVT has no null type — a NULL column is simply omitted from the decoded
  // feature's properties, arriving here as `undefined`, not `null`. Confirmed
  // live: an undated inscription (both columns NULL) rendered a bare "AD"
  // instead of "Undated", because `formatPeriod`'s `from === to` branch
  // matched on `undefined === undefined` before its own `=== null` checks
  // ever got a chance to. Normalising here is the fix, not loosening
  // `formatPeriod`'s checks — every other caller passes real `| null` values
  // that were never in doubt.
  const period = formatPeriod(properties.not_before ?? null, properties.not_after ?? null, t)
  if (period && period !== t('periodFormat.undated')) lines.push(escapeHtmlForPopup(period))

  const href = escapeHtmlForPopup(`/inscriptions/${properties.edh_id}`)
  lines.push(`<a href="${href}">${t('epigraphy.popup.open')} ↗</a>`)

  return lines.join('<br>')
}

/**
 * Mirrored EDH inscriptions, drawn as an overlay above whichever basemap is
 * showing — the same "a fact about the world, not a reading of one sheet"
 * reasoning `usePortOverlay` already gives. Unlike ports, an inscription
 * *does* have its own detail page (`/inscriptions/:edhId`), but the popup
 * still stays a plain MapLibre `Popup` rather than opening the site/tracing
 * selection panel: this is reference material with no revision history or
 * moderation state, so it has nothing in common with what that panel shows,
 * only a link out to its own page.
 */
export const useInscriptionsOverlay = () => {
  const { isShowingInscriptions, inscriptionTilesUrl } = useBasemapStyle()
  const { t } = useI18n()
  const { openOverlayPopup } = useOverlayPopup()

  const showInscriptionPopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (feature?.geometry.type !== 'Point') return

    const properties = feature.properties as InscriptionFeatureProperties

    const popup = openOverlayPopup({
      map,
      position: feature.geometry.coordinates as [number, number],
      html: buildInscriptionPopupHtml(properties, t),
      maxWidth: '260px',
    })

    // `Popup.setHTML` is raw markup, not a Vue template — its own "Open
    // inscription" link is a plain `<a>` with no router interception. Left
    // alone, following it hard-navigates the whole document, which throws
    // away every overlay toggle (`useState` lives on the Nuxt app instance,
    // gone the moment the page reloads) — reported live as "the overlays
    // are deactivated" after opening an inscription and coming back.
    // Intercepted the same way a `<NuxtLink>` already handles this, so it's
    // an ordinary client-side route change instead.
    popup
      .getElement()
      ?.querySelector('a')
      ?.addEventListener('click', (clickEvent) => {
        clickEvent.preventDefault()
        navigateTo(`/inscriptions/${properties.edh_id}`)
      })
  }

  const attachInscriptionsOverlay = (map: MapLibreMap): void => {
    if (!isShowingInscriptions.value) return
    if (map.getSource(INSCRIPTION_SOURCE_ID)) return

    map.addSource(INSCRIPTION_SOURCE_ID, {
      type: 'vector',
      tiles: [`${inscriptionTilesUrl.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: INSCRIPTION_ATTRIBUTION,
    })

    map.addLayer(buildInscriptionLayer())
    // See `useLimesOverlay`'s `attachLimesOverlay` for why this call is needed.
    map.triggerRepaint()

    bindOverlayListenersOnce(map, INSCRIPTION_LAYER_ID, () => {
      map.on('click', INSCRIPTION_LAYER_ID, (event) => showInscriptionPopup(map, event))
      map.on('mouseenter', INSCRIPTION_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', INSCRIPTION_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    })
  }

  const detachInscriptionsOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(INSCRIPTION_LAYER_ID)) map.removeLayer(INSCRIPTION_LAYER_ID)
    if (map.getSource(INSCRIPTION_SOURCE_ID)) map.removeSource(INSCRIPTION_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepInscriptionsOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isShowingInscriptions.value && !map.getSource(INSCRIPTION_SOURCE_ID)) {
        attachInscriptionsOverlay(map)
      }
    })
  }

  return {
    isActive: isShowingInscriptions,
    attachInscriptionsOverlay,
    detachInscriptionsOverlay,
    keepInscriptionsOverlayThroughStyleChanges,
  }
}
