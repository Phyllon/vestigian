import type { Sql } from 'postgres'
import type { ReferenceSearchLayer } from '#shared/types'
import {
  escapeLikePattern,
  FUZZY_RELEVANCE_CEILING,
  PREFIX_RELEVANCE,
  WORD_PREFIX_RELEVANCE,
} from './search-relevance'

/**
 * Every borrowed reference layer that has a name to search on. Adding a layer
 * here is half the work: it also needs a `vestigian_unaccent(<column>)` trigram
 * index (`0032_reference_search.sql`) and a switch in `useRevealSearchLayer`.
 *
 * Inscriptions are deliberately absent: 79,000 rows would bury everything else,
 * and they have their own browse pages (`/inscriptions`).
 */
export const REFERENCE_SEARCH_SOURCES: readonly {
  layer: ReferenceSearchLayer
  table: string
  column: string
}[] = [
  { layer: 'hillfort', table: 'antiquity_hillforts', column: 'name' },
  { layer: 'port', table: 'antiquity_ports', column: 'title' },
  { layer: 'monument', table: 'antiquity_monuments', column: 'name' },
  { layer: 'mint', table: 'antiquity_mints', column: 'name' },
  { layer: 'battle', table: 'antiquity_battles', column: 'title' },
  { layer: 'coin-hoard', table: 'antiquity_coin_hoards', column: 'name' },
  { layer: 'feature', table: 'antiquity_features', column: 'name' },
  { layer: 'tabula-place', table: 'tabula_peutingeriana_places', column: 'label' },
  { layer: 'survey-site', table: 'antiquity_survey_sites', column: 'name' },
]

const MAX_TOKENS = 6

/**
 * The words of a search term, lower-cased, with punctuation dropped. "Dun Mor,
 * Angus" and "dun mor angus" are the same search: the names in these layers
 * carry commas, brackets and county suffixes ("Dun Mor, Angus (Acharn)") that
 * nobody types. Letters and digits only, which is also what makes a token safe
 * to put in a LIKE or regex pattern without escaping. Accents are not removed
 * here — `vestigian_unaccent` does that in the database, with the same rules
 * the stored name was indexed under.
 */
export const tokeniseSearchTerm = (term: string): string[] =>
  (term.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TOKENS)

interface ReferenceSearchQuery {
  sql: Sql
  term: string
  limit: number
}

/**
 * One `UNION ALL` over every source, each branch capped at `limit` so a common
 * word cannot let one layer starve the rest, then ranked together on the
 * shared relevance scale (`search-relevance.ts`):
 *
 * - `1`   the name starts with the whole term as typed
 * - `0.9` every word typed begins a word of the name
 * - `<=0.8` a word appears inside a longer one, or a trigram near-miss
 *
 * A candidate must contain every word (any position, which the trigram index
 * can serve) or be a trigram near-miss of the whole term (misspellings).
 */
export const buildReferenceSearchQuery = ({ sql, term, limit }: ReferenceSearchQuery) => {
  const tokens = tokeniseSearchTerm(term)
  const phrase = escapeLikePattern(term.trim())
  const fold = (value: string) => sql`vestigian_unaccent(${value})`

  const branches = REFERENCE_SEARCH_SOURCES.map(({ layer, table, column }) => {
    const nameColumn = sql(`t.${column}`)
    const name = sql`vestigian_unaccent(${nameColumn})`
    const containsEveryWord = tokens
      .map((token) => sql`${name} ILIKE '%' || ${fold(token)} || '%'`)
      .reduce((all, next) => sql`${all} AND ${next}`)
    const startsEveryWord = tokens
      .map((token) => sql`${name} ~* ('\\m' || ${fold(token)})`)
      .reduce((all, next) => sql`${all} AND ${next}`)

    return sql`(
      SELECT ${layer}::text AS layer, t.id, ${nameColumn} AS title,
        ST_X(t.geom) AS lon, ST_Y(t.geom) AS lat,
        (CASE
          WHEN ${name} ILIKE ${fold(phrase)} || '%' THEN ${PREFIX_RELEVANCE}::float8
          WHEN ${startsEveryWord} THEN ${WORD_PREFIX_RELEVANCE}::float8
          WHEN ${containsEveryWord} THEN ${FUZZY_RELEVANCE_CEILING}::float8
          ELSE LEAST(similarity(${name}, ${fold(term.trim())}), ${FUZZY_RELEVANCE_CEILING}::float8)
        END) AS relevance
      FROM ${sql(table)} t
      WHERE (${containsEveryWord}) OR ${name} % ${fold(term.trim())}
      ORDER BY relevance DESC, t.id
      LIMIT ${limit}
    )`
  })

  const union = branches.reduce((all, next) => sql`${all} UNION ALL ${next}`)

  return sql<
    {
      layer: ReferenceSearchLayer
      id: number
      title: string
      lon: number
      lat: number
      relevance: number
    }[]
  >`
    SELECT * FROM (${union}) ranked
    ORDER BY relevance DESC, title
    LIMIT ${limit}
  `
}
