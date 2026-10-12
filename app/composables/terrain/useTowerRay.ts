import type { MaybeRefOrGetter } from 'vue'
import type { CompassPoint, TowerRaySection } from '#shared/types'

/**
 * The ground along one compass line out from a frontier tower
 * (`/api/sites/:id/sightlines/ray`). Fetched when a direction is chosen, not with
 * the tower's answer: eight lines are most of a reader's curiosity at most one.
 */
export const useTowerRay = (
  siteId: MaybeRefOrGetter<number | null>,
  compass: MaybeRefOrGetter<CompassPoint | null>,
) => {
  const id = computed(() => toValue(siteId))
  const direction = computed(() => toValue(compass))

  const { data, status, error } = useLazyAsyncData<TowerRaySection | null>(
    () => `tower-ray-${id.value ?? 'none'}-${direction.value ?? 'none'}`,
    () => {
      if (id.value === null || direction.value === null) return Promise.resolve(null)
      return $fetch<TowerRaySection | null>(`/api/sites/${id.value}/sightlines/ray`, {
        query: { compass: direction.value },
      }).then(
        // A `null` answer arrives as 204 No Content, which `$fetch` reads as undefined.
        (answer) => answer ?? null,
      )
    },
    { watch: [id, direction], server: false, default: () => null },
  )

  const hasMounted = ref(false)
  const isLoading = computed(
    () =>
      hasMounted.value &&
      id.value !== null &&
      direction.value !== null &&
      status.value === 'pending',
  )
  const hasFailed = computed(() => status.value === 'error' || error.value !== undefined)

  onMounted(() => {
    hasMounted.value = true
  })

  return { ray: data, isLoading, hasFailed }
}
