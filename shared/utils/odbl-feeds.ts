import type { LimesSource } from '../types/limes'
import { SURVEY_PROJECT } from './survey-sites'

/**
 * The reference layers this atlas offers back under the Open Database Licence.
 *
 * ODbL §4.6 is a duty, not a courtesy: whoever publicly uses a derivative
 * database, or a produced work from one — which the tiles of these layers are —
 * must offer recipients a machine-readable copy of it, or of what was altered.
 * The tables behind these layers are extractions of AWMC, OpenStreetMap and the
 * Ancient Sites and Monuments Survey (all ODbL) and of CHRR (ODbL on its site,
 * CC BY-NC 3.0 in its machine-readable description — both are honoured), so this
 * list is that offer. `/licence` shows it, grouped by licence.
 *
 * **Not here, on purpose:** layers whose licence asks only for credit (Itiner-e,
 * Nomisma, Cliopatria, the hillforts atlas, ports, ORBIS, Pleiades, Wikidata,
 * OHM) — republishing them would put third-party terms into a feed that promises
 * ODbL — and the basemap mirrors (OpenStreetMap via Protomaps, DARE, EOX,
 * Mapterhorn), which are served as tiles only.
 *
 * Pure, so the page and the endpoint cannot disagree about what exists.
 */
export const ODBL_FEED_LAYERS = [
  'awmc-water',
  'awmc-lines',
  'awmc-areas',
  'awmc-regions',
  'awmc-features',
  'coin-hoards',
  'limes',
  'survey-sites',
] as const

export type OdblFeedLayer = (typeof ODBL_FEED_LAYERS)[number]

/** `geojson` for maps and analysis, `ttl` (RDF, Turtle) for the linked-data graph. */
export const ODBL_FEED_FORMATS = ['geojson', 'ttl'] as const

export type OdblFeedFormat = (typeof ODBL_FEED_FORMATS)[number]

export interface OdblFeedMeta {
  /** English, machine-facing: it is written into the feed's own metadata, not the interface. */
  title: string
  /** The credit that travels with the collection. */
  credit: string
  /** Licence codes the collection as a whole is offered under — see `licence-uris.ts`. */
  licences: readonly string[]
  /** What was changed on the way in. ODbL §4.6(b) accepts "the alterations made" as the offer. */
  alterations: string
  /** Which of the optional `kind` and `source` filters the layer has. */
  filters: { kind: boolean; source: boolean }
  defaultLimit: number
  /**
   * Larger than this is refused with 400 rather than clamped: a client pages until a
   * page comes back shorter than the `limit` it asked for, so a silently smaller page
   * would read as the end of the data.
   */
  maxLimit: number
}

const AWMC_CREDIT =
  'Ancient World Mapping Center, University of North Carolina at Chapel Hill (github.com/AWMC/geodata), derived from the Barrington Atlas of the Greek and Roman World and OpenStreetMap contributors. ODbL 1.0.'

export const ODBL_FEED_META: Readonly<Record<OdblFeedLayer, OdblFeedMeta>> = {
  'awmc-water': {
    title: 'AWMC water: ancient sea and inland-water polygons',
    credit: AWMC_CREDIT,
    licences: ['ODbL-1.0'],
    alterations:
      'Ten of AWMC’s twenty open-water regions (those touching the Roman world), simplified to about 20 m with topology preserved, and made valid. Inland water as published.',
    filters: { kind: true, source: false },
    defaultLimit: 100,
    maxLimit: 250,
  },
  'awmc-lines': {
    title: 'AWMC lines: roads, aqueducts, canals, walls, shorelines, centuriation',
    credit: AWMC_CREDIT,
    licences: ['ODbL-1.0'],
    alterations:
      'Geometry as published, merged into one table with a kind column. Attributes AWMC leaves blank are null.',
    filters: { kind: true, source: false },
    defaultLimit: 500,
    maxLimit: 1000,
  },
  'awmc-areas': {
    title: 'AWMC areas: urban footprints and centuriation blocks',
    credit: AWMC_CREDIT,
    licences: ['ODbL-1.0'],
    alterations: 'Geometry as published, merged into one table with a kind column.',
    filters: { kind: true, source: false },
    defaultLimit: 500,
    maxLimit: 1000,
  },
  'awmc-regions': {
    title: 'AWMC regions: extents of regions and peoples, as boundary lines',
    credit: AWMC_CREDIT,
    licences: ['ODbL-1.0'],
    alterations:
      'Geometry as published (AWMC draws extents as linework, not fills). Label points derived at import are not included.',
    filters: { kind: false, source: false },
    defaultLimit: 500,
    maxLimit: 1000,
  },
  'awmc-features': {
    title: 'AWMC minor antiquities: bridges, mines and quarries, dams, cemeteries, forts, tumuli',
    credit: AWMC_CREDIT,
    licences: ['ODbL-1.0'],
    alterations:
      'Six AWMC shapefile layers merged into one table. Material and period flags are kept as AWMC writes them.',
    filters: { kind: true, source: false },
    defaultLimit: 500,
    maxLimit: 1000,
  },
  'coin-hoards': {
    title: 'Coin Hoards of the Roman Republic: findspots',
    credit:
      'Coin Hoards of the Roman Republic, American Numismatic Society (numismatics.org/chrr), copyright holder Kris Lockyear. The site states ODbL 1.0; its machine-readable description states CC BY-NC 3.0. Both are honoured here: share-alike, and non-commercial use only.',
    licences: ['ODbL-1.0', 'CC-BY-NC-3.0'],
    alterations:
      'CHRR’s own findspots.geojson as published: 694 hoard records aggregated by CHRR to 620 locations, each with its hoard count. No per-hoard detail.',
    filters: { kind: false, source: false },
    defaultLimit: 500,
    maxLimit: 1000,
  },
  limes: {
    title: 'The frontier (limes): traced and approximate segments, by sector',
    credit:
      'Traced from OpenStreetMap contributors (ODbL 1.0) and OpenHistoricalMap contributors (CC0 1.0), from vici.org contributors’ tracings (CC0 1.0 or CC BY-SA 3.0, per tracing) and from the Ancient World Mapping Center’s empire extent and wall linework (ODbL 1.0). Each feature names its own source and licence.',
    licences: ['ODbL-1.0'],
    alterations:
      'Segments cut from the sources and assigned to the named sectors of shared/utils/limes.ts; the dashed (awmc, extent) lines are derived from AWMC’s generalised empire polygon and wall linework, not surveyed.',
    filters: { kind: true, source: true },
    defaultLimit: 100,
    maxLimit: 250,
  },
  'survey-sites': {
    title: 'Dated survey sites, selected from the Ancient Sites and Monuments Survey',
    credit: `Selected from the ${SURVEY_PROJECT.name} (${SURVEY_PROJECT.author}), ${SURVEY_PROJECT.url}. Each feature names the upstream source and licence it came through.`,
    licences: ['ODbL-1.0'],
    alterations:
      'Four upstream sources’ rows kept, each period read from its note text into years; anything within 500 m of a site this atlas already holds removed.',
    filters: { kind: true, source: true },
    defaultLimit: 500,
    maxLimit: 1000,
  },
}

/**
 * The licence each frontier segment’s `source` came under — the one thing a
 * `limes` feature needs that the collection’s licence does not say. `vici` is a
 * pair because the tracing, not this atlas, chose which.
 */
export const LIMES_SOURCE_LICENCE: Readonly<Record<LimesSource, string>> = {
  osm: 'ODbL 1.0',
  ohm: 'CC0 1.0',
  vici: 'CC0 1.0 or CC BY-SA 3.0 (per tracing)',
  awmc: 'ODbL 1.0',
  extent: 'ODbL 1.0',
}

/** `/api/odbl/awmc-lines.ttl` → `{ layer: 'awmc-lines', format: 'ttl' }`; anything else → null. */
export const parseOdblFeedName = (
  name: string,
): { layer: OdblFeedLayer; format: OdblFeedFormat } | null => {
  const dot = name.lastIndexOf('.')
  if (dot < 1) return null

  const layer = ODBL_FEED_LAYERS.find((candidate) => candidate === name.slice(0, dot))
  const format = ODBL_FEED_FORMATS.find((candidate) => candidate === name.slice(dot + 1))
  return layer && format ? { layer, format } : null
}

export const odblFeedPath = (layer: OdblFeedLayer, format: OdblFeedFormat): string =>
  `/api/odbl/${layer}.${format}`
