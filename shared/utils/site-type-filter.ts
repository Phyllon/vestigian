import type { SiteCategory } from '../types/site'

/**
 * Which kinds of site the reader wants to see, and the MapLibre filters that
 * follow from it. Pure on purpose: the map code only asks for a filter, and the
 * rules about what a selection means live (and are tested) here.
 *
 * **A selection is a list of keys, and an empty one means "no filter".** A
 * reader who has chosen nothing sees every site, so the filter is something
 * they add rather than a set of switches that all start on. A key is either a
 * whole category (`fortification`) or one of vici's own kinds inside it
 * (`fortification:fort`). A whole-category key is what keeps a record whose kind
 * vici left blank, or that a contributor typed freely, on the map while its
 * category is chosen; a kind key matches that kind only.
 */

/**
 * vici's own kinds, grouped under the nine categories this atlas draws. This
 * is the vocabulary `scripts/import/02-mysql-to-postgres.ts` maps from
 * (`CATEGORY_BY_KIND`), in the order a reader would look for them. A kind not
 * listed still belongs to its category and is reached through the category.
 */
export const SITE_TYPE_GROUPS: ReadonlyArray<{
  category: SiteCategory
  subtypes: readonly string[]
}> = [
  { category: 'settlement', subtypes: ['city', 'vicus'] },
  { category: 'fortification', subtypes: ['fort', 'watchtower', 'camp'] },
  { category: 'sanctuary', subtypes: ['temple', 'altar'] },
  { category: 'burial', subtypes: ['graves'] },
  { category: 'infrastructure', subtypes: ['road', 'bridge', 'milestone', 'aquaduct', 'mansio'] },
  { category: 'villa', subtypes: ['villa'] },
  { category: 'production', subtypes: ['industry'] },
  { category: 'findspot', subtypes: ['observation', 'object', 'shipwreck'] },
  {
    category: 'other',
    subtypes: ['baths', 'theater', 'museum', 'building', 'rural', 'memorial', 'event'],
  },
]

export type SiteTypeSelection = readonly string[]

const SUBTYPE_SEPARATOR = ':'

export const siteTypeKey = (category: SiteCategory, subtype?: string): string =>
  subtype === undefined ? category : `${category}${SUBTYPE_SEPARATOR}${subtype}`

interface ParsedSelection {
  /** Categories chosen whole. */
  categories: Set<string>
  /** Kinds chosen one by one, by category. A category chosen whole is not in here. */
  subtypesByCategory: Map<string, Set<string>>
}

const parseSelection = (selection: SiteTypeSelection): ParsedSelection => {
  const categories = new Set<string>()
  const subtypesByCategory = new Map<string, Set<string>>()

  for (const key of selection) {
    const separatorIndex = key.indexOf(SUBTYPE_SEPARATOR)
    if (separatorIndex === -1) {
      categories.add(key)
      continue
    }
    const category = key.slice(0, separatorIndex)
    const subtype = key.slice(separatorIndex + 1)
    const subtypes = subtypesByCategory.get(category) ?? new Set<string>()
    subtypes.add(subtype)
    subtypesByCategory.set(category, subtypes)
  }

  // A category chosen whole already holds every one of its kinds.
  for (const category of categories) subtypesByCategory.delete(category)

  return { categories, subtypesByCategory }
}

const subtypesOf = (category: SiteCategory): readonly string[] =>
  SITE_TYPE_GROUPS.find((group) => group.category === category)?.subtypes ?? []

/** The kinds of one category the selection shows, in the order the group lists them. */
export const selectedSubtypesOf = (
  selection: SiteTypeSelection,
  category: SiteCategory,
): string[] => {
  const { categories, subtypesByCategory } = parseSelection(selection)
  const all = subtypesOf(category)
  if (categories.has(category)) return [...all]
  const chosen = subtypesByCategory.get(category)
  return chosen ? all.filter((subtype) => chosen.has(subtype)) : []
}

const isKeyOf = (key: string, category: SiteCategory): boolean =>
  key === category || key.startsWith(`${category}${SUBTYPE_SEPARATOR}`)

/**
 * Replaces one category's chosen kinds, leaving every other category alone.
 * Choosing all of a category's listed kinds stores the category itself, so the
 * kinds the list does not name come with it; choosing none removes it.
 */
export const setSelectedSubtypes = (
  selection: SiteTypeSelection,
  category: SiteCategory,
  subtypes: readonly string[],
): string[] => {
  const known = subtypesOf(category)
  const chosen = known.filter((subtype) => subtypes.includes(subtype))
  const others = selection.filter((key) => !isKeyOf(key, category))

  if (chosen.length === 0) return others
  if (chosen.length === known.length) return [...others, siteTypeKey(category)]
  return [...others, ...chosen.map((subtype) => siteTypeKey(category, subtype))]
}

/** How many of the listed kinds the selection shows — the number on the control. */
export const countSelectedSubtypes = (selection: SiteTypeSelection): number =>
  SITE_TYPE_GROUPS.reduce(
    (total, group) => total + selectedSubtypesOf(selection, group.category).length,
    0,
  )

/**
 * `null` when nothing is chosen, which `setFilter` and the layer builders read
 * as "no filter". `match` is a hash lookup per feature; `to-string` turns a
 * missing kind into `''` instead of a type error, so a record with no kind is
 * simply not one of the chosen kinds.
 */
export const buildSiteTypeFilter = (selection: SiteTypeSelection): unknown[] | null => {
  const { categories, subtypesByCategory } = parseSelection(selection)
  const clauses: unknown[] = []

  if (categories.size > 0) {
    clauses.push(['match', ['to-string', ['get', 'category']], [...categories], true, false])
  }

  for (const [category, subtypes] of subtypesByCategory) {
    clauses.push([
      'all',
      ['==', ['to-string', ['get', 'category']], category],
      ['match', ['to-string', ['get', 'subcategory']], [...subtypes], true, false],
    ])
  }

  if (clauses.length === 0) return null
  return clauses.length === 1 ? (clauses[0] as unknown[]) : ['any', ...clauses]
}

/**
 * Tracings carry a category and no kind, so they follow the categories the
 * selection touches: choosing a temple keeps the sanctuary tracings, and no
 * more. Without it a map filtered to one kind of site still draws every
 * line on it.
 */
export const buildTracingTypeFilter = (selection: SiteTypeSelection): unknown[] | null => {
  const { categories, subtypesByCategory } = parseSelection(selection)
  const touched = new Set<string>([...categories, ...subtypesByCategory.keys()])
  if (touched.size === 0) return null
  return ['match', ['to-string', ['get', 'category']], [...touched], true, false]
}
