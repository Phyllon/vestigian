import type { MaybeRefOrGetter } from 'vue'
import type { ElevationProfile } from '#shared/types'

/**
 * The relief along a line tracing (`/api/tracings/:id/profile`). Lazy and
 * client-only; null for an area, which is an ordinary answer and says nothing.
 */
export const useTracingProfile = (tracingId: MaybeRefOrGetter<number | null>) => {
  const id = computed(() => toValue(tracingId))

  const { data, status, error } = useLazyAsyncData<ElevationProfile | null>(
    () => `tracing-profile-${id.value ?? 'none'}`,
    () => {
      const value = id.value
      return value === null
        ? Promise.resolve(null)
        : $fetch<ElevationProfile | null>(`/api/tracings/${value}/profile`).then(
            // A `null` answer arrives as 204 No Content, which `$fetch` reads as undefined.
            (answer) => answer ?? null,
          )
    },
    { watch: [id], server: false, default: () => null },
  )

  // Not "loading" until mounted: the server never fetches (`server: false`), so a
  // client that rendered a skeleton on its first pass would disagree with the
  // markup it is hydrating.
  const hasMounted = ref(false)
  const isLoading = computed(
    () => hasMounted.value && id.value !== null && status.value === 'pending',
  )
  const hasFailed = computed(() => status.value === 'error' || error.value !== undefined)

  return { profile: data, isLoading, hasFailed }
}
