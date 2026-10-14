import type { Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import type { BasemapView } from '#shared/types'
import { measureTabulaLeg, romanMilesToMetres } from '#shared/utils/tabula-distance'
import { bindOverlayListenersOnce } from './useMapInstance'
import { escapeHtmlForPopup } from './popupHtml'
import { MAP_LABEL_FONT, TABULA_PEUTINGERIANA_ATTRIBUTION } from './useBasemapStyle'

export const TABULA_PEUTINGERIANA_SOURCE_ID = 'vestigian-tabula-peutingeriana'
const ROADS_LAYER_ID = 'vestigian-tabula-peutingeriana-roads'
const ROADS_CASING_LAYER_ID = 'vestigian-tabula-peutingeriana-roads-casing'
/** Invisible and wide: the drawn line is 1.4–3 px, too thin to hit with a finger. */
const ROADS_HIT_LAYER_ID = 'vestigian-tabula-peutingeriana-roads-hit'
const PLACES_LAYER_ID = 'vestigian-tabula-peutingeriana-places'
const PLACE_LABELS_LAYER_ID = 'vestigian-tabula-peutingeriana-place-labels'

/**
 * A warm verdigris rather than the bronze this overlay first shipped with —
 * bronze is already this app's colour for a *contributed* linear feature
 * (`useViewportTiles`'s tracing layer, `ATLAS_COLOURS.infrastructure`'s own
 * neighbours), and at the original width and opacity the network read as
 * barely-there pencil rather than a citation worth looking at. Deliberately
 * not the frontier's oxide red either — the two overlays can be switched on
 * together (there is nothing that ties them to the same basemap any more,
 * see `useLimesOverlay`), and a reader following the limes needs to be able
 * to tell which line is which at a glance.
 */
const TABULA_PEUTINGERIANA_COLOUR = '#3d6b5c'
const TABULA_PEUTINGERIANA_LABEL_COLOUR = '#2c4d42'

interface TabulaPeutingerianaColours {
  line: string
  /** Drawn under the road line only when set; `null` means no casing layer. */
  casing: string | null
  label: string
  halo: string
}

const DEFAULT_TABULA_PEUTINGERIANA_COLOURS: TabulaPeutingerianaColours = {
  line: TABULA_PEUTINGERIANA_COLOUR,
  casing: null,
  label: TABULA_PEUTINGERIANA_LABEL_COLOUR,
  halo: '#faf7ef',
}

/**
 * Verdigris disappears into forest canopy: on satellite imagery the network
 * was green line on green wood. Photography has no stable ground tone, so —
 * as `SATELLITE_POLITY_COLOURS` does — the line is a bright hue that no
 * landcover is (yellow; the frontier is oxide red and reference marks are
 * `SATELLITE_REFERENCE_INK` orange, so it stays distinguishable from both)
 * and a near-black casing guarantees one of the pair contrasts with whatever
 * pixel sits underneath, pale sand included.
 */
const SATELLITE_TABULA_PEUTINGERIANA_COLOURS: TabulaPeutingerianaColours = {
  line: '#ffe14d',
  casing: '#1a1208',
  label: '#ffffff',
  halo: '#1a1208',
}

/**
 * Keyed to the basemap, not the reader's theme — the same "follows the sheet"
 * rule as `resolvePolityColours`. Read fresh on every attach, so a basemap
 * switch (which rebuilds overlays via `styledata`) picks up the right set.
 */
export const resolveTabulaPeutingerianaColours = (view: BasemapView): TabulaPeutingerianaColours =>
  view === 'satellite'
    ? SATELLITE_TABULA_PEUTINGERIANA_COLOURS
    : DEFAULT_TABULA_PEUTINGERIANA_COLOURS

export interface TabulaRoadFeatureProperties {
  distanceRomanMiles: number | null
  isReconstructed: boolean
  overWater: boolean
  crossesMountains: boolean
  crossesRiver: string | null
  fromLabel: string
  fromModernName: string | null
  toLabel: string
  toModernName: string | null
  straightLineMetres: number
}

export type TabulaPopupKey =
  | 'tabulaPopup.noFigure'
  | 'tabulaPopup.stated'
  | 'tabulaPopup.straightLine'
  | 'tabulaPopup.shorterThanLine'
  | 'tabulaPopup.roadWinds'
  | 'tabulaPopup.overWater'
  | 'tabulaPopup.crossesMountains'
  | 'tabulaPopup.crossesRiver'
  | 'tabulaPopup.reconstructed'

export interface TabulaPopupHelpers {
  /** Plural-aware: `count` selects the form and is also available as `{n}`. */
  t: (key: TabulaPopupKey, values?: Record<string, string | number>, count?: number) => string
  formatKilometres: (kilometres: number) => string
}

const nameWithModern = (label: string, modernName: string | null): string => {
  const classical = escapeHtmlForPopup(label)
  if (!modernName) return classical
  return `${classical} <span>(${escapeHtmlForPopup(modernName)})</span>`
}

/**
 * Everything the leg's own record carries, and nothing it does not. The
 * straight line is calculated here, from the endpoints, and said so — it is
 * not what the manuscript or the compiler recorded. A road is longer than a
 * straight line, so the note says that rather than leaving a stated figure
 * over the line to read as an error; only the opposite case is flagged.
 */
export const buildTabulaRoadPopupHtml = (
  properties: TabulaRoadFeatureProperties,
  helpers: TabulaPopupHelpers,
): string => {
  const { t, formatKilometres } = helpers
  const lines = [
    `<strong>${nameWithModern(properties.fromLabel, properties.fromModernName)} → ${nameWithModern(properties.toLabel, properties.toModernName)}</strong>`,
  ]

  const miles = properties.distanceRomanMiles
  const measure = measureTabulaLeg({
    statedRomanMiles: miles,
    straightLineMetres: properties.straightLineMetres,
  })

  if (miles === null) {
    lines.push(escapeHtmlForPopup(t('tabulaPopup.noFigure')))
  } else {
    const statedKilometres = formatKilometres(romanMilesToMetres(miles) / 1000)
    lines.push(
      escapeHtmlForPopup(t('tabulaPopup.stated', { n: miles, km: statedKilometres }, miles)),
    )
  }

  if (properties.straightLineMetres > 0) {
    const lineKilometres = formatKilometres(properties.straightLineMetres / 1000)
    lines.push(escapeHtmlForPopup(t('tabulaPopup.straightLine', { km: lineKilometres })))
    const note =
      measure?.reading === 'shorter-than-line'
        ? 'tabulaPopup.shorterThanLine'
        : 'tabulaPopup.roadWinds'
    lines.push(`<em>${escapeHtmlForPopup(t(note))}</em>`)
  }

  const crossings: string[] = []
  if (properties.overWater) crossings.push(t('tabulaPopup.overWater'))
  if (properties.crossesMountains) crossings.push(t('tabulaPopup.crossesMountains'))
  if (properties.crossesRiver) {
    crossings.push(t('tabulaPopup.crossesRiver', { river: properties.crossesRiver }))
  }
  if (crossings.length > 0) lines.push(crossings.map(escapeHtmlForPopup).join(' · '))

  if (properties.isReconstructed) {
    lines.push(escapeHtmlForPopup(t('tabulaPopup.reconstructed')))
  }

  return lines.join('<br>')
}

/**
 * The Tabula Peutingeriana's places and roads, drawn over whatever basemap is
 * currently showing — a `geojson` source, not a tile source, for the same
 * reason `useNotebookOverlay` is one: 2,574 places and 2,397 roads is a few
 * hundred KB that fits in a single response, not something the MVT pipeline's
 * global cache generation should be charged for.
 *
 * Unlike the notebook overlay, this is off until a reader switches it on
 * (`isShowingTabulaPeutingerianaOverlay` in `useBasemapStyle`) — the data is
 * fetched lazily on first activation, not on every map load, since most
 * readers will never turn it on. The layer can be withdrawn with
 * `tabulaPeutingerianaEnabled` (see `nuxt.config.ts`).
 *
 * The lines and marks draw filled rather than as bare outlines — legible
 * against a basemap on its own now, not only once a reader already knows to
 * look for them — but the place labels stay annotation: the classical name
 * OmnesViae itself transcribed, with the modern place underneath in smaller
 * type where one is known, matching how omnesviae.org's own site pairs the
 * two. A real tracing here is one drawn and reviewed through
 * `applyRevision()`; this is a citation, not a claim.
 */
export const useTabulaPeutingerianaOverlay = () => {
  const { isShowingTabulaPeutingerianaOverlay, view } = useBasemapStyle()
  const { t, locale } = useI18n()
  const { openOverlayPopup } = useOverlayPopup()

  const data = shallowRef<GeoJSON.FeatureCollection | null>(null)
  const isLoading = ref(false)

  const load = async (): Promise<void> => {
    if (data.value || isLoading.value) return
    isLoading.value = true
    try {
      data.value = await $fetch<GeoJSON.FeatureCollection>(
        '/api/tabula-peutingeriana/network.geojson',
      )
    } catch {
      // Fails open, like enrichment and translation elsewhere in this app: an
      // overlay that cannot load leaves the map exactly as it was, rather
      // than blocking anything on the critical path.
      data.value = { type: 'FeatureCollection', features: [] }
    } finally {
      isLoading.value = false
    }
  }

  const showRoadPopup = (map: MapLibreMap, event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0]
    if (!feature) return

    const numberFormat = new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 })
    openOverlayPopup({
      map,
      position: [event.lngLat.lng, event.lngLat.lat],
      html: buildTabulaRoadPopupHtml(feature.properties as TabulaRoadFeatureProperties, {
        t: (key, values, count) =>
          count === undefined ? t(key, values ?? {}) : t(key, values ?? {}, count),
        formatKilometres: (kilometres) => numberFormat.format(kilometres),
      }),
      maxWidth: '280px',
      withRing: false,
    })
  }

  const attachTabulaPeutingerianaOverlay = (map: MapLibreMap): void => {
    if (!isShowingTabulaPeutingerianaOverlay.value || !data.value) return
    if (map.getSource(TABULA_PEUTINGERIANA_SOURCE_ID)) return

    map.addSource(TABULA_PEUTINGERIANA_SOURCE_ID, {
      type: 'geojson',
      data: data.value,
      attribution: TABULA_PEUTINGERIANA_ATTRIBUTION,
    })

    const colours = resolveTabulaPeutingerianaColours(view.value)

    if (colours.casing) {
      map.addLayer({
        id: ROADS_CASING_LAYER_ID,
        type: 'line',
        source: TABULA_PEUTINGERIANA_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': colours.casing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 5.5],
          'line-opacity': 0.8,
        },
      })
    }

    map.addLayer({
      id: ROADS_HIT_LAYER_ID,
      type: 'line',
      source: TABULA_PEUTINGERIANA_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'road'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': colours.line, 'line-width': 16, 'line-opacity': 0 },
    })

    map.addLayer({
      id: ROADS_LAYER_ID,
      type: 'line',
      source: TABULA_PEUTINGERIANA_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'road'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': colours.line,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 10, 3],
        'line-opacity': 0.85,
        // A reconstructed leg (filled from the Itinerarium Antonini, not the
        // manuscript itself) is drawn distinctly from one the map itself
        // records — the same distinction Barrington's own `certain` column
        // already earns a dash for on `antiquity_lines`.
        'line-dasharray': [
          'case',
          ['get', 'isReconstructed'],
          ['literal', [2, 2]],
          ['literal', [1, 0]],
        ],
      },
    })

    map.addLayer({
      id: PLACES_LAYER_ID,
      type: 'circle',
      source: TABULA_PEUTINGERIANA_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'place'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 10, 6],
        'circle-color': colours.line,
        'circle-opacity': colours.casing ? 0.9 : 0.5,
        'circle-stroke-color': colours.casing ?? colours.line,
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.95,
      },
    })

    /**
     * The classical name OmnesViae itself transcribed from the manuscript,
     * with the modern place it corresponds to underneath where one is known —
     * the same pairing the source's own site shows for a place. A separate
     * symbol layer rather than folded into the circles above, because a label
     * needs its own collision box and `text-optional` so a crowded stretch
     * loses names before it loses the marks themselves.
     */
    map.addLayer({
      id: PLACE_LABELS_LAYER_ID,
      type: 'symbol',
      source: TABULA_PEUTINGERIANA_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'place'],
      minzoom: 5,
      layout: {
        'text-field': [
          'case',
          ['!=', ['get', 'modernName'], null],
          ['format', ['get', 'label'], {}, '\n', {}, ['get', 'modernName'], { 'font-scale': 0.85 }],
          ['get', 'label'],
        ],
        'text-font': [MAP_LABEL_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 12, 13],
        'text-anchor': 'top',
        'text-offset': [0, 0.55],
        'text-max-width': 8,
        'text-padding': 4,
        'text-optional': true,
      },
      paint: {
        'text-color': colours.label,
        'text-halo-color': colours.halo,
        'text-halo-width': 1.2,
      },
    })

    // See `useLimesOverlay`'s `attachLimesOverlay` for why this call is needed.
    map.triggerRepaint()

    bindOverlayListenersOnce(map, ROADS_HIT_LAYER_ID, () => {
      map.on('click', ROADS_HIT_LAYER_ID, (event) => showRoadPopup(map, event))
      map.on('mouseenter', ROADS_HIT_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', ROADS_HIT_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    })
  }

  const detachTabulaPeutingerianaOverlay = (map: MapLibreMap): void => {
    if (map.getLayer(PLACE_LABELS_LAYER_ID)) map.removeLayer(PLACE_LABELS_LAYER_ID)
    if (map.getLayer(PLACES_LAYER_ID)) map.removeLayer(PLACES_LAYER_ID)
    if (map.getLayer(ROADS_LAYER_ID)) map.removeLayer(ROADS_LAYER_ID)
    if (map.getLayer(ROADS_HIT_LAYER_ID)) map.removeLayer(ROADS_HIT_LAYER_ID)
    if (map.getLayer(ROADS_CASING_LAYER_ID)) map.removeLayer(ROADS_CASING_LAYER_ID)
    if (map.getSource(TABULA_PEUTINGERIANA_SOURCE_ID))
      map.removeSource(TABULA_PEUTINGERIANA_SOURCE_ID)
  }

  /** Style swaps wipe every custom source and layer — the same arrangement as `keepOverlayThroughStyleChanges`. */
  const keepTabulaPeutingerianaOverlayThroughStyleChanges = (map: MapLibreMap): void => {
    map.on('styledata', () => {
      if (
        isShowingTabulaPeutingerianaOverlay.value &&
        !map.getSource(TABULA_PEUTINGERIANA_SOURCE_ID)
      ) {
        attachTabulaPeutingerianaOverlay(map)
      }
    })
  }

  return {
    isActive: isShowingTabulaPeutingerianaOverlay,
    isLoading,
    load,
    attachTabulaPeutingerianaOverlay,
    detachTabulaPeutingerianaOverlay,
    keepTabulaPeutingerianaOverlayThroughStyleChanges,
  }
}
