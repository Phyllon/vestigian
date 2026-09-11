import type { AtticInscriptionSummary } from '#shared/types'

export interface AtticInscriptionBrowseFilters {
  monumentType: string
  yearFrom: string
  yearTo: string
}

/** Matches the sentinel `USelect`'s "Any type" item uses — not '', which
 *  Reka UI's Select primitive reserves internally (see
 *  `useInscriptionBrowse.ts`'s identical note). */
const ANY_VALUE = 'all'

export const emptyAtticInscriptionBrowseFilters = (): AtticInscriptionBrowseFilters => ({
  monumentType: ANY_VALUE,
  yearFrom: '',
  yearTo: '',
})

const PAGE_SIZE = 24

/** Facet browsing over `/api/attic-inscriptions` for `/inscriptions/attic`
 *  — same shape as `useInscriptionBrowse`, for the second corpus. */
export const useAtticInscriptionBrowse = (filters: Ref<AtticInscriptionBrowseFilters>) => {
  const items = ref<AtticInscriptionSummary[]>([])
  const hasMore = ref(false)
  const isLoading = ref(false)
  const offset = ref(0)

  const queryFor = (currentOffset: number): Record<string, string | number> => {
    const query: Record<string, string | number> = { limit: PAGE_SIZE, offset: currentOffset }
    if (filters.value.monumentType !== ANY_VALUE) query.monumentType = filters.value.monumentType
    if (filters.value.yearFrom) query.yearFrom = filters.value.yearFrom
    if (filters.value.yearTo) query.yearTo = filters.value.yearTo
    return query
  }

  const load = async (reset: boolean): Promise<void> => {
    isLoading.value = true
    const currentOffset = reset ? 0 : offset.value
    try {
      const response = await $fetch<{ items: AtticInscriptionSummary[]; hasMore: boolean }>(
        '/api/attic-inscriptions',
        { query: queryFor(currentOffset) },
      )
      items.value = reset ? response.items : [...items.value, ...response.items]
      hasMore.value = response.hasMore
      offset.value = currentOffset + response.items.length
    } finally {
      isLoading.value = false
    }
  }

  watch(filters, () => load(true), { deep: true })

  const loadMore = (): Promise<void> => load(false)

  return { items, hasMore, isLoading, load, loadMore }
}
