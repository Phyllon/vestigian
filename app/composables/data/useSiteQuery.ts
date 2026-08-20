import type { SiteDetail, SiteSummary } from '#shared/types'

/**
 * Reads for the detail panel and the search field. Tiles deliberately carry no
 * descriptive content, so opening a site is always one small request against a
 * short-lived cache rather than a page navigation.
 */
export const useSiteQuery = () => {
  const selectedSiteId = useState<number | null>('selected-site', () => null)
  const selectedTracingId = useState<number | null>('selected-tracing', () => null)

  const {
    data: site,
    status,
    error,
  } = useLazyAsyncData<SiteDetail | null>(
    'site-detail',
    () =>
      selectedSiteId.value
        ? $fetch<SiteDetail>(`/api/sites/${selectedSiteId.value}`)
        : Promise.resolve(null),
    { watch: [selectedSiteId], server: false, default: () => null },
  )

  const { data: tracing } = useLazyAsyncData<TracingDetail | null>(
    'tracing-detail',
    () =>
      selectedTracingId.value
        ? $fetch<TracingDetail>(`/api/tracings/${selectedTracingId.value}`)
        : Promise.resolve(null),
    { watch: [selectedTracingId], server: false, default: () => null },
  )

  // Selecting one clears the other: two open panels would fight for the same
  // corner of a phone screen.
  const selectSite = (id: number | null): void => {
    selectedSiteId.value = id
    if (id !== null) selectedTracingId.value = null
  }

  const selectTracing = (id: number | null): void => {
    selectedTracingId.value = id
    if (id !== null) selectedSiteId.value = null
  }

  const clearSelection = (): void => {
    selectedSiteId.value = null
    selectedTracingId.value = null
  }

  const isPanelOpen = computed(() => selectedSiteId.value !== null)
  const isTracingPanelOpen = computed(() => selectedTracingId.value !== null)

  return {
    site,
    tracing,
    status,
    error,
    selectedSiteId,
    selectedTracingId,
    selectSite,
    selectTracing,
    clearSelection,
    isPanelOpen,
    isTracingPanelOpen,
  }
}

export interface TracingDetail {
  id: number
  title: string
  kind: string
  category: string
  description: string | null
  geometry: GeoJSON.Geometry
  lengthMetres: number | null
  licence: string
  attribution: string | null
  updatedAt: string
}

/** Route lengths read in kilometres; anything shorter is not a route. */
export const formatLength = (metres: number | null): string => {
  if (metres === null || metres <= 0) return ''
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`
}

export const useSiteSearch = () => {
  const term = ref('')
  const results = ref<SiteSummary[]>([])
  const isSearching = ref(false)

  let requestToken = 0

  /**
   * Later responses can arrive before earlier ones. The token makes a stale
   * response identifiable so it is discarded rather than overwriting the
   * results the user is currently looking at.
   */
  const runSearch = async (query: string): Promise<void> => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      results.value = []
      return
    }

    const token = ++requestToken
    isSearching.value = true

    try {
      const found = await $fetch<SiteSummary[]>('/api/sites/search', { query: { q: trimmed } })
      if (token === requestToken) results.value = found
    } catch {
      if (token === requestToken) results.value = []
    } finally {
      if (token === requestToken) isSearching.value = false
    }
  }

  const debouncedSearch = useDebounceFn(runSearch, 220)

  watch(term, (next) => {
    void debouncedSearch(next)
  })

  return { term, results, isSearching, runSearch }
}

/**
 * Formats a date range the way an archaeological label reads it. Years are
 * plain integers in the database, with negatives meaning BC, so the era suffix
 * is derived rather than stored.
 */
export const formatPeriod = (from: number | null, to: number | null): string => {
  const era = (year: number): string => (year < 0 ? `${Math.abs(year)} BC` : `AD ${year}`)

  if (from === null && to === null) return 'Undated'
  if (from !== null && to === null) return `From ${era(from)}`
  if (from === null && to !== null) return `Until ${era(to)}`
  if (from === to) return era(from as number)
  return `${era(from as number)} – ${era(to as number)}`
}
