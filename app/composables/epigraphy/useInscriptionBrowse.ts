import type { InscriptionSummary } from '#shared/types'

export interface InscriptionBrowseFilters {
  type: string
  material: string
  language: string
  decoratedOnly: boolean
  yearFrom: string
  yearTo: string
}

/** 'all', matching the sentinel `USelect`'s "Any type"/"Any language" items
 *  use (`app/pages/inscriptions/index.vue`) — not '', which Reka UI's Select
 *  primitive reserves internally and cannot be given as a real item value. */
const ANY_VALUE = 'all'

export const emptyInscriptionBrowseFilters = (): InscriptionBrowseFilters => ({
  type: ANY_VALUE,
  material: '',
  language: ANY_VALUE,
  decoratedOnly: false,
  yearFrom: '',
  yearTo: '',
})

const PAGE_SIZE = 24

/**
 * Facet browsing over `/api/inscriptions` for the `/inscriptions` reference
 * page. A plain "load more" rather than numbered pages — the endpoint
 * answers "is there another page" from one extra row rather than a total
 * count (`server/api/inscriptions/index.get.ts`), so numbered pagination
 * would need a second query this table's own scale doesn't otherwise need.
 */
export const useInscriptionBrowse = (filters: Ref<InscriptionBrowseFilters>) => {
  const items = ref<InscriptionSummary[]>([])
  const hasMore = ref(false)
  const isLoading = ref(false)
  const offset = ref(0)

  const queryFor = (currentOffset: number): Record<string, string | number | boolean> => {
    const query: Record<string, string | number | boolean> = {
      limit: PAGE_SIZE,
      offset: currentOffset,
      decoratedOnly: filters.value.decoratedOnly,
    }
    if (filters.value.type !== ANY_VALUE) query.type = filters.value.type
    if (filters.value.material) query.material = filters.value.material
    if (filters.value.language !== ANY_VALUE) query.language = filters.value.language
    if (filters.value.yearFrom) query.yearFrom = filters.value.yearFrom
    if (filters.value.yearTo) query.yearTo = filters.value.yearTo
    return query
  }

  const load = async (reset: boolean): Promise<void> => {
    isLoading.value = true
    const currentOffset = reset ? 0 : offset.value
    try {
      const response = await $fetch<{ items: InscriptionSummary[]; hasMore: boolean }>(
        '/api/inscriptions',
        { query: queryFor(currentOffset) },
      )
      items.value = reset ? response.items : [...items.value, ...response.items]
      hasMore.value = response.hasMore
      offset.value = currentOffset + response.items.length
    } finally {
      isLoading.value = false
    }
  }

  // A filter change starts the list over — appending onto a differently
  // filtered page would interleave two unrelated result sets.
  watch(filters, () => load(true), { deep: true })

  const loadMore = (): Promise<void> => load(false)

  return { items, hasMore, isLoading, load, loadMore }
}
