/**
 * The features the "Features" page presents, as data.
 *
 * Only what is not translatable lives here: which record a feature is shown on,
 * how close the camera goes, and what has to be on for it to be visible. The
 * words are `featuresPage.features.<id>.*` in the six locale catalogues.
 *
 * Adding a feature is an entry here, its strings in all six catalogues, and —
 * if showing it needs a switch the example does not already flip — a line in
 * `useFeatureExample`. The page itself needs no change.
 */
export const FEATURE_IDS = ['towerSightlines', 'sectorWatch'] as const
export type FeatureId = (typeof FEATURE_IDS)[number]

/** What the button turns on before it opens the example, named so the page can say so. */
export type FeatureStepId = 'sites' | 'record' | 'view' | 'frontier' | 'sector' | 'watch'

/** An example that opens one record, by slug. */
export interface SiteFeatureExample {
  kind: 'site'
  /**
   * The record the example opens, by slug: ids are reassigned by a re-import,
   * slugs never change on edit. Resolved through `/api/sites/slug/:slug`.
   */
  siteSlug: string
  /** The record's own title, for the sentence that names it. */
  siteTitle: string
  /** How close the camera goes — close enough that the record's icon is the thing in view. */
  zoom: number
}

/** An example that opens one frontier sector in the frontier panel. */
export interface SectorFeatureExample {
  kind: 'sector'
  /** The sector's slug, found in `/api/limes/sectors`; slugs are stable across `import:limes`. */
  sectorSlug: string
  /** The sector's own name, for the sentence that names it. */
  sectorTitle: string
  /** A zoom at which the sector's stretch fills a phone's width. */
  zoom: number
}

export type FeatureExample = SiteFeatureExample | SectorFeatureExample

/** What the sentence that names the example calls it. */
export const featureExampleTitle = (example: FeatureExample): string =>
  example.kind === 'site' ? example.siteTitle : example.sectorTitle

export interface FeatureEntry {
  id: FeatureId
  /** A Lucide icon name, as the rest of the interface uses (`i-lucide-*`). */
  icon: string
  example: FeatureExample
  /** In the order the button does them. */
  steps: readonly FeatureStepId[]
}

export const FEATURES: readonly FeatureEntry[] = [
  {
    id: 'towerSightlines',
    icon: 'i-lucide-eye',
    // A tower on the Upper German Limes, in the Taunus — the one the end-to-end
    // suite already reads. It is on a sector, so the calculation answers for it.
    example: { kind: 'site', siteSlug: 'turm-3-25', siteTitle: 'Turm 3-25', zoom: 15 },
    steps: ['sites', 'record', 'view'],
  },
  {
    id: 'sectorWatch',
    icon: 'i-lucide-radar',
    // Bavaria, 55 recorded towers and the spacing reading — large enough to
    // have a chain, breaks and blind stretches, small enough to build quickly.
    example: {
      kind: 'sector',
      sectorSlug: 'limes-raeticus',
      sectorTitle: 'Raetian Limes',
      zoom: 8,
    },
    steps: ['frontier', 'sector', 'watch'],
  },
]
