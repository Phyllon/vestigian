import { Popup } from 'maplibre-gl'
import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import { escapeHtmlForPopup } from './useBattleOverlay'
import { type MinorFeatureKind, minorFeatureIconId } from './useSiteIcons'

export const FEATURE_SOURCE_ID = 'features'
export const FEATURE_LAYER_ID = 'vestigian-features'

const FEATURE_KINDS: MinorFeatureKind[] = [
  'bridge',
  'mine_quarry',
  'dam',
  'cemetery',
  'fort',
  'tumulus',
]

const buildFeatureIconExpression = (): ExpressionSpecification =>
  [
    'match',
    ['get', 'kind'],
    ...FEATURE_KINDS.flatMap((kind) => [kind, minorFeatureIconId(kind)]),
    minorFeatureIconId('bridge'),
    // A spread cannot satisfy the tuple shape `match` is typed with, though the
    // value it produces is exactly that shape.
  ] as unknown as ExpressionSpecification

export const buildFeatureLayer = (): SymbolLayerSpecification => ({
  id: FEATURE_LAYER_ID,
  type: 'symbol',
  source: FEATURE_SOURCE_ID,
  'source-layer': 'features',
  layout: {
    'icon-image': buildFeatureIconExpression(),
    'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1, 14, 1.2],
    'icon-allow-overlap': true,
  },
})

export interface FeatureProperties {
  kind: MinorFeatureKind
  name: string | null
  source: string | null
  material: string | null
  periods: string | null
}

export interface FeaturePopupTranslate {
  (key: `minorFeaturePopup.kind.${MinorFeatureKind}`): string
}

export const buildFeaturePopupHtml = (
  properties: FeatureProperties,
  t: FeaturePopupTranslate,
): string => {
  const kindLabel = escapeHtmlForPopup(t(`minorFeaturePopup.kind.${properties.kind}`))
  const lines = [
    `<strong>${properties.name ? escapeHtmlForPopup(properties.name) : kindLabel}</strong>`,
  ]

  if (properties.name) lines.push(kindLabel)
  if (properties.material) lines.push(escapeHtmlForPopup(properties.material))
  if (properties.periods) lines.push(escapeHtmlForPopup(properties.periods))
  if (properties.source) lines.push(escapeHtmlForPopup(properties.source))

  return lines.join('<br>')
}

/**
 * AWMC's minor point features, drawn as an overlay above whichever
 * basemap is showing — the same "a fact about the world, not a reading
 * of one sheet" reasoning `useBattleOverlay`/`usePortOverlay` already
 * give. Not wired into the site/tracing selection machinery for the same
 * reason: none of these rows has a slug or detail panel, so a plain
 * MapLibre `Popup` bound directly to this layer's own click event is the
 * smaller, self-contained answer.
 */
export const useMinorFeatureOverlay = () => {
  const { isShowingFeatures, featureTilesUrl } = useBasemapStyle()
  const { t } = useI18n()

  const showFeaturePopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (feature?.geometry.type !== 'Point') return

    new Popup({ closeButton: true, maxWidth: '240px' })
      .setLngLat(feature.geometry.coordinates as [number, number])
      .setHTML(buildFeaturePopupHtml(feature.properties as FeatureProperties, t))
      .addTo(map)
  }

  const attachFeatureOverlay = (map: MapLibreMap): void => {
    if (!isShowingFeatures.value) return
    if (map.getSource(FEATURE_SOURCE_ID)) return

    map.addSource(FEATURE_SOURCE_ID, {
      type: 'vector',
      tiles: [`${featureTilesUrl.value}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
    })

    map.addLayer(buildFeatureLayer())

    map.on('click', FEATURE_LAYER_ID, (event) => showFeaturePopup(map, event))
    map.on('mouseenter', FEATURE_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', FEATURE_LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
    })
  }

  const detachFeatureOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(FEATURE_LAYER_ID)) map.removeLayer(FEATURE_LAYER_ID)
    if (map.getSource(FEATURE_SOURCE_ID)) map.removeSource(FEATURE_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — same arrangement as every other overlay here. */
  const keepFeatureOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (isShowingFeatures.value && !map.getSource(FEATURE_SOURCE_ID)) attachFeatureOverlay(map)
    })
  }

  return {
    isActive: isShowingFeatures,
    attachFeatureOverlay,
    detachFeatureOverlay,
    keepFeatureOverlayThroughStyleChanges,
  }
}
