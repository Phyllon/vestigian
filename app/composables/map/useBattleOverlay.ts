import { Popup } from 'maplibre-gl'
import type { Map as MapLibreMap, MapLayerMouseEvent, SymbolLayerSpecification } from 'maplibre-gl'
import type { FrontierTranslate } from '../limes/useLimes'
import { formatYear } from '../limes/useLimes'
import { BATTLE_ATTRIBUTION } from './useBasemapStyle'
import { BATTLE_ICON_ID } from './useSiteIcons'

export const BATTLE_SOURCE_ID = 'battles'
export const BATTLE_LAYER_ID = 'vestigian-battles'

export interface BattleFeatureProperties {
  title: string
  year: number
  wikipedia_url: string | null
}

/** One symbol layer, no `match` expression needed — there is only one mark. */
export const buildBattleLayer = (): SymbolLayerSpecification => ({
  id: BATTLE_LAYER_ID,
  type: 'symbol',
  source: BATTLE_SOURCE_ID,
  'source-layer': 'battles',
  layout: {
    'icon-image': BATTLE_ICON_ID,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1, 14, 1.2],
    'icon-allow-overlap': true,
  },
})

/**
 * `Popup.setHTML` renders raw markup, unlike every Vue template in this app
 * — the one place here that needs its own escaping rather than relying on
 * `{{ }}`. A battle's title comes from Wikidata, not user input, but
 * nothing here is worth relying on that for.
 */
export const escapeHtmlForPopup = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.codePointAt(0)};`)

export const buildBattlePopupHtml = (
  properties: BattleFeatureProperties,
  t: FrontierTranslate,
): string => {
  const year = formatYear(properties.year, t)
  const lines = [
    `<strong>${escapeHtmlForPopup(properties.title)}</strong>`,
    escapeHtmlForPopup(year),
  ]

  if (properties.wikipedia_url) {
    const href = escapeHtmlForPopup(properties.wikipedia_url)
    const label = t('battlePopup.viewOnWikipedia')
    lines.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`)
  }

  return lines.join('<br>')
}

/**
 * Ancient battles, drawn as an overlay above whichever basemap is showing —
 * the same "a fact about the world, not a reading of one sheet" reasoning
 * `useLimesOverlay` already gives for the frontier.
 *
 * Not wired into the site/tracing selection machinery
 * (`useSiteQuery`'s `MapFeatureCandidate`, `chooseCandidate`): that union
 * expects a `sites`/`tracings` row with a slug and a detail panel, and a
 * battle has neither. A plain MapLibre `Popup` bound directly to this
 * layer's own click event is a smaller, self-contained answer — the same
 * "borrowed reference, nothing to open" precedent as the column-reliefs
 * plates and the period-extent fill.
 */
export const useBattleOverlay = () => {
  const { isShowingBattles, battleTilesUrl } = useBasemapStyle()
  const { t } = useI18n()

  const showBattlePopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (feature?.geometry.type !== 'Point') return

    new Popup({ closeButton: true, maxWidth: '240px' })
      .setLngLat(feature.geometry.coordinates as [number, number])
      .setHTML(buildBattlePopupHtml(feature.properties as BattleFeatureProperties, t))
      .addTo(map)
  }

  const attachBattleOverlay = (map: MapLibreMap): void => {
    if (!isShowingBattles.value) return
    if (map.getSource(BATTLE_SOURCE_ID)) return

    map.addSource(BATTLE_SOURCE_ID, {
      type: 'vector',
      tiles: [`${battleTilesUrl.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: BATTLE_ATTRIBUTION,
    })

    map.addLayer(buildBattleLayer())
    // See `useLimesOverlay`'s `attachLimesOverlay` for why this is needed —
    // MapLibre does not reliably schedule a repaint on its own when a layer
    // is added while the map is otherwise idle.
    map.triggerRepaint()

    map.on('click', BATTLE_LAYER_ID, (event) => showBattlePopup(map, event))
    map.on('mouseenter', BATTLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', BATTLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
    })
  }

  const detachBattleOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(BATTLE_LAYER_ID)) map.removeLayer(BATTLE_LAYER_ID)
    if (map.getSource(BATTLE_SOURCE_ID)) map.removeSource(BATTLE_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepBattleOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isShowingBattles.value && !map.getSource(BATTLE_SOURCE_ID)) attachBattleOverlay(map)
    })
  }

  return {
    isActive: isShowingBattles,
    attachBattleOverlay,
    detachBattleOverlay,
    keepBattleOverlayThroughStyleChanges,
  }
}
