import type { Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import { escapeHtmlForPopup } from './useBattleOverlay'
import { registerClickableOverlayLayer } from './useMapInstance'
import type { FrontierTranslate } from '../limes/useLimes'
import { formatFrontierYears } from '../limes/useLimes'

/**
 * Both read the same `atlas` source's `places` layer and carry the identical
 * property shape — `limes-installations` is just the military subset of
 * `atlas-places`, promoted to its own layer with the frontier's own plan
 * marks while "Follow the limes" is on (`useBasemapStyle.ts`). Without both
 * layer ids here, switching the frontier on would silently make every fort
 * and watchtower on it stop responding to a tap, while every mark drawn the
 * same pencil-and-no-disc way elsewhere on the sheet kept working — the
 * inconsistency this composable exists to close.
 */
export const ATLAS_PLACE_LAYER_IDS = ['atlas-places', 'limes-installations'] as const

const DESCRIPTION_LIMIT = 280

export interface AtlasPlaceProperties {
  title: string
  category: string | null
  description: string | null
  feature_types: string | null
  min_year: number | null
  max_year: number | null
  location_precision: string | null
  pleiades_id: string
}

const truncateDescription = (description: string): string =>
  description.length > DESCRIPTION_LIMIT
    ? `${description.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
    : description

export const buildAtlasPlacePopupHtml = (
  properties: AtlasPlaceProperties,
  t: FrontierTranslate,
): string => {
  const lines = [`<strong>${escapeHtmlForPopup(properties.title)}</strong>`]

  if (properties.category) lines.push(escapeHtmlForPopup(t(`categories.${properties.category}`)))
  else if (properties.feature_types) lines.push(escapeHtmlForPopup(properties.feature_types))

  const years = formatFrontierYears({ from: properties.min_year, to: properties.max_year, t })
  if (years) lines.push(escapeHtmlForPopup(years))

  if (properties.description) {
    lines.push(escapeHtmlForPopup(truncateDescription(properties.description)))
  }

  if (properties.location_precision === 'rough') {
    lines.push(escapeHtmlForPopup(t('atlasPlacePopup.locationApproximate')))
  }

  const href = escapeHtmlForPopup(`https://pleiades.stoa.org/places/${properties.pleiades_id}`)
  const label = t('atlasPlacePopup.viewOnPleiades')
  lines.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`)

  return lines.join('<br>')
}

/**
 * Click-to-info for the Barrington sheet's own places (`atlas-places` and its
 * military subset `limes-installations`, both `useBasemapStyle.ts`) —
 * Pleiades' ~38,000 places, drawn as the sheet's annotation rather than
 * through an "overlay" toggle, so unlike `useBattleOverlay`/`usePortOverlay`
 * there is no source/layer to attach or detach here. Both layers exist only
 * while the Barrington view is active, and MapLibre's delegated
 * `on(type, layerId, listener)` filters by `getLayer(layerId)` at event time
 * rather than at registration time — confirmed by reading `maplibre-gl`'s own
 * `_createDelegatedListener` — so registering this once, whenever the map is
 * created, is enough: it quietly does nothing on every other basemap and
 * fires again the moment the reader switches back to Barrington, with no
 * `styledata` bookkeeping needed.
 *
 * Not wired into `useSiteQuery`'s `MapFeatureCandidate` machinery, the same
 * reasoning `useBattleOverlay` already gives — these rows have no slug and
 * no detail panel, only a Pleiades id.
 */
export const useAtlasPlaceOverlay = () => {
  const { t } = useI18n()
  const { openOverlayPopup } = useOverlayPopup()

  const showAtlasPlacePopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (feature?.geometry.type !== 'Point') return

    openOverlayPopup({
      map,
      position: feature.geometry.coordinates as [number, number],
      html: buildAtlasPlacePopupHtml(feature.properties as AtlasPlaceProperties, t),
      maxWidth: '280px',
    })
  }

  const attachAtlasPlaceOverlay = (map: MapLibreMap): void => {
    for (const layerId of ATLAS_PLACE_LAYER_IDS) {
      registerClickableOverlayLayer(layerId)
      map.on('click', layerId, (event) => showAtlasPlacePopup(map, event))
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
      })
    }
  }

  return { attachAtlasPlaceOverlay }
}
