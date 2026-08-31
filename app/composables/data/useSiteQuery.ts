import { useDebounceFn } from '@vueuse/core'
import type { SiteDetail, SiteSummary } from '#shared/types'

/**
 * Reads for the detail panel and the search field. Tiles deliberately carry no
 * descriptive content, so opening a site is always one small request against a
 * short-lived cache rather than a page navigation.
 */
export const useSiteQuery = () => {
  const selectedSiteId = useState<number | null>('selected-site', () => null)
  const selectedTracingId = useState<number | null>('selected-tracing', () => null)

  /**
   * What was under the last tap, when it was more than one thing. Kept while a
   * record from it is open so the reader can step back to the list — otherwise
   * reaching the second of two overlapping markers means hitting the same
   * pixel again, which is the problem this exists to solve.
   */
  const overlappingFeatures = useState<MapFeatureCandidate[]>('overlapping-features', () => [])

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
    overlappingFeatures.value = []
  }

  /** A tap landed on several records. Offer them rather than guessing. */
  const offerOverlappingFeatures = (candidates: MapFeatureCandidate[]): void => {
    selectedSiteId.value = null
    selectedTracingId.value = null
    overlappingFeatures.value = candidates
  }

  const chooseCandidate = (candidate: MapFeatureCandidate): void => {
    if (candidate.kind === 'tracing') selectTracing(candidate.id)
    else selectSite(candidate.id)
  }

  /** Back to the list, without discarding it. */
  const returnToOverlappingFeatures = (): void => {
    selectedSiteId.value = null
    selectedTracingId.value = null
  }

  const isPanelOpen = computed(() => selectedSiteId.value !== null)
  const isTracingPanelOpen = computed(() => selectedTracingId.value !== null)

  const hasOverlappingFeatures = computed(() => overlappingFeatures.value.length > 1)

  const isPickerOpen = computed(
    () => hasOverlappingFeatures.value && !isPanelOpen.value && !isTracingPanelOpen.value,
  )

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
    overlappingFeatures,
    offerOverlappingFeatures,
    chooseCandidate,
    returnToOverlappingFeatures,
    hasOverlappingFeatures,
    isPickerOpen,
  }
}

/** One record under the tap, as the picker lists it. */
export interface MapFeatureCandidate {
  kind: 'site' | 'tracing'
  id: number
  title: string
  category: string
  /** Null for tracings: the nearest point of a road to a tap means nothing. */
  distanceMetres: number | null
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
 * The reading form of a timestamp. Every date rendered from one of these is
 * wrapped in a `<time datetime>` carrying the ISO string it came from, so this
 * is only ever the half a person reads.
 */
/** `locale` defaults to `en-GB` so callers with no i18n context still get a sane format. */
export const formatDate = (iso: string, locale = 'en-GB'): string =>
  new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' })

export type PeriodTranslate = (key: string, params?: Record<string, unknown>) => string

/**
 * Formats a date range the way an archaeological label reads it. Years are
 * plain integers in the database, with negatives meaning BC, so the era suffix
 * is derived rather than stored.
 *
 * `t` comes from the calling component — this file has no guaranteed i18n
 * context of its own.
 */
export const formatPeriod = (
  from: number | null,
  to: number | null,
  t: PeriodTranslate,
): string => {
  const era = (year: number): string =>
    year < 0 ? t('periodFormat.bc', { year: Math.abs(year) }) : t('periodFormat.ad', { year })

  if (from === null && to === null) return t('periodFormat.undated')
  if (from !== null && to === null) return t('periodFormat.fromYear', { year: era(from) })
  if (from === null && to !== null) return t('periodFormat.untilYear', { year: era(to) })
  if (from === to) return era(from as number)
  return t('periodFormat.yearRange', { from: era(from as number), to: era(to as number) })
}
