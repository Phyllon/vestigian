import type { SiteDetail } from '#shared/types'

/**
 * "Found this useful" — one toggle, driven directly off whichever `SiteDetail`
 * ref the caller already has.
 *
 * Unlike `useNotebook`'s map-wide visit/bookmark state, this needs no shared
 * cross-component store: `SiteDetailPanel` and `/site/[slug]` each hold their
 * own independent fetch of the same record (see `useSiteQuery` versus that
 * page's own `useFetch`), and an endorsement only ever needs to update the one
 * `SiteDetail` object the caller is already looking at.
 */
export const useSiteEndorsement = (site: Ref<SiteDetail | null>) => {
  const { loggedIn } = useSession()
  const isSaving = ref(false)

  const toggle = async (): Promise<void> => {
    const current = site.value
    if (!current || !loggedIn.value || isSaving.value) return

    const wasEndorsed = current.endorsedByMe
    const optimisticCount = current.endorsementCount + (wasEndorsed ? -1 : 1)

    // Written eagerly so the button feels immediate; corrected below from
    // whatever the server actually settled on, and rolled all the way back
    // on failure.
    site.value = { ...current, endorsedByMe: !wasEndorsed, endorsementCount: optimisticCount }

    isSaving.value = true
    try {
      const response = await $fetch<{ count: number; endorsedByMe: boolean }>(
        `/api/sites/${current.id}/endorse`,
        { method: wasEndorsed ? 'DELETE' : 'POST' },
      )
      // The reader may have opened a different site while this was in flight.
      if (site.value?.id === current.id) {
        site.value = {
          ...site.value,
          endorsementCount: response.count,
          endorsedByMe: response.endorsedByMe,
        }
      }
    } catch (error) {
      if (site.value?.id === current.id) {
        site.value = {
          ...site.value,
          endorsedByMe: wasEndorsed,
          endorsementCount: current.endorsementCount,
        }
      }
      throw error
    } finally {
      isSaving.value = false
    }
  }

  return { toggle, isSaving }
}
