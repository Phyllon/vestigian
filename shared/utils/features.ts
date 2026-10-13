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
export const FEATURE_IDS = ['towerSightlines'] as const
export type FeatureId = (typeof FEATURE_IDS)[number]

/** What the button turns on before it opens the example, named so the page can say so. */
export type FeatureStepId = 'sites' | 'record' | 'view'

export interface FeatureExample {
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
    example: { siteSlug: 'turm-3-25', siteTitle: 'Turm 3-25', zoom: 15 },
    steps: ['sites', 'record', 'view'],
  },
]
