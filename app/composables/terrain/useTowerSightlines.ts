import type { MaybeRefOrGetter } from 'vue'
import type { TowerSightlines } from '#shared/types'

/**
 * The calculated view from a frontier watchtower (`/api/sites/:id/sightlines`).
 * Lazy and client-only, like the other panel sections: most records are not
 * towers and the answer is null, and nothing else on the panel waits for it.
 *
 * `hasFailed` is not "no answer": null is an ordinary result for a site that is
 * not on a frontier, and the section stays silent for it. A failure (the terrain
 * could not be read) is said once, so the absence is not mistaken for a verdict.
 */
export const useTowerSightlines = (siteId: MaybeRefOrGetter<number | null>) => {
  const id = computed(() => toValue(siteId))

  const { data, status, error } = useLazyAsyncData<TowerSightlines | null>(
    () => `tower-sightlines-${id.value ?? 'none'}`,
    () => {
      const value = id.value
      return value === null
        ? Promise.resolve(null)
        : $fetch<TowerSightlines | null>(`/api/sites/${value}/sightlines`).then(
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

  return { sightlines: data, isLoading, hasFailed }
}
