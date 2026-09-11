import type { MaybeRefOrGetter } from 'vue'
import type { NearbyAtticInscription } from '#shared/types'

interface UseNearbyAtticInscriptionsOptions {
  /** Template-literals into the endpoint path — `'site'` → `/api/sites/:id/attic-inscriptions`. */
  kind: 'site' | 'tracing'
  id: MaybeRefOrGetter<number | null>
}

/** Attic Inscriptions Online found near a site or a tracing, same shape as
 *  `useNearbyInscriptions` for the EDH corpus. */
export const useNearbyAtticInscriptions = ({ kind, id }: UseNearbyAtticInscriptionsOptions) => {
  const recordId = computed(() => toValue(id))

  const { data: inscriptions, status } = useLazyAsyncData<NearbyAtticInscription[]>(
    () => `${kind}-nearby-attic-inscriptions-${recordId.value ?? 'none'}`,
    () => {
      const value = recordId.value
      return value === null
        ? Promise.resolve([])
        : $fetch<NearbyAtticInscription[]>(`/api/${kind}s/${value}/attic-inscriptions`)
    },
    { watch: [recordId], server: false, default: () => [] },
  )

  const isLoading = computed(() => recordId.value !== null && status.value === 'pending')

  return { inscriptions, isLoading }
}
