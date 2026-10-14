import type {
  ExpressionSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from 'maplibre-gl'
import type { SpotSourceId } from '#shared/types'
import {
  MONUMENT_KINDS,
  REFERENCE_OVERLAY_IDS,
  type MonumentKind,
  type ReferenceOverlayId,
} from '#shared/utils/reference-overlays'
import {
  HILLFORT_ATTRIBUTION,
  ISICILY_ATTRIBUTION,
  MAP_LABEL_FONT,
  MINT_ATTRIBUTION,
  MONUMENT_ATTRIBUTION,
  ROAD_AUDIT_ATTRIBUTION,
  ROMAN_ROAD_ATTRIBUTION,
} from './useBasemapStyle'
import { escapeHtmlForPopup } from './popupHtml'
import { bindOverlayListenersOnce } from './useMapInstance'
import {
  HILLFORT_ICON_ID,
  ISICILY_ICON_ID,
  MARKER_ICON_SIZE,
  MINT_ICON_ID,
  MONUMENT_ICON_ID,
  monumentIconId,
} from './useSiteIcons'
import { formatPeriod } from '../data/useSiteQuery'
import {
  ROAD_AUDIT_BUFFER_METRES,
  ROAD_AUDIT_GRADIENT_WINDOW_METRES,
  ROAD_AUDIT_STEEP_GRADIENT_PERCENT,
  ROAD_GAP_DISTANCE_METRES,
} from '#shared/utils/road-audit'

/**
 * The five reference overlays that share one tile endpoint — Itiner-e roads,
 * Nomisma mints, the Wikidata monuments, I.Sicily inscriptions and the Atlas of Hillforts. They differ in
 * their layers, their popup and little else, so they are described here as data and
 * attached by one function, rather than as four files that each repeat the
 * attach / detach / keep-through-style-changes arrangement `useCoinHoardOverlay`
 * and its siblings wrote out by hand.
 */

export type ReferencePopupTranslate = (
  key: string,
  named?: Record<string, unknown>,
  plural?: number,
) => string

export interface ReferenceOverlayDefinition {
  id: ReferenceOverlayId
  sourceId: string
  attribution: string
  /** The overlay's layers, bottom to top. */
  buildLayers: () => LayerSpecification[]
  /** The layers that open a popup on click. */
  clickableLayerIds: string[]
  buildPopupHtml: (properties: Record<string, unknown>, t: ReferencePopupTranslate) => string
  /** Where a popup's own link goes inside the app, so it navigates without a reload. */
  internalPath?: (properties: Record<string, unknown>) => string | null
  /**
   * True when another overlay's popup answers this click better — the road
   * audit's does, over the same line, and two popups would otherwise race.
   */
  isAnsweredElsewhere?: (map: MapLibreMap, event: MapLayerMouseEvent) => boolean
  /**
   * Whose records these are, for the "about this spot" block. Absent for a layer
   * whose features are lines (the roads): a line has no coordinate of its own.
   */
  spotSourceId?: SpotSourceId
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const link = (href: string, label: string): string =>
  `<a href="${escapeHtmlForPopup(href)}" target="_blank" rel="noopener noreferrer">${escapeHtmlForPopup(label)} ↗</a>`

// --- Itiner-e roads -----------------------------------------------------------

export const ROMAN_ROAD_SOURCE_ID = 'roman-roads'
export const ROMAN_ROAD_LAYER_IDS = {
  casing: 'vestigian-roman-roads-casing',
  certain: 'vestigian-roman-roads-certain',
  conjectured: 'vestigian-roman-roads-conjectured',
  hypothetical: 'vestigian-roman-roads-hypothetical',
} as const

/** Bronze, the brief's colour for linear features, with a paper casing so it reads over any sheet. */
const ROAD_INK = '#5d5237'
const ROAD_CASING = '#faf7ef'

const roadWidth = (main: number, secondary: number): ExpressionSpecification => [
  'case',
  ['==', ['get', 'is_main'], true],
  main,
  secondary,
]

const roadCertaintyFilter = (certainty: string): ExpressionSpecification => [
  '==',
  ['get', 'certainty'],
  certainty,
]

/**
 * One line layer per certainty because `line-dasharray` is not data-driven (see the
 * note on `LIMES_LINE_KINDS`): a surveyed road is solid, a conjectured one dashed
 * and a hypothetical one dotted, so a reader can tell the evidence from the model
 * without reading a legend. Widths are data-driven, main roads heavier.
 */
export const buildRomanRoadLayers = (): LayerSpecification[] => {
  const width = (main: number, secondary: number): ExpressionSpecification =>
    roadWidth(main, secondary)

  const line = (
    id: string,
    certainty: string,
    dashes: [number, number] | null,
  ): LayerSpecification => ({
    id,
    type: 'line',
    source: ROMAN_ROAD_SOURCE_ID,
    'source-layer': 'roman_roads',
    filter: roadCertaintyFilter(certainty),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ROAD_INK,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, width(0.7, 0.4), 10, width(2.6, 1.4)],
      ...(dashes ? { 'line-dasharray': dashes } : {}),
    },
  })

  return [
    {
      id: ROMAN_ROAD_LAYER_IDS.casing,
      type: 'line',
      source: ROMAN_ROAD_SOURCE_ID,
      'source-layer': 'roman_roads',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROAD_CASING,
        'line-opacity': 0.7,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          width(1.9, 1.3),
          10,
          width(4.4, 3.2),
        ],
      },
    },
    line(ROMAN_ROAD_LAYER_IDS.hypothetical, 'hypothetical', [1, 2]),
    line(ROMAN_ROAD_LAYER_IDS.conjectured, 'conjectured', [4, 2]),
    line(ROMAN_ROAD_LAYER_IDS.certain, 'certain', null),
  ]
}

export const buildRomanRoadPopupHtml = (
  properties: Record<string, unknown>,
  t: ReferencePopupTranslate,
): string => {
  const certainty = text(properties.certainty)
  const name = text(properties.name) || t('referencePopup.road.unnamed')
  const lines = [
    `<strong>${escapeHtmlForPopup(name)}</strong>`,
    escapeHtmlForPopup(
      properties.is_main === true
        ? t('referencePopup.road.main')
        : t('referencePopup.road.secondary'),
    ),
  ]

  if (certainty === 'certain' || certainty === 'conjectured' || certainty === 'hypothetical') {
    lines.push(escapeHtmlForPopup(t(`referencePopup.road.certainty.${certainty}`)))
  }
  const itinerary = text(properties.itinerary)
  if (itinerary) lines.push(escapeHtmlForPopup(itinerary))

  return lines.join('<br>')
}

// --- Nomisma mints ------------------------------------------------------------

export const MINT_SOURCE_ID = 'mints'
export const MINT_LAYER_ID = 'vestigian-mints'

export const buildMintLayers = (): LayerSpecification[] => [
  {
    id: MINT_LAYER_ID,
    type: 'symbol',
    source: MINT_SOURCE_ID,
    'source-layer': 'mints',
    layout: {
      'icon-image': MINT_ICON_ID,
      'icon-size': MARKER_ICON_SIZE,
      'icon-allow-overlap': true,
      'text-field': ['step', ['zoom'], '', 8, ['get', 'name']],
      'text-font': [MAP_LABEL_FONT],
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': '#35424b', 'text-halo-color': '#faf7ef', 'text-halo-width': 1.2 },
  },
]

const NOMISMA_ID_PATTERN = /^[A-Za-z0-9_\-.]+$/

export const buildMintPopupHtml = (
  properties: Record<string, unknown>,
  t: ReferencePopupTranslate,
): string => {
  const lines = [
    `<strong>${escapeHtmlForPopup(text(properties.name))}</strong>`,
    escapeHtmlForPopup(t('referencePopup.mint.kind')),
  ]

  const links: string[] = []
  const nomismaId = text(properties.nomisma_id)
  if (NOMISMA_ID_PATTERN.test(nomismaId)) {
    links.push(
      link(
        `https://nomisma.org/id/${encodeURIComponent(nomismaId)}`,
        t('referencePopup.mint.viewOnNomisma'),
      ),
    )
  }
  const pleiadesId = text(properties.pleiades_id)
  if (/^\d+$/.test(pleiadesId)) {
    links.push(
      link(`https://pleiades.stoa.org/places/${pleiadesId}`, t('referencePopup.viewOnPleiades')),
    )
  }
  if (links.length > 0) lines.push(links.join(' · '))

  return lines.join('<br>')
}

// --- Wikidata monuments -------------------------------------------------------

export const MONUMENT_SOURCE_ID = 'monuments'
export const MONUMENT_LAYER_ID = 'vestigian-monuments'

export { MONUMENT_KINDS, type MonumentKind }

/**
 * One mark per kind, so a theatre, a bath and a fort read as what they are without
 * opening the popup. A kind the map has no mark for yet falls back to the generic
 * pedimented front rather than drawing nothing.
 */
export const buildMonumentIconExpression = (): ExpressionSpecification =>
  [
    'match',
    ['get', 'kind'],
    ...MONUMENT_KINDS.flatMap((kind) => [kind, monumentIconId(kind)]),
    MONUMENT_ICON_ID,
  ] as unknown as ExpressionSpecification

export const buildMonumentLayers = (): LayerSpecification[] => [
  {
    id: MONUMENT_LAYER_ID,
    type: 'symbol',
    source: MONUMENT_SOURCE_ID,
    'source-layer': 'monuments',
    layout: {
      'icon-image': buildMonumentIconExpression(),
      'icon-size': MARKER_ICON_SIZE,
      'icon-allow-overlap': true,
      'text-field': ['step', ['zoom'], '', 9, ['get', 'name']],
      'text-font': [MAP_LABEL_FONT],
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': '#35424b', 'text-halo-color': '#faf7ef', 'text-halo-width': 1.2 },
  },
]

export const buildMonumentPopupHtml = (
  properties: Record<string, unknown>,
  t: ReferencePopupTranslate,
): string => {
  const kind = text(properties.kind)
  const lines = [`<strong>${escapeHtmlForPopup(text(properties.name))}</strong>`]

  if ((MONUMENT_KINDS as readonly string[]).includes(kind)) {
    lines.push(escapeHtmlForPopup(t(`referencePopup.monument.kind.${kind}`)))
  }
  const wikidataId = text(properties.wikidata_id)
  if (/^Q\d+$/.test(wikidataId)) {
    lines.push(
      link(`https://www.wikidata.org/wiki/${wikidataId}`, t('referencePopup.viewOnWikidata')),
    )
  }

  return lines.join('<br>')
}

// --- I.Sicily inscriptions ----------------------------------------------------

export const ISICILY_SOURCE_ID = 'isicily'
export const ISICILY_LAYER_ID = 'vestigian-isicily'

export const buildIsicilyLayers = (): LayerSpecification[] => [
  {
    id: ISICILY_LAYER_ID,
    type: 'symbol',
    source: ISICILY_SOURCE_ID,
    'source-layer': 'isicily',
    layout: {
      'icon-image': ISICILY_ICON_ID,
      'icon-size': MARKER_ICON_SIZE,
      'icon-allow-overlap': true,
    },
  },
]

/** The languages the catalogue has a word for; an unknown code is left out, not shown raw. */
export const ISICILY_LANGUAGES = ['grc', 'la', 'xly', 'scx', 'xpu', 'osc', 'he']

const ISICILY_ID_PATTERN = /^ISic\d{1,8}$/

export const isicilyPath = (properties: Record<string, unknown>): string | null => {
  const id = text(properties.isicily_id)
  return ISICILY_ID_PATTERN.test(id) ? `/inscriptions/sicily/${id}` : null
}

export const buildIsicilyPopupHtml = (
  properties: Record<string, unknown>,
  t: ReferencePopupTranslate,
): string => {
  const lines = [`<strong>${escapeHtmlForPopup(text(properties.title))}</strong>`]

  const language = text(properties.language)
  if (ISICILY_LANGUAGES.includes(language)) {
    lines.push(escapeHtmlForPopup(t(`isicilyInscriptions.languages.${language}`)))
  }

  // MVT turns a null property into an absent one, so `undefined` stands for "no
  // value" here — see the same normalisation in `buildInscriptionPopupHtml`.
  const period = formatPeriod(
    numberOrNull(properties.not_before),
    numberOrNull(properties.not_after),
    t,
  )
  if (period && period !== t('periodFormat.undated')) lines.push(escapeHtmlForPopup(period))

  const path = isicilyPath(properties)
  if (path) {
    lines.push(
      `<a href="${escapeHtmlForPopup(path)}">${escapeHtmlForPopup(t('epigraphy.popup.open'))} ↗</a>`,
    )
  }

  return lines.join('<br>')
}

// --- Atlas of Hillforts ---------------------------------------------------------

export const HILLFORT_SOURCE_ID = 'hillforts'
export const HILLFORT_LAYER_ID = 'vestigian-hillforts'

export const buildHillfortLayers = (): LayerSpecification[] => [
  {
    id: HILLFORT_LAYER_ID,
    type: 'symbol',
    source: HILLFORT_SOURCE_ID,
    'source-layer': 'hillforts',
    layout: {
      'icon-image': HILLFORT_ICON_ID,
      'icon-size': MARKER_ICON_SIZE,
      'icon-allow-overlap': true,
      'text-field': ['step', ['zoom'], '', 10, ['get', 'name']],
      'text-font': [MAP_LABEL_FONT],
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': '#35424b', 'text-halo-color': '#faf7ef', 'text-halo-width': 1.2 },
  },
]

/** The atlas's own type vocabulary — see `scripts/import/26-hillforts-atlas.ts`. */
export const HILLFORT_TYPES = [
  'contour',
  'partial-contour',
  'promontory',
  'hillslope',
  'level-terrain',
  'marsh',
  'multiple-enclosure',
] as const

/**
 * The span each dated-period key stands for, as `[from, to]` in traditional years (negative
 * for BCE, null for open-ended), so the popup formats it with `formatPeriod` like every other
 * date and needs no translated period names.
 */
export const HILLFORT_PERIOD_SPANS: Readonly<Record<string, [number | null, number | null]>> = {
  'pre-1200bc': [null, -1200],
  '1200-800bc': [-1200, -800],
  '800-400bc': [-800, -400],
  '400bc-ad50': [-400, 50],
  'ad50-400': [50, 400],
  'ad400-800': [400, 800],
  'post-ad800': [800, null],
}

const HILLFORT_COUNTRIES = [
  'england',
  'scotland',
  'wales',
  'northern-ireland',
  'republic-of-ireland',
  'isle-of-man',
]

const commaList = (value: unknown): string[] =>
  text(value)
    .split(',')
    .filter((part) => part.length > 0)

export const buildHillfortPopupHtml = (
  properties: Record<string, unknown>,
  t: ReferencePopupTranslate,
): string => {
  const lines = [`<strong>${escapeHtmlForPopup(text(properties.name))}</strong>`]

  const types = commaList(properties.types).filter((type) =>
    (HILLFORT_TYPES as readonly string[]).includes(type),
  )
  if (types.length > 0) {
    lines.push(
      escapeHtmlForPopup(types.map((type) => t(`referencePopup.hillfort.type.${type}`)).join(', ')),
    )
  }

  const country = text(properties.country).toLowerCase().replaceAll(' ', '-')
  if (HILLFORT_COUNTRIES.includes(country)) {
    lines.push(escapeHtmlForPopup(t(`referencePopup.hillfort.country.${country}`)))
  }

  // Only the doubtful cases are flagged: "confirmed" is the unremarkable majority (3,669 of 4,147).
  const reliability = text(properties.reliability)
  if (reliability === 'unconfirmed' || reliability === 'irreconciled') {
    lines.push(escapeHtmlForPopup(t(`referencePopup.hillfort.reliability.${reliability}`)))
  }

  const area = numberOrNull(properties.area_hectares)
  if (area !== null) {
    const hectares = area.toFixed(area < 10 ? 1 : 0)
    lines.push(escapeHtmlForPopup(t('referencePopup.hillfort.area', { hectares })))
  }
  const altitude = numberOrNull(properties.altitude_metres)
  if (altitude !== null) {
    lines.push(escapeHtmlForPopup(t('referencePopup.hillfort.altitude', { metres: altitude })))
  }

  const periods = commaList(properties.dated_periods).flatMap((key) => {
    const span = HILLFORT_PERIOD_SPANS[key]
    return span ? [formatPeriod(span[0], span[1], t)] : []
  })
  if (periods.length > 0) {
    lines.push(
      escapeHtmlForPopup(t('referencePopup.hillfort.dated', { periods: periods.join('; ') })),
    )
  }

  lines.push(link('https://doi.org/10.5284/1118744', t('referencePopup.hillfort.viewDataset')))

  return lines.join('<br>')
}

// --- The road audit -----------------------------------------------------------

export const ROAD_AUDIT_SOURCE_ID = 'road-audit'
export const ROAD_AUDIT_LAYER_IDS = {
  casing: 'vestigian-road-audit-casing',
  steep: 'vestigian-road-audit-steep',
  supported: 'vestigian-road-audit-supported',
  hit: 'vestigian-road-audit-hit',
  gaps: 'vestigian-road-audit-gaps',
} as const

/** Verdigris is this app's colour for a confirmed state; here, a road something stands beside. */
const AUDIT_SUPPORTED_INK = '#3d6b5c'
const AUDIT_STEEP_INK = '#2b2621'
const AUDIT_GAP_INK = '#5d5237'
const AUDIT_CASING = '#faf7ef'

/**
 * Three things drawn over Itiner-e's own lines, none of them a verdict:
 *
 * - a verdigris line where a milestone or road record stands within the buffer;
 * - a dark, dotted line where the steepest stretch passes the calibrated
 *   threshold — dotted rather than a colour of its own, because the supported
 *   colour must not be read as "good" and this as "bad";
 * - a bronze ring at each milestone far from every road.
 *
 * A wide, invisible line takes the click, because the drawn ones are 1.5–3 px.
 * The tile carries only the segments one of the first two applies to; the rest
 * are Itiner-e's own, drawn by `roman-roads`.
 */
export const buildRoadAuditLayers = (): LayerSpecification[] => {
  const width: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 3, 1.2, 10, 3]
  const casingWidth: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    3,
    2.6,
    10,
    5.2,
  ]

  return [
    {
      id: ROAD_AUDIT_LAYER_IDS.casing,
      type: 'line',
      source: ROAD_AUDIT_SOURCE_ID,
      'source-layer': 'audit_segments',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': AUDIT_CASING, 'line-opacity': 0.8, 'line-width': casingWidth },
    },
    {
      id: ROAD_AUDIT_LAYER_IDS.steep,
      type: 'line',
      source: ROAD_AUDIT_SOURCE_ID,
      'source-layer': 'audit_segments',
      filter: ['==', ['get', 'is_steep'], true],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': AUDIT_STEEP_INK,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 10, 4.6],
        'line-dasharray': [0.6, 1.6],
      },
    },
    {
      id: ROAD_AUDIT_LAYER_IDS.supported,
      type: 'line',
      source: ROAD_AUDIT_SOURCE_ID,
      'source-layer': 'audit_segments',
      filter: ['==', ['get', 'is_supported'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': AUDIT_SUPPORTED_INK, 'line-width': width },
    },
    {
      id: ROAD_AUDIT_LAYER_IDS.hit,
      type: 'line',
      source: ROAD_AUDIT_SOURCE_ID,
      'source-layer': 'audit_segments',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': AUDIT_SUPPORTED_INK, 'line-opacity': 0, 'line-width': 16 },
    },
    {
      id: ROAD_AUDIT_LAYER_IDS.gaps,
      type: 'circle',
      source: ROAD_AUDIT_SOURCE_ID,
      'source-layer': 'audit_gaps',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 6],
        'circle-color': AUDIT_CASING,
        'circle-opacity': 0.9,
        'circle-stroke-color': AUDIT_GAP_INK,
        'circle-stroke-width': 2,
      },
    },
  ]
}

const EDH_ID_PATTERN = /^HD\d{1,8}$/
const SITE_SLUG_PATTERN = /^[\w.-]{1,160}$/

/** Where a gap's own link goes inside the app; a segment has none. */
export const roadAuditPath = (properties: Record<string, unknown>): string | null => {
  const key = text(properties.source_key)
  if (text(properties.source) === 'edh' && EDH_ID_PATTERN.test(key)) return `/inscriptions/${key}`
  if (text(properties.source) === 'vici' && SITE_SLUG_PATTERN.test(key)) {
    return `/site/${encodeURIComponent(key)}`
  }
  return null
}

const countOf = (value: unknown): number => numberOrNull(value) ?? 0

const buildRoadAuditSegmentHtml = (
  properties: Record<string, unknown>,
  t: ReferencePopupTranslate,
): string => {
  const certainty = text(properties.certainty)
  const name = text(properties.name) || t('referencePopup.road.unnamed')
  const lines = [`<strong>${escapeHtmlForPopup(name)}</strong>`]

  if (certainty === 'conjectured' || certainty === 'hypothetical') {
    lines.push(escapeHtmlForPopup(t(`referencePopup.road.certainty.${certainty}`)))
  }

  const edh = countOf(properties.edh_milestones)
  const vici = countOf(properties.vici_milestones)
  const sites = countOf(properties.vici_road_sites)
  const near: string[] = []
  if (edh > 0) near.push(t('roadAudit.edhMilestones', { n: edh }, edh))
  if (vici > 0) near.push(t('roadAudit.viciMilestones', { n: vici }, vici))
  if (sites > 0) near.push(t('roadAudit.viciRoadSites', { n: sites }, sites))

  if (near.length > 0) {
    lines.push(
      escapeHtmlForPopup(
        t('roadAudit.within', { metres: ROAD_AUDIT_BUFFER_METRES, list: near.join(' · ') }),
      ),
    )
  } else {
    lines.push(escapeHtmlForPopup(t('roadAudit.nothingNear', { metres: ROAD_AUDIT_BUFFER_METRES })))
  }

  const ends = countOf(properties.certain_ends)
  if (ends > 0) lines.push(escapeHtmlForPopup(t('roadAudit.certainEnds', { n: ends }, ends)))

  const gradient = numberOrNull(properties.steepest_gradient_percent)
  if (gradient !== null) {
    lines.push(
      escapeHtmlForPopup(
        t('roadAudit.gradient', {
          percent: gradient.toFixed(1),
          metres: ROAD_AUDIT_GRADIENT_WINDOW_METRES,
        }),
      ),
    )
    if (properties.is_steep === true) {
      lines.push(
        escapeHtmlForPopup(
          t('roadAudit.steep', {
            percent: ROAD_AUDIT_STEEP_GRADIENT_PERCENT,
          }),
        ),
      )
    }
  }

  lines.push(`<em>${escapeHtmlForPopup(t('roadAudit.caveat'))}</em>`)
  return lines.join('<br>')
}

const buildRoadAuditGapHtml = (
  properties: Record<string, unknown>,
  t: ReferencePopupTranslate,
): string => {
  const lines = [`<strong>${escapeHtmlForPopup(text(properties.title))}</strong>`]
  const source = text(properties.source) === 'edh' ? 'edh' : 'vici'
  lines.push(escapeHtmlForPopup(t(`roadAudit.gapSource.${source}`)))

  const metres = numberOrNull(properties.nearest_road_metres)
  if (metres === null) {
    lines.push(escapeHtmlForPopup(t('roadAudit.gapNoRoad')))
  } else {
    lines.push(
      escapeHtmlForPopup(t('roadAudit.gapNearest', { kilometres: (metres / 1000).toFixed(1) })),
    )
  }

  const path = roadAuditPath(properties)
  if (path) {
    lines.push(
      `<a href="${escapeHtmlForPopup(path)}">${escapeHtmlForPopup(t('roadAudit.gapOpen'))} →</a>`,
    )
  }
  lines.push(
    `<em>${escapeHtmlForPopup(t('roadAudit.gapCaveat', { metres: ROAD_GAP_DISTANCE_METRES }))}</em>`,
  )
  return lines.join('<br>')
}

/** A gap carries `source`; a segment never does — that is the whole difference between the two. */
export const buildRoadAuditPopupHtml = (
  properties: Record<string, unknown>,
  t: ReferencePopupTranslate,
): string =>
  text(properties.source).length > 0
    ? buildRoadAuditGapHtml(properties, t)
    : buildRoadAuditSegmentHtml(properties, t)

// --- the definitions ----------------------------------------------------------

export const REFERENCE_OVERLAY_DEFINITIONS: Record<ReferenceOverlayId, ReferenceOverlayDefinition> =
  {
    'roman-roads': {
      id: 'roman-roads',
      sourceId: ROMAN_ROAD_SOURCE_ID,
      attribution: ROMAN_ROAD_ATTRIBUTION,
      buildLayers: buildRomanRoadLayers,
      clickableLayerIds: [
        ROMAN_ROAD_LAYER_IDS.certain,
        ROMAN_ROAD_LAYER_IDS.conjectured,
        ROMAN_ROAD_LAYER_IDS.hypothetical,
      ],
      buildPopupHtml: buildRomanRoadPopupHtml,
      // The audit's popup is the road's own record plus what stands beside it.
      isAnsweredElsewhere: (map, event) =>
        map.getLayer(ROAD_AUDIT_LAYER_IDS.hit) !== undefined &&
        map.queryRenderedFeatures(event.point, { layers: [ROAD_AUDIT_LAYER_IDS.hit] }).length > 0,
    },
    mints: {
      id: 'mints',
      sourceId: MINT_SOURCE_ID,
      attribution: MINT_ATTRIBUTION,
      buildLayers: buildMintLayers,
      clickableLayerIds: [MINT_LAYER_ID],
      buildPopupHtml: buildMintPopupHtml,
      spotSourceId: 'nomisma',
    },
    monuments: {
      id: 'monuments',
      sourceId: MONUMENT_SOURCE_ID,
      attribution: MONUMENT_ATTRIBUTION,
      buildLayers: buildMonumentLayers,
      clickableLayerIds: [MONUMENT_LAYER_ID],
      buildPopupHtml: buildMonumentPopupHtml,
      spotSourceId: 'wikidata',
    },
    isicily: {
      id: 'isicily',
      sourceId: ISICILY_SOURCE_ID,
      attribution: ISICILY_ATTRIBUTION,
      buildLayers: buildIsicilyLayers,
      clickableLayerIds: [ISICILY_LAYER_ID],
      buildPopupHtml: buildIsicilyPopupHtml,
      spotSourceId: 'isicily',
      internalPath: isicilyPath,
    },
    hillforts: {
      id: 'hillforts',
      sourceId: HILLFORT_SOURCE_ID,
      attribution: HILLFORT_ATTRIBUTION,
      buildLayers: buildHillfortLayers,
      clickableLayerIds: [HILLFORT_LAYER_ID],
      buildPopupHtml: buildHillfortPopupHtml,
      spotSourceId: 'hillforts-atlas',
    },
    'road-audit': {
      id: 'road-audit',
      sourceId: ROAD_AUDIT_SOURCE_ID,
      attribution: ROAD_AUDIT_ATTRIBUTION,
      buildLayers: buildRoadAuditLayers,
      clickableLayerIds: [ROAD_AUDIT_LAYER_IDS.hit, ROAD_AUDIT_LAYER_IDS.gaps],
      buildPopupHtml: buildRoadAuditPopupHtml,
      internalPath: roadAuditPath,
    },
  }

export const useReferenceOverlays = () => {
  const { referenceOverlaysActive, referenceTilesUrl } = useBasemapStyle()
  const { t } = useI18n()
  const { openOverlayPopup } = useOverlayPopup()

  const showPopup = (
    map: MapLibreMap,
    definition: ReferenceOverlayDefinition,
    event: MapLayerMouseEvent,
  ): void => {
    const feature = event.features?.[0]
    if (!feature) return
    if (definition.isAnsweredElsewhere?.(map, event)) return

    const properties = feature.properties as Record<string, unknown>
    const isPoint = feature.geometry.type === 'Point'
    const position: [number, number] =
      feature.geometry.type === 'Point'
        ? (feature.geometry.coordinates as [number, number])
        : [event.lngLat.lng, event.lngLat.lat]

    // Only an icon is ringed; a road is a line, and the click lands anywhere on it.
    const popup = openOverlayPopup({
      map,
      position,
      html: definition.buildPopupHtml(properties, t),
      maxWidth: '260px',
      withRing: isPoint,
      spot: isPoint && definition.spotSourceId ? { sourceId: definition.spotSourceId } : undefined,
    })

    // Raw `Popup.setHTML` markup has no router interception, so an in-app link
    // would hard-navigate and drop every overlay toggle with it — the same fix
    // `useInscriptionsOverlay` applies to its own popup link.
    const path = definition.internalPath?.(properties)
    if (path) {
      popup
        .getElement()
        ?.querySelector('a')
        ?.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault()
          void navigateTo(path)
        })
    }
  }

  const attach = (map: MapLibreMap, definition: ReferenceOverlayDefinition): void => {
    if (map.getSource(definition.sourceId)) return

    map.addSource(definition.sourceId, {
      type: 'vector',
      tiles: [`${referenceTilesUrl.value}/${definition.id}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: definition.attribution,
    })

    for (const layer of definition.buildLayers()) map.addLayer(layer)
    // See `useLimesOverlay`'s `attachLimesOverlay` for why this call is needed.
    map.triggerRepaint()

    for (const layerId of definition.clickableLayerIds) {
      bindOverlayListenersOnce(map, layerId, () => {
        map.on('click', layerId, (event) => showPopup(map, definition, event))
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = ''
        })
      })
    }
  }

  const detach = (map: MapLibreMap, definition: ReferenceOverlayDefinition): void => {
    for (const layer of definition.buildLayers()) {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id)
    }
    if (map.getSource(definition.sourceId)) map.removeSource(definition.sourceId)
  }

  /**
   * Brings the map in line with the switches: attaches what is on and absent,
   * detaches what is off and present. Idempotent, so it is safe on every
   * `styledata` — which is exactly how a basemap swap, wiping every custom source,
   * gets the active overlays back.
   */
  const syncReferenceOverlays = (map: MapLibreMap): void => {
    for (const id of REFERENCE_OVERLAY_IDS) {
      const definition = REFERENCE_OVERLAY_DEFINITIONS[id]
      if (referenceOverlaysActive.value[id]) attach(map, definition)
      else if (map.getSource(definition.sourceId)) detach(map, definition)
    }
  }

  const keepReferenceOverlaysThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => syncReferenceOverlays(map))
  }

  return { syncReferenceOverlays, keepReferenceOverlaysThroughStyleChanges }
}
