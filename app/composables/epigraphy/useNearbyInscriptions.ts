import type { MaybeRefOrGetter } from 'vue'
import type { NearbyInscription } from '#shared/types'

interface UseNearbyInscriptionsOptions {
  /** Template-literals into the endpoint path — `'site'` → `/api/sites/:id/inscriptions`. */
  kind: 'site' | 'tracing'
  id: MaybeRefOrGetter<number | null>
}

/**
 * Mirrored EDH inscriptions found near a site or a tracing
 * (`server/utils/inscriptions.ts`) — lazy, same shape as `useSiteEnrichment`:
 * a fast local query, fetched only once the panel is actually open, kept off
 * the main record payload.
 */
export const useNearbyInscriptions = ({ kind, id }: UseNearbyInscriptionsOptions) => {
  const recordId = computed(() => toValue(id))

  const { data: inscriptions, status } = useLazyAsyncData<NearbyInscription[]>(
    () => `${kind}-nearby-inscriptions-${recordId.value ?? 'none'}`,
    () => {
      const value = recordId.value
      return value === null
        ? Promise.resolve([])
        : $fetch<NearbyInscription[]>(`/api/${kind}s/${value}/inscriptions`)
    },
    { watch: [recordId], server: false, default: () => [] },
  )

  const isLoading = computed(() => recordId.value !== null && status.value === 'pending')

  return { inscriptions, isLoading }
}
