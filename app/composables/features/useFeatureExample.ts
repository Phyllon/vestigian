import type { LimesSector, SiteDetail } from '#shared/types'
import type { FeatureEntry, SectorFeatureExample, SiteFeatureExample } from '#shared/utils/features'

export type FeatureExampleStatus = 'idle' | 'opening' | 'missing' | 'failed'

/**
 * Opens a feature on a real record (or, for a frontier feature, a real sector): switches on what has to be on to see it,
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
  const { requestSectorWatchOpen } = useSectorWatchOpenRequest()
  const { showSectorOnMap } = useShowSectorOnMap()
  const { selectSite } = useSiteQuery()
  const { requestFocus } = useMapFocus()

  const status = ref<FeatureExampleStatus>('idle')

  const openSite = async (example: SiteFeatureExample): Promise<void> => {
    let site: SiteDetail
    try {
      site = await $fetch<SiteDetail>(`/api/sites/slug/${encodeURIComponent(example.siteSlug)}`)
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      status.value = statusCode === 404 ? 'missing' : 'failed'
      return
    }

    const { lat, lon } = site.position
    const { zoom } = example

    // Everything the feature needs to be visible. Each is the switch a reader
    // would reach by hand; none is persisted, so a reload returns to a clean map.
    setSitesActive(true)
    selectSite(site.id)
    requestFocus({ center: { lat, lon }, zoom })

    await navigateTo(`/#map=${zoom.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}`)
    status.value = 'idle'
  }

  /**
   * The sector is looked up in the list **before** anything is switched on, for
   * the same reason a record is fetched first: a sector absent from this atlas
   * (a database without `import:limes`) leaves the map as it was.
   */
  const openSector = async (example: SectorFeatureExample): Promise<void> => {
    let sectors: LimesSector[]
    try {
      sectors = await $fetch<LimesSector[]>('/api/limes/sectors')
    } catch {
      status.value = 'failed'
      return
    }
    const sector = sectors.find((entry) => entry.slug === example.sectorSlug)
    if (!sector) {
      status.value = 'missing'
      return
    }

    // The panel's own sector section is closed on the map; the example is about it.
    requestSectorWatchOpen(sector.slug)
    await showSectorOnMap({ sector, zoom: example.zoom })
    status.value = 'idle'
  }

  const open = async (feature: FeatureEntry): Promise<void> => {
    if (status.value === 'opening') return
    status.value = 'opening'

    const { example } = feature
    if (example.kind === 'site') await openSite(example)
    else await openSector(example)
  }

  return { status: readonly(status), open }
}
