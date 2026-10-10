/**
 * What a reference mark's info box can say about the spot it stands on, beyond
 * what the mark's own record carries. Every value here is derived from the
 * coordinate alone — none of it is stored per record — so it is the same
 * answer whichever layer asked.
 */

/**
 * The upstream a reference layer's records come from, which is what the
 * info box credits. Several layers can share one (battles and monuments are
 * both Wikidata); the Barrington places and the frontier's installations are
 * both Pleiades.
 */
export type SpotSourceId =
  | 'pleiades'
  | 'wikidata'
  | 'ancient-ports'
  | 'chrr'
  | 'awmc'
  | 'edh'
  | 'attic-inscriptions'
  | 'nomisma'
  | 'isicily'
  | 'hillforts-atlas'

export interface ReferenceSource {
  /** The dataset's own name, never translated — it is a proper noun. */
  name: string
  url: string
  /** Short licence name as the upstream states it, e.g. `CC BY 4.0`. */
  licence: string
}

export interface SpotNearestTown {
  name: string
  distanceMetres: number
}

/** A `[startYear, endYear]` run, negative years being BC. Inclusive at both ends. */
export type YearSpan = [number, number]

export interface SpotContext {
  /** The nearest populated place, or `null` when none is close enough to say "near". */
  nearestTown: SpotNearestTown | null
  /** ISO 3166-1 alpha-2; `null` at sea and anywhere no boundary is close. */
  countryCode: string | null
  /**
   * Metres to the nearest one, unrounded for display — how coarsely to state it depends
   * on the zoom the mark was tapped at, which only the client knows. `null` outside the
   * terrain archive.
   */
  elevationMetres: number | null
  /**
   * The years in which the Roman state's recorded extent covers the spot,
   * merged into runs. Empty when it never does; `null` when the lookup itself
   * failed, which must not read as "never" — a database hiccup is not a
   * statement about Roman history. Year-independent on purpose, so one cached
   * answer serves whichever year the reader has the scrubber on.
   */
  extentSpans: YearSpan[] | null
}

/** `inside`/`outside` answer a particular year; `spans` is the whole history. */
export type ExtentPresence =
  | { state: 'inside'; year: number }
  | { state: 'outside'; year: number }
  | { state: 'spans'; spans: YearSpan[] }
  | { state: 'never' }
