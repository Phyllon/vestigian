import type { LimesSector, LimesSectorDetail } from '#shared/types'

/**
 * The frontier as something to walk, rather than something to look at.
 *
 * The map answers "where does it run"; this answers "what is on it, and in what
 * order" — which is the half a map cannot do, because a line of six thousand
 * watchtowers read at continental zoom is a texture, not an itinerary.
 *
 * Fetched lazily and only while the switch is on. A reader who never turns it
 * on pays nothing, and the sector list is one small response cached for an hour
 * by the endpoint.
 */
export const useLimes = () => {
  const { isFollowingLimes } = useBasemapStyle()

  const selectedSectorSlug = useState<string | null>('limes-sector', () => null)

  /**
   * Watched on the switch rather than fetched on mount: the panel is
   * instantiated with every page load and a reader who never turns the frontier
   * on should not be asking the server about it.
   */
  const { data: sectors, status: sectorsStatus } = useLazyAsyncData<LimesSector[]>(
    'limes-sectors',
    () =>
      isFollowingLimes.value ? $fetch<LimesSector[]>('/api/limes/sectors') : Promise.resolve([]),
    { server: false, default: () => [], watch: [isFollowingLimes] },
  )

  const { data: sector, status: sectorStatus } = useLazyAsyncData<LimesSectorDetail | null>(
    'limes-sector',
    () => {
      const slug = selectedSectorSlug.value
      if (!slug) return Promise.resolve(null)
      return $fetch<LimesSectorDetail>(`/api/limes/sectors/${slug}`)
    },
    { server: false, default: () => null, watch: [selectedSectorSlug] },
  )

  const selectSector = (slug: string | null): void => {
    selectedSectorSlug.value = slug
  }

  const isSectorOpen = computed(() => selectedSectorSlug.value !== null)

  return {
    isFollowingLimes,
    sectors,
    sectorsStatus,
    sector,
    sectorStatus,
    selectedSectorSlug,
    selectSector,
    isSectorOpen,
  }
}

/** Kilometres, to the nearest whole one above 10 km and to one decimal below. */
export const formatFrontierLength = (metres: number): string => {
  const km = metres / 1000
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`
}

/**
 * A sector's date range as a reader would say it.
 *
 * Negative years are BC, matching `formatPeriod` in `useSiteQuery`. The frontier
 * dates are all AD bar the Rhine and the Danube, whose garrisons predate the
 * era, and writing "-15" on a page about Augustus would be a small failure.
 */
export const formatFrontierYears = (from: number | null, to: number | null): string => {
  if (from === null && to === null) return ''
  const year = (value: number): string => (value < 0 ? `${Math.abs(value)} BC` : `AD ${value}`)
  if (from === null) return `to ${year(to!)}`
  if (to === null) return `from ${year(from)}`
  return `${year(from)} – ${year(to)}`
}

/**
 * How far along the sector an installation sits, phrased for reading rather
 * than for precision. The roll's whole job is to be walked in order, so the
 * number beside each entry is a milepost, not a measurement.
 */
export const formatOffset = (metres: number): string => {
  if (metres < 500) return 'at the start'
  if (metres < 10000) return `${(metres / 1000).toFixed(1)} km along`
  return `${Math.round(metres / 1000)} km along`
}
