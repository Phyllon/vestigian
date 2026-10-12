import type { MaybeRefOrGetter } from 'vue'
import type { SectorWatchSummary } from '#shared/types'

/**
 * What a sector's towers could do together (`/api/limes/sectors/:slug/sightlines`)
 * — the summary only. Lazy and client-only like the other sections; null is an
 * ordinary answer for a sector the script has not been run for, and the section
 * stays silent.
 */
export const useSectorWatch = (slug: MaybeRefOrGetter<string | null>) => {
  const sectorSlug = computed(() => toValue(slug))

  const { data, status, error } = useLazyAsyncData<SectorWatchSummary | null>(
    () => `sector-watch-${sectorSlug.value ?? 'none'}`,
    () => {
      const value = sectorSlug.value
      return value === null
        ? Promise.resolve(null)
        : $fetch<SectorWatchSummary | null>(`/api/limes/sectors/${value}/sightlines`).then(
            // A `null` answer arrives as 204 No Content, which `$fetch` reads as undefined.
            (answer) => answer ?? null,
          )
    },
    { watch: [sectorSlug], server: false, default: () => null },
  )

  const hasMounted = ref(false)
  const isLoading = computed(
    () => hasMounted.value && sectorSlug.value !== null && status.value === 'pending',
  )
  const hasFailed = computed(() => status.value === 'error' || error.value !== undefined)

  onMounted(() => {
    hasMounted.value = true
  })

  return { summary: data, isLoading, hasFailed }
}
