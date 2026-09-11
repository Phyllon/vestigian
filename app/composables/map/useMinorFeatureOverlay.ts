import { Popup } from 'maplibre-gl'
import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import { MINOR_FEATURE_ATTRIBUTION } from './useBasemapStyle'
import { escapeHtmlForPopup } from './useBattleOverlay'
import { bindOverlayListenersOnce } from './useMapInstance'
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

/**
 * AWMC's `mines_quarries` layer records commodity/material as chemical or
 * geological shorthand rather than a word — confirmed against the real DBF
 * values (`Fe`, `Pb`, `Ag`, `Au`, `Cu`, `Zn`, `M`, `Ls`, `Ss`, `Gr`), not
 * documented anywhere in AWMC's own release, which ships no metadata file for
 * this layer. A code this list doesn't recognise (e.g. the single `Cn` row)
 * is shown verbatim rather than guessed at. Multi-commodity rows are
 * comma-separated in the source (`"Au, Fe"`) and decoded term by term.
 */
const MATERIAL_LABELS: Record<string, string> = {
  fe: 'Iron',
  cu: 'Copper',
  pb: 'Lead',
  ag: 'Silver',
  au: 'Gold',
  zn: 'Zinc',
  m: 'Marble',
  ls: 'Limestone',
  ss: 'Sandstone',
  gr: 'Granite',
}

const expandMaterial = (material: string): string =>
  material
    .split(',')
    .map((code) => {
      const trimmed = code.trim()
      return MATERIAL_LABELS[trimmed.toLowerCase()] ?? trimmed
    })
    .join(', ')

/**
 * Every AWMC minor-feature layer except bridges records period attestation
 * as a run of single-letter codes — `A`(rchaic) `C`(lassical) `H`(ellenistic)
 * `R`(oman) `L`(ate Antique) — with a trailing `?` marking the *preceding*
 * letter uncertain (`"R?L"`, `"H?R?"`, `"C?H?R?"`, confirmed against real
 * rows across mines/quarries, dams, cemeteries and forts). Bridges use their
 * own five 0/1 flag columns, already expanded to full words by
 * `bridgePeriods()` at import time, so this decoder is skipped for that kind
 * — running it on an already-expanded string would find no matching letters
 * and just pass it through unchanged, but skipping is more honest about why.
 */
const PERIOD_LETTER_LABELS: Record<string, string> = {
  A: 'Archaic',
  C: 'Classical',
  H: 'Hellenistic',
  R: 'Roman',
  L: 'Late Antique',
}

const expandPeriods = (periods: string): string => {
  const labels: string[] = []
  for (let index = 0; index < periods.length; index += 1) {
    const letter = periods[index]
    const label = letter ? PERIOD_LETTER_LABELS[letter] : undefined
    if (!label) continue
    const isUncertain = periods[index + 1] === '?'
    if (isUncertain) index += 1
    labels.push(isUncertain ? `${label} (uncertain)` : label)
  }
  return labels.length > 0 ? labels.join(', ') : periods
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
  if (properties.material) lines.push(escapeHtmlForPopup(expandMaterial(properties.material)))
  if (properties.periods) {
    const periods =
      properties.kind === 'bridge' ? properties.periods : expandPeriods(properties.periods)
    lines.push(escapeHtmlForPopup(periods))
  }
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
      attribution: MINOR_FEATURE_ATTRIBUTION,
    })

    map.addLayer(buildFeatureLayer())
    // See `useLimesOverlay`'s `attachLimesOverlay` for why this call is needed.
    map.triggerRepaint()

    bindOverlayListenersOnce(map, FEATURE_LAYER_ID, () => {
      map.on('click', FEATURE_LAYER_ID, (event) => showFeaturePopup(map, event))
      map.on('mouseenter', FEATURE_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', FEATURE_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
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
