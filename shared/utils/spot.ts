import type {
  DevicePosition,
  ExtentPresence,
  ReferenceSource,
  SpotContext,
  YearSpan,
} from '#shared/types'

/**
 * The pure half of a reference mark's "about this spot" block: what to show,
 * and how precisely, from a coordinate and the answers about it. Server and
 * client both import it — the server to snap and merge, the client to phrase.
 */

/** Every reference overlay's source stops here, so tiles are never finer than this. */
export const SPOT_TILE_MAX_ZOOM = 12

const TILE_EXTENT = 4096
const EQUATOR_METRES = 40_075_016.686

/**
 * A tapped mark's coordinate comes out of a vector tile, where it has been
 * rounded to the nearest unit of a 4096-wide grid. At zoom 12 that is 2.4 m;
 * at zoom 5 it is 300 m. Showing four decimals at zoom 5 would state a
 * precision the coordinate does not have.
 */
const tileUnitDegrees = (zoom: number): number =>
  360 / (2 ** Math.min(Math.max(zoom, 0), SPOT_TILE_MAX_ZOOM) * TILE_EXTENT)

export const tileUnitMetres = (zoom: number, latitude: number): number =>
  (EQUATOR_METRES * Math.cos((latitude * Math.PI) / 180)) /
  (2 ** Math.min(Math.max(zoom, 0), SPOT_TILE_MAX_ZOOM) * TILE_EXTENT)

/** Never more than four decimals (about 11 m): beyond that is false precision for any record. */
export const coordinateDecimalsForZoom = (zoom: number): number =>
  Math.min(4, Math.max(1, Math.floor(-Math.log10(tileUnitDegrees(zoom)))))

/**
 * Elevation comes from a model with metres of error of its own, then from a
 * point that may be a few hundred metres off on a steep slope at low zoom.
 */
export const elevationStepForZoom = (zoom: number, latitude: number): number => {
  const unit = tileUnitMetres(zoom, latitude)
  if (unit <= 30) return 10
  if (unit <= 150) return 50
  return 100
}

/** `lat, lon` — the order every map application accepts pasted. */
export const formatCoordinates = (lon: number, lat: number, decimals: number): string =>
  `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`

/**
 * Cache granularity, and what the derived answers are computed *at*: four
 * decimals, about 11 m. Computing on the snapped point rather than the raw one
 * keeps a cached answer a pure function of its key.
 */
export const snapCoordinate = (value: number): number => Math.round(value * 1e4) / 1e4

export const roundToStep = (value: number, step: number): number => Math.round(value / step) * step

/** Mapzen/Mapterhorn terrarium encoding: metres = R·256 + G + B/256 − 32768. */
export const decodeTerrariumElevation = (red: number, green: number, blue: number): number =>
  red * 256 + green + blue / 256 - 32768

export const haversineMetres = (
  from: { lon: number; lat: number },
  to: { lon: number; lat: number },
): number => {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180
  const deltaLat = toRadians(to.lat - from.lat)
  const deltaLon = toRadians(to.lon - from.lon)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLon / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** A fix worse than this says more about the network than about where the reader stands. */
export const FIX_MAX_ACCURACY_METRES = 2000
/** The reader may have walked on since the locate button last ran. */
export const FIX_MAX_AGE_MS = 10 * 60 * 1000

/**
 * How far the reader is from a spot, or `null` when saying so would mislead:
 * no fix yet, a coarse one, or one that has gone stale. The info box never asks
 * for a position itself — a permission prompt from inside a popup would be
 * invisible to the reader's own intent — so this only ever reads a fix the
 * locate button has already produced.
 */
export const distanceFromFix = (
  spot: { lon: number; lat: number },
  fix: DevicePosition | null,
  now: number,
): number | null => {
  if (!fix) return null
  if (fix.accuracy > FIX_MAX_ACCURACY_METRES) return null
  if (now - fix.timestamp > FIX_MAX_AGE_MS) return null
  return haversineMetres(fix.coords, spot)
}

/** `850 m`, `3.4 km`, `12 km` — formatted for the reader's locale. */
export const formatSpotDistance = (metres: number, locale: string): string => {
  if (metres < 950) {
    return `${new Intl.NumberFormat(locale).format(Math.max(10, roundToStep(metres, 10)))} m`
  }
  const kilometres = metres / 1000
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: kilometres < 10 ? 1 : 0,
  })
  return `${formatter.format(kilometres)} km`
}

export const formatElevation = (metres: number, step: number, locale: string): string =>
  new Intl.NumberFormat(locale).format(roundToStep(metres, step))

/**
 * Merges year runs that touch or overlap. The empire is stored as slices — one
 * per recorded change — so a spot inside it for four centuries comes back as
 * dozens of consecutive rows that the reader should see as one.
 */
export const mergeYearSpans = (spans: readonly YearSpan[]): YearSpan[] => {
  const sorted = spans.map(([from, to]): YearSpan => [from, to]).sort((a, b) => a[0] - b[0])
  const merged: YearSpan[] = []
  for (const span of sorted) {
    const last = merged.at(-1)
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push(span)
  }
  return merged
}

/**
 * What to say about the Roman state's extent: for the year the reader has the
 * scrubber on, inside or outside; with the scrubber off, the whole history.
 */
export const describeExtentPresence = (
  spans: readonly YearSpan[],
  year: number | null,
): ExtentPresence => {
  if (year === null)
    return spans.length > 0 ? { state: 'spans', spans: [...spans] } : { state: 'never' }
  const inside = spans.some(([from, to]) => year >= from && year <= to)
  return { state: inside ? 'inside' : 'outside', year }
}

/** Which dataset each derived row owes a credit to — only for rows actually shown. */
export const SPOT_DERIVED_SOURCES: Record<
  'geonames' | 'naturalEarth' | 'mapterhorn' | 'openHistoricalMap',
  ReferenceSource
> = {
  geonames: { name: 'GeoNames', url: 'https://www.geonames.org', licence: 'CC BY 4.0' },
  naturalEarth: { name: 'Natural Earth', url: 'https://www.naturalearthdata.com', licence: '' },
  mapterhorn: { name: 'Mapterhorn', url: 'https://mapterhorn.com/attribution', licence: '' },
  openHistoricalMap: {
    name: 'OpenHistoricalMap',
    url: 'https://www.openhistoricalmap.org',
    licence: 'CC0 1.0',
  },
}

export const creditsForContext = (context: SpotContext): ReferenceSource[] => {
  const credits: ReferenceSource[] = []
  if (context.nearestTown) credits.push(SPOT_DERIVED_SOURCES.geonames)
  if (context.countryCode) credits.push(SPOT_DERIVED_SOURCES.naturalEarth)
  if (context.elevationMetres !== null) credits.push(SPOT_DERIVED_SOURCES.mapterhorn)
  if (context.extentSpans !== null) credits.push(SPOT_DERIVED_SOURCES.openHistoricalMap)
  return credits
}
