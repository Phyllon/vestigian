import type { Map as MapLibreMap, MapGeoJSONFeature, MapLayerMouseEvent } from 'maplibre-gl'
import { escapeHtmlForPopup } from './popupHtml'
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

/** The sheet's own vector source and the layer inside it that carries the places. */
const ATLAS_SOURCE_ID = 'atlas'
const ATLAS_PLACES_SOURCE_LAYER = 'places'

/**
 * How many `idle` events `revealAtlasPlace` waits through for the place's tile
 * to arrive before giving up. A basemap switch plus a camera flight settles in
 * two or three; the cap only stops a place nobody ever receives from listening
 * for the rest of the session.
 */
const REVEAL_IDLE_ATTEMPTS = 6

export interface RevealAtlasPlaceRequest {
  /** `antiquity_places.id` — the feature id every place carries in the tile. */
  id: number
  position: { lon: number; lat: number }
}

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

  const openAtlasPlacePopup = (map: MapLibreMap, feature: MapGeoJSONFeature): void => {
    if (feature.geometry.type !== 'Point') return

    openOverlayPopup({
      map,
      position: feature.geometry.coordinates as [number, number],
      html: buildAtlasPlacePopupHtml(feature.properties as AtlasPlaceProperties, t),
      maxWidth: '280px',
      spot: { sourceId: 'pleiades' },
    })
  }

  const showAtlasPlacePopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (feature) openAtlasPlacePopup(map, feature)
  }

  /**
   * Opens a place's info box without a tap — for a search result, which has
   * only a name and a point and would otherwise leave the reader looking at an
   * unmarked spot. The place is read from the tiles already loaded
   * (`querySourceFeatures`, not `queryRenderedFeatures`: a label crowded out by
   * collision is still in the tile, and it is the tile's properties the popup
   * needs, not whether the name happens to be drawn).
   *
   * The tile is not there yet when this is called — the camera is still flying
   * and the basemap may be swapping to the sheet that owns this source — so it
   * tries again on each `idle`, which fires only once the map has stopped
   * moving and loading.
   */
  const revealAtlasPlace = (map: MapLibreMap, request: RevealAtlasPlaceRequest): void => {
    let attemptsLeft = REVEAL_IDLE_ATTEMPTS

    const tryOpen = (): void => {
      const feature = map.getSource(ATLAS_SOURCE_ID)
        ? map.querySourceFeatures(ATLAS_SOURCE_ID, {
            sourceLayer: ATLAS_PLACES_SOURCE_LAYER,
            filter: ['==', ['id'], request.id],
          })[0]
        : undefined

      if (feature) {
        openAtlasPlacePopup(map, feature)
        return
      }
      attemptsLeft -= 1
      if (attemptsLeft > 0) map.once('idle', tryOpen)
    }

    map.once('idle', tryOpen)
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

  return { attachAtlasPlaceOverlay, revealAtlasPlace }
}
