/**
 * The years the period scrubber can stand on, fetched once per session.
 *
 * The scrubber used to move between three dates hardcoded in
 * `useBasemapStyle.ts`, because AWMC published exactly three extent files.
 * The series behind it now comes from OpenHistoricalMap and has 51 stops
 * (`19-ohm-empire-extents.ts`), so the list is data rather than a constant
 * and the client asks the server for it.
 *
 * Lazy on purpose: a reader who never opens the basemap switcher's antiquity
 * group never needs this, and it is the same reasoning that keeps the extent
 * tiles themselves out of the style until the scrubber is actually moved.
 */
export interface EmpirePeriodStep {
  year: number
  states: string[]
  endEvent: string | null
}

export const useEmpirePeriods = () => {
  const steps = useState<EmpirePeriodStep[]>('atlas-empire-periods', () => [])
  const hasLoaded = useState<boolean>('atlas-empire-periods-loaded', () => false)

  /**
   * Failure is silent and leaves the scrubber empty rather than throwing: the
   * period fill is one optional reading of one sheet, and an atlas that
   * cannot reach this endpoint should still draw its map.
   */
  const load = async (): Promise<void> => {
    if (hasLoaded.value) return
    try {
      steps.value = await $fetch<EmpirePeriodStep[]>('/api/atlas/empire-periods')
    } catch {
      steps.value = []
    } finally {
      hasLoaded.value = true
    }
  }

  return { steps, hasLoaded, load }
}

/**
 * "509 BCE" / "476 CE" — the era word comes from the caller's own translator,
 * since `av. J.-C.` and `v. Chr.` are not the same string and never were.
 * Year 0 does not exist in the traditional count the source uses, so no
 * special case is needed for it: nothing in the data carries it.
 */
export const formatPeriodYear = (
  year: number,
  translate: (key: string, named: Record<string, unknown>) => string,
): string =>
  year < 0
    ? translate('basemapSwitcher.periodYearBce', { year: Math.abs(year) })
    : translate('basemapSwitcher.periodYearCe', { year })
