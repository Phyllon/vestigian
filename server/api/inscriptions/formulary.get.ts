import type { InscriptionFormulaEntry } from '#shared/types'

const CACHE_KEY = 'vestigian:epigraphy:formulary:v1'
/** Derived from `inscriptions`, which only changes on a re-import — a plain
 *  TTL is enough, unlike the tile cache's version counter, which exists
 *  because tiles are read on every map pan and re-importing is comparatively
 *  frequent. Neither is true here: one reference page, read occasionally. */
const CACHE_TTL_SECONDS = 86400

defineRouteMeta({
  openAPI: {
    tags: ['inscriptions'],
    summary: 'Frequency-ranked abbreviation formulary across the mirrored corpus',
    description:
      "Aggregated from every mirrored inscription's own parsed abbreviation markup — not a separate source.",
  },
})

/**
 * Raw SQL, not the query builder: this reads every abbreviation token out of
 * `text_edition`'s nested jsonb arrays via `jsonb_array_elements` twice
 * (lines, then tokens) and groups across the unnested rows — an aggregate
 * shape Drizzle's query builder has no portable way to express, the same
 * kind of exception this project already makes for PostGIS. Measured at
 * ~1s against the full 79,201-row table (`EXPLAIN ANALYZE`, not guessed),
 * which is why this is cached rather than run per request.
 */
export default defineEventHandler(async (event): Promise<InscriptionFormulaEntry[]> => {
  await enforceRateLimit(event, 'record')
  const redis = useRedis()

  try {
    const cached = await redis.get(CACHE_KEY)
    if (cached) return JSON.parse(cached) as InscriptionFormulaEntry[]
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'formulary cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()
  const rows = await sql<
    { abbr: string; expansion: string; count: number; exampleEdhId: string }[]
  >`
    SELECT
      token->>'abbr' AS abbr,
      token->>'expansion' AS expansion,
      count(*)::int AS count,
      min(edh_id) AS "exampleEdhId"
    FROM inscriptions,
         jsonb_array_elements(text_edition) AS line,
         jsonb_array_elements(line->'tokens') AS token
    WHERE text_edition IS NOT NULL
      AND token ? 'abbr'
      AND token->>'expansion' IS NOT NULL
    GROUP BY token->>'abbr', token->>'expansion'
    ORDER BY count DESC
    LIMIT 20
  `

  try {
    await redis.set(CACHE_KEY, JSON.stringify(rows), 'EX', CACHE_TTL_SECONDS)
  } catch (error) {
    event.context.log?.warn({ err: { message: (error as Error).message } }, 'formulary not cached')
  }

  return rows
})
