import type { Sql } from 'postgres'

/**
 * One relevance scale for every name the map search bar can return, so results
 * from different tables can be ranked against each other.
 *
 * Each endpoint used to rank only within its own table and the client
 * concatenated the three lists, so "vitud" listed a trigram near-miss from the
 * modern gazetteer (Vite) above the ancient name it was a prefix of
 * (Vitudurum), purely because modern places came first in the array.
 *
 * - `1`   the name starts with the term
 * - `0.9` a later word of the name starts with the term
 * - `<=0.8` trigram similarity, the fallback for misspellings
 *
 * The bands are what lets the client drop fuzzy matches once a real one exists
 * (see `rankSearchResults`).
 */
export const PREFIX_RELEVANCE = 1
export const WORD_PREFIX_RELEVANCE = 0.9
export const FUZZY_RELEVANCE_CEILING = 0.8

/** `%`, `_` and the escape character are literals in what a reader typed. */
export const escapeLikePattern = (term: string): string => term.replace(/[\\%_]/g, '\\$&')

interface RelevanceQuery {
  sql: Sql
  /** A column reference such as `c.name`, never user input. */
  column: string
  term: string
}

export const buildRelevance = ({ sql, column, term }: RelevanceQuery) => {
  const escaped = escapeLikePattern(term)
  return sql`(
    CASE
      WHEN ${sql(column)} ILIKE ${escaped + '%'} THEN ${PREFIX_RELEVANCE}::float8
      WHEN ${sql(column)} ILIKE ${'% ' + escaped + '%'}
        OR ${sql(column)} ILIKE ${'%-' + escaped + '%'} THEN ${WORD_PREFIX_RELEVANCE}::float8
      ELSE LEAST(similarity(${sql(column)}, ${term}), ${FUZZY_RELEVANCE_CEILING}::float8)
    END
  )`
}
