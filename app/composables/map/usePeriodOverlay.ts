import type { Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import {
  EMPIRE_EXTENT_ATTRIBUTION,
  POLITY_ATTRIBUTION,
  POLITY_SOURCE_ID,
  buildPeriodExtentLayers,
  buildPolityLayers,
  resolvePeriodExtentColours,
  resolvePolityColours,
} from './useBasemapStyle'
import { escapeHtmlForPopup } from './useBattleOverlay'
import { bindOverlayListenersOnce } from './useMapInstance'
import { formatPeriod } from '../data/useSiteQuery'

export const PERIOD_SOURCE_ID = 'atlas-period'

const PERIOD_LAYER_IDS = buildPeriodExtentLayers().map((layer) => layer.id)
const POLITY_LAYER_IDS = buildPolityLayers().map((layer) => layer.id)
const POLITY_LABEL_LAYER_ID = 'atlas-polity-label'

export interface PolityFeatureProperties {
  name: string
  from_year: number
  to_year: number
  wikidata_id: string | null
  wikipedia_title: string | null
}

export type PolityPopupTranslate = (key: string, named?: Record<string, unknown>) => string

/**
 * `wikidata_id` is validated as `Q` plus digits at import time and the Wikipedia
 * title is a page phrase, never a URL: both are interpolated into links built
 * here, so neither is trusted as a ready-made href.
 */
export const buildPolityPopupHtml = (
  properties: PolityFeatureProperties,
  t: PolityPopupTranslate,
): string => {
  const lines = [
    `<strong>${escapeHtmlForPopup(properties.name)}</strong>`,
    escapeHtmlForPopup(
      t('polityPopup.outline', {
        period: formatPeriod(properties.from_year, properties.to_year, t),
      }),
    ),
    escapeHtmlForPopup(t('polityPopup.caveat')),
  ]

  const links: string[] = []
  const title = properties.wikipedia_title?.trim()
  if (title) {
    const href = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`
    links.push(
      `<a href="${escapeHtmlForPopup(href)}" target="_blank" rel="noopener noreferrer">${t('polityPopup.viewOnWikipedia')} ↗</a>`,
    )
  }
  if (properties.wikidata_id && /^Q\d+$/.test(properties.wikidata_id)) {
    const href = `https://www.wikidata.org/wiki/${properties.wikidata_id}`
    links.push(
      `<a href="${escapeHtmlForPopup(href)}" target="_blank" rel="noopener noreferrer">${t('polityPopup.viewOnWikidata')} ↗</a>`,
    )
  }
  if (links.length > 0) lines.push(links.join(' · '))

  return lines.join('<br>')
}

/**
 * The empire's extent at a chosen date, drawn as an overlay above whichever
 * basemap is showing — the same "a fact independent of one sheet" reasoning
 * `useLimesOverlay` already gives for the frontier. It used to be baked into
 * `buildAtlasStyle`, shown only while the Barrington sheet was active; see
 * `buildPeriodExtentLayers`'s own docstring for why that changed.
 *
 * Unlike every other overlay here, the source's own URL changes with
 * `periodYear` — the year is baked into the tile path, not a query param
 * (`/api/tiles/antiquity-empire/:year/...`). `attachPeriodOverlay` is
 * therefore not idempotent across a year change the way `attachLimesOverlay`
 * is across an unchanging source: the caller (`MapCanvas`'s watcher on
 * `periodYear`) detaches before re-attaching whenever the year itself moves,
 * not only when the scrubber switches between "off" and "on".
 *
 * **The neighbours ride along.** While the scrubber is on, Rome's rivals and
 * neighbours (`antiquity_polities`, Cliopatria) are drawn beneath the Roman
 * extent from a second source keyed to the same year — see
 * `buildPolityLayers` — and can be switched off on their own
 * (`isShowingPolities`) without touching the extent. Their source is added
 * *with* the period source and removed with it, so a year change rebuilds both.
 *
 * The fill's own colour also depends on `view` — `resolvePeriodExtentColours`
 * is read fresh on every attach, so switching basemaps while the scrubber is
 * on picks up the right palette for free: a basemap switch rebuilds
 * `currentStyle` and calls `setStyle`, which wipes this overlay's source the
 * same as every other one, and `keepPeriodOverlayThroughStyleChanges`'s own
 * `styledata` handler then calls this function again.
 */
export const usePeriodOverlay = () => {
  const { periodYear, empireExtentTilesUrl, polityTilesUrl, isShowingPolities, view, isDark } =
    useBasemapStyle()
  const { t } = useI18n()
  const { openOverlayPopup } = useOverlayPopup()

  const isActive = computed(() => periodYear.value !== null)

  const showPolityPopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (!feature) return

    // An area, not an icon: nothing to ring.
    openOverlayPopup({
      map,
      position: [event.lngLat.lng, event.lngLat.lat],
      html: buildPolityPopupHtml(feature.properties as PolityFeatureProperties, t),
      maxWidth: '260px',
      withRing: false,
    })
  }

  /**
   * Added after the extent layers exist so each neighbour layer can be inserted
   * *before* the Roman fill: Rome draws over anything it overlaps. Only the
   * label layer takes clicks — the fill covers half the map, and a popup on it
   * would fire under every click meant for a site marker.
   */
  const attachPolities = (map: MapLibreMap): void => {
    if (periodYear.value === null || !isShowingPolities.value) return
    if (map.getSource(POLITY_SOURCE_ID)) return

    map.addSource(POLITY_SOURCE_ID, {
      type: 'vector',
      tiles: [`${polityTilesUrl.value}/${periodYear.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: POLITY_ATTRIBUTION,
    })

    const beforeId = map.getLayer(PERIOD_LAYER_IDS[0]!) ? PERIOD_LAYER_IDS[0] : undefined
    for (const layer of buildPolityLayers(resolvePolityColours(view.value, isDark.value))) {
      map.addLayer(layer, beforeId)
    }

    bindOverlayListenersOnce(map, POLITY_LABEL_LAYER_ID, () => {
      map.on('click', POLITY_LABEL_LAYER_ID, (event) => showPolityPopup(map, event))
      map.on('mouseenter', POLITY_LABEL_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', POLITY_LABEL_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    })
  }

  const detachPolities = (map: MapLibreMap): void => {
    for (const id of POLITY_LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(POLITY_SOURCE_ID)) map.removeSource(POLITY_SOURCE_ID)
  }

  /** The neighbours' own switch: no change to the extent, only to what sits under it. */
  const syncPolities = (map: MapLibreMap): void => {
    if (isActive.value && isShowingPolities.value) attachPolities(map)
    else detachPolities(map)
  }

  const attachPeriodOverlay = (map: MapLibreMap): void => {
    if (periodYear.value === null) return
    if (map.getSource(PERIOD_SOURCE_ID)) return

    map.addSource(PERIOD_SOURCE_ID, {
      type: 'vector',
      tiles: [`${empireExtentTilesUrl.value}/${periodYear.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: EMPIRE_EXTENT_ATTRIBUTION,
    })

    const colours = resolvePeriodExtentColours(view.value, isDark.value)
    for (const layer of buildPeriodExtentLayers(colours)) map.addLayer(layer)

    attachPolities(map)

    // See `useLimesOverlay`'s `attachLimesOverlay` for why this is needed —
    // MapLibre does not reliably schedule a repaint on its own when a layer
    // is added while the map is otherwise idle.
    map.triggerRepaint()
  }

  const detachPeriodOverlay = (map: MapLibreMap): void => {
    detachPolities(map)
    for (const id of PERIOD_LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(PERIOD_SOURCE_ID)) map.removeSource(PERIOD_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepPeriodOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isActive.value && !map.getSource(PERIOD_SOURCE_ID)) attachPeriodOverlay(map)
    })
  }

  return {
    isActive,
    attachPeriodOverlay,
    detachPeriodOverlay,
    syncPolities,
    keepPeriodOverlayThroughStyleChanges,
  }
}
