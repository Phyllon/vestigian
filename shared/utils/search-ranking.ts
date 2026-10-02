import type { MapSearchResult } from '#shared/types'

/** Matches at or above this score are real name matches (prefix or word-prefix), not trigram guesses. */
const NAME_MATCH_FLOOR = 0.9

/**
 * Merges the site, modern-place and ancient-place lists into one ranked list.
 *
 * The three endpoints each rank within their own table; concatenating them put
 * whichever table came first on top regardless of how well it matched. Sorting
 * on the shared `relevance` scale (`server/utils/search-relevance.ts`) fixes
 * the order, and the sort is stable, so equal scores keep the order they
 * arrived in — which is what preserves "London before Londa" (population)
 * inside the prefix band.
 *
 * Once anything matches by name, trigram-only results are dropped: "vitud"
 * should offer Vitudurum, not Vite and Vitsa after it. They stay when nothing
 * matches by name, which is the misspelling case the fuzzy search exists for.
 */
export const rankSearchResults = (results: MapSearchResult[]): MapSearchResult[] => {
  const scored = results.map((result) => ({ result, score: result.relevance ?? 0 }))
  const hasNameMatch = scored.some((entry) => entry.score >= NAME_MATCH_FLOOR)

  return scored
    .filter((entry) => !hasNameMatch || entry.score >= NAME_MATCH_FLOOR)
    .toSorted((a, b) => b.score - a.score)
    .map((entry) => entry.result)
}
