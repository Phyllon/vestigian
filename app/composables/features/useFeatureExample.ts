import type { SiteDetail } from '#shared/types'
import type { FeatureEntry } from '#shared/utils/features'

export type FeatureExampleStatus = 'idle' | 'opening' | 'missing' | 'failed'

/**
 * Opens a feature on a real record: switches on what has to be on to see it,
 * selects the record, asks the camera for its icon, and goes to the map.
 *
 * The order is the point. The record is fetched **first** and nothing is
 * changed until it is in hand, so a record that is not in this atlas (a
 * production database imported without it) leaves the reader's map exactly as
 * it was instead of stranding them on `/` with the sites layer switched on and
 * nothing selected. The switches are `useState`, which survives the client-side
 * navigation (see `useMapFocus`); a hard navigation would drop them, which is
 * why this goes through `navigateTo` and never a plain link.
 *
 * The URL carries the camera too (`/#map=…`), the same hash the "Show on the
 * map" button writes: the first frame is already over the record, and the
 * address a reader copies from here is one they can send.
 */
export const useFeatureExample = () => {
  const { setSitesActive } = useBasemapStyle()
  const { selectSite } = useSiteQuery()
  const { requestFocus } = useMapFocus()

  const status = ref<FeatureExampleStatus>('idle')

  const open = async (feature: FeatureEntry): Promise<void> => {
    if (status.value === 'opening') return
    status.value = 'opening'

    let site: SiteDetail
    try {
      site = await $fetch<SiteDetail>(
        `/api/sites/slug/${encodeURIComponent(feature.example.siteSlug)}`,
      )
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      status.value = statusCode === 404 ? 'missing' : 'failed'
      return
    }

    const { lat, lon } = site.position
    const { zoom } = feature.example

    // Everything the feature needs to be visible. Each is the switch a reader
    // would reach by hand; none is persisted, so a reload returns to a clean map.
    setSitesActive(true)
    selectSite(site.id)
    requestFocus({ center: { lat, lon }, zoom })

    await navigateTo(`/#map=${zoom.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}`)
    status.value = 'idle'
  }

  return { status: readonly(status), open }
}
