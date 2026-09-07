/**
 * The steps the period scrubber can stand on — every year at which the
 * Roman state's mapped extent actually changes.
 *
 * The three-snapshot scrubber this replaces could hardcode its dates in the
 * client, because there were three of them and they were a property of which
 * files AWMC happened to publish. There are now 51, they come from the
 * imported data, and they move whenever OpenHistoricalMap's contributors
 * refine a boundary — so the client asks rather than assumes.
 *
 * One row per distinct `start_year`: the moment the map changes, which is
 * what a scrubber step means. Where two states are live at once (the Western
 * and Eastern empires after 395) their names are joined, since the reader is
 * standing on one year and looking at both fills.
 */
interface EmpirePeriodStep {
  year: number
  /** The state(s) whose extent is drawn at this step. */
  states: string[]
  /** OHM's narrative for what ends the slice beginning here — English only
   *  upstream, and deliberately not machine-translated: these are historical
   *  event descriptions, and `translate-locales.ts` exists to bootstrap
   *  interface strings, not to paraphrase history. */
  endEvent: string | null
}

defineRouteMeta({
  openAPI: {
    tags: ['atlas'],
    summary: 'The years the period scrubber can stand on',
    description:
      'Every year at which the mapped extent of the Roman state changes, from the founding of the Republic to the deposition of Romulus Augustulus. Sourced from OpenHistoricalMap (CC0).',
  },
})

export default defineCachedEventHandler(
  async (event): Promise<EmpirePeriodStep[]> => {
    await enforceRateLimit(event, 'search')

    const sql = useSql()
    const rows = await sql<{ start_year: number; states: string[]; end_event: string | null }[]>`
      SELECT
        start_year,
        array_agg(DISTINCT state_name ORDER BY state_name) AS states,
        (array_agg(end_event ORDER BY end_year DESC))[1] AS end_event
      FROM antiquity_empire_extents
      GROUP BY start_year
      ORDER BY start_year
    `

    return rows.map((row) => ({
      year: row.start_year,
      states: row.states,
      endEvent: row.end_event,
    }))
  },
  {
    // Changes only when the atlas import runs. A day is the same horizon the
    // atlas tiles themselves use, and this is one small query behind it.
    maxAge: 86400,
    name: 'empire-periods',
    getKey: () => 'empire-periods',
  },
)
