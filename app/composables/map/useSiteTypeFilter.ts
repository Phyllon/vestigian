import type { FilterSpecification } from 'maplibre-gl'
import type { SiteCategory } from '#shared/types'
import {
  buildSiteTypeFilter,
  buildTracingTypeFilter,
  countSelectedSubtypes,
  selectedSubtypesOf,
  setSelectedSubtypes,
} from '#shared/utils/site-type-filter'

/**
 * Which kinds of vici site the reader has narrowed the map to — see
 * `shared/utils/site-type-filter.ts` for what a selection means. Empty is the
 * default and means every site.
 *
 * Not persisted, like the switches in `useBasemapStyle`: a shared link should
 * not carry a previous visitor's narrowing, and nothing is written to storage
 * that `privacy.cookiesBody` would then have to disclose.
 *
 * **While a selection is held the sites are drawn as individual markers at
 * every zoom, whatever the "every site" setting says** (`isShowingClusters` in
 * `useViewportTiles`). A counted cluster is a count of everything beneath it;
 * the tile cannot say how many of those are temples, so a filtered map drawing
 * clusters would count sites the reader asked not to see. The setting itself
 * is left alone and comes back when the selection is cleared.
 */
export const useSiteTypeFilter = () => {
  const selection = useState<string[]>('site-type-filter', () => [])

  const isFiltering = computed(() => selection.value.length > 0)
  const selectedCount = computed(() => countSelectedSubtypes(selection.value))

  const siteFilter = computed(
    () => buildSiteTypeFilter(selection.value) as FilterSpecification | null,
  )
  const tracingFilter = computed(
    () => buildTracingTypeFilter(selection.value) as FilterSpecification | null,
  )

  const getSelectedSubtypes = (category: SiteCategory): string[] =>
    selectedSubtypesOf(selection.value, category)

  const setSubtypes = (category: SiteCategory, subtypes: readonly string[]): void => {
    selection.value = setSelectedSubtypes(selection.value, category, subtypes)
  }

  const clear = (): void => {
    selection.value = []
  }

  return {
    selection,
    isFiltering,
    selectedCount,
    siteFilter,
    tracingFilter,
    getSelectedSubtypes,
    setSubtypes,
    clear,
  }
}
