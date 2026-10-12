/**
 * The organisations the partners page lists — sources that have agreed terms
 * with us and chosen to be shown, as opposed to the many we credit on
 * "Data & licences" because their licence asks for it and nothing more.
 * See `documents/source-permissions/00-visual-promotion-proposal.md` and
 * `.claude/rules/partners.md`.
 *
 * Only what is the same in every language lives here. A partner's own words
 * ("in their words"), and what we draw from them, are in the six locale files
 * under `partnersPage.entries.<id>`, because they are written once and translated
 * with their approval.
 */
export type PartnerKind = 'database' | 'association' | 'museum'

export interface PartnerMark {
  /** Served from our own origin, under `/partner-assets/` — not `/partners/`, which would put a directory under the page's own URL and make the server redirect the page to a trailing slash. Never a link to their server. */
  path: string
  /**
   * Drawn in the page's ink (a mask over the file's shape) so no partner colour competes
   * with the one accent the design allows per screen. `false` when their guidelines
   * forbid recolouring: the file is then shown as supplied.
   */
  isRecolourable: boolean
}

export interface PartnerRecord {
  /** Lower-case slug: the anchor on the page and the key under `partnersPage.entries`. */
  id: string
  /** The organisation's own name, never translated. */
  name: string
  url: string
  kind: PartnerKind
  mark?: PartnerMark
  /** How many of their records are drawn, when that is a number worth stating. */
  recordCount?: number
  /** The citation they asked for, verbatim and in their language. */
  citation: string
  /** Invented, there to show the layout. Never listed on a visitor-facing deployment. */
  isExample?: boolean
}

/**
 * Empty until a source has said yes in writing and asked to be listed. Adding one
 * takes an entry here and `about` + `drawn` under `partnersPage.entries.<id>` in
 * all six locales, the wording approved by the partner.
 */
export const PARTNERS: readonly PartnerRecord[] = []

/**
 * Invented organisations, on `example.org` (reserved for documentation), so the page
 * can be seen and tested before a real partner exists. No real organisation is
 * imitated; the page says so wherever they appear.
 */
export const EXAMPLE_PARTNERS: readonly PartnerRecord[] = [
  {
    id: 'example-harbours',
    name: 'Example Harbours Database',
    url: 'https://example.org/harbours',
    kind: 'database',
    mark: { path: '/partner-assets/examples/harbours.svg', isRecolourable: true },
    recordCount: 1240,
    citation: 'Example Harbours Database, ed. A. Sample (2026). https://example.org/harbours',
    isExample: true,
  },
  {
    id: 'example-frontier-society',
    name: 'Example Frontier Society',
    url: 'https://example.org/frontier',
    kind: 'association',
    mark: { path: '/partner-assets/examples/frontier.svg', isRecolourable: true },
    citation:
      'Course of the frontier: Example Frontier Society e. V., https://example.org/frontier',
    isExample: true,
  },
  {
    id: 'example-coin-finds',
    name: 'Example Museum of Coin Finds',
    url: 'https://example.org/coins',
    kind: 'museum',
    // Coloured and not to be recoloured: the one case the page shows a mark as supplied.
    mark: { path: '/partner-assets/examples/coins.svg', isRecolourable: false },
    recordCount: 18730,
    citation: 'Example Museum of Coin Finds, find records (CC BY 4.0), https://example.org/coins',
    isExample: true,
  },
]

export interface ListPartnersOptions {
  /** Include the invented partners. Development and the end-to-end build only. */
  includeExamples: boolean
}

const nameCollator = new Intl.Collator('en', { sensitivity: 'base' })

/**
 * Alphabetical by name, always. The proposal promises no ranking and no paid
 * placement; an order that follows the data file, or the date of agreement, would
 * quietly be both. Sorting here — not in the data file — is what keeps the promise
 * true when someone adds an entry in the wrong place.
 */
export const listPartners = ({ includeExamples }: ListPartnersOptions): PartnerRecord[] => {
  const all = includeExamples ? [...PARTNERS, ...EXAMPLE_PARTNERS] : [...PARTNERS]
  return all.sort((first, second) => nameCollator.compare(first.name, second.name))
}
