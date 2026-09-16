/**
 * Ancient battles, worldwide — not scoped to Rome.
 *
 * Source: Wikidata's public SPARQL endpoint (query.wikidata.org), CC0 —
 * already this project's trusted enrichment backbone
 * (`.claude/rules/enrichment-and-i18n.md`), so this is not a new licence
 * question.
 *
 * Two candidates were checked and rejected before this one:
 *
 *   Pleiades   Its own vocabulary has a "battlefield" place-type
 *              (confirmed by fetching pleiades.stoa.org/vocabularies/
 *              place-types), but a live query against the full Pleiades
 *              CSV `05-antiquity-atlas.ts` already imports (all ~42,000
 *              places) found zero rows using it. Pleiades catalogues
 *              continuously-occupied places, not one-off engagements —
 *              the vocabulary term exists but is essentially unused.
 *   OSM        `historic=battlefield` exists but skews overwhelmingly
 *              modern in sampling (WWII, the Falklands), and a
 *              name-filtered Overpass query for well-known ancient
 *              battles came back empty.
 *
 * The query: every item that is an instance of (transitively) `battle`
 * (Q178561) with a coordinate (P625), before year 500 — the conventional
 * end of antiquity, the fall of the Western Roman Empire (476 CE) rounded.
 * Verified live: 458 distinct battles dated by a point-in-time (P585) at
 * year-precision-or-finer, from the Battle of Megiddo (1457 BCE) onward,
 * worldwide — Kadesh, Marathon, Gaugamela, Qarqar and the Chinese
 * Spring-and-Autumn battles alongside Cannae.
 *
 * **A single point-in-time date alone misses every multi-day siege.**
 * The Battle (Siege) of Alesia has no P585 at all — only a start time
 * (P580, 1 July 52 BCE) and an end time (P582), because it lasted months.
 * Found only by checking a named battle that was conspicuously absent
 * from the first import run, not assumed from the schema. A second query
 * fetches P580 for the same class, and the two result sets are merged
 * client-side (P585 preferred where an item has both) — a combined SPARQL
 * query using `FILTER NOT EXISTS` to do this server-side timed out twice
 * against the public endpoint (60s+) where each query alone answers in
 * under 5s, so the merge happens here instead of in SPARQL. The P580 query
 * adds 30 more battles, for **488 total**.
 *
 * Of the results, 24 items carry more than one candidate coordinate or
 * date (rival hypotheses about where or when a battle happened, e.g. the
 * Assyrian siege of Jerusalem) — this import takes the first row SPARQL
 * returns for a given item and moves on, the same restraint already
 * applied to Pleiades' own `location_precision` judgment calls rather
 * than trying to adjudicate between competing scholarship.
 *
 * **Wikidata's ISO dates use astronomical year numbering** (year 0 is
 * 1 BCE), which is a real off-by-one against this project's own
 * convention of negating the traditional count (`-60` means 60 BCE) —
 * caught by a spot check that first stored Cannae as "215 BCE" instead of
 * 216. See `yearFromDate` below for the conversion.
 *
 *   pnpm import:battles
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Redis } from 'ioredis'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'battles')
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'

/**
 * `?precision >= 9` is Wikidata's own time-precision code for "year" —
 * 11 is day, 10 is month, 9 is year, 8 and below are decade/century/etc.
 * A century-precision date (there are some, e.g. an item only dated "1500s
 * BCE") is excluded rather than rounded to a fake year.
 *
 * One query per date property (P585 point-in-time, P580 start time) — see
 * the file docstring for why these are not combined into one SPARQL query.
 */
const dateQuery = (dateProperty: 'P585' | 'P580'): string => `
  SELECT ?battle ?battleLabel ?lat ?lon ?date ?geoPrecision ?article WHERE {
    ?battle wdt:P31/wdt:P279* wd:Q178561 .
    ?battle p:${dateProperty}/psv:${dateProperty} ?dateNode .
    ?dateNode wikibase:timeValue ?date ; wikibase:timePrecision ?precision .
    ?battle p:P625/psv:P625 ?coordNode .
    ?coordNode wikibase:geoLatitude ?lat ; wikibase:geoLongitude ?lon ;
               wikibase:geoPrecision ?geoPrecision .
    OPTIONAL {
      ?article schema:about ?battle ; schema:isPartOf <https://en.wikipedia.org/> .
    }
    FILTER(YEAR(?date) < 500 && ?precision >= 9)
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }
`

interface SparqlBinding {
  battle: { value: string }
  battleLabel?: { value: string }
  lat: { value: string }
  lon: { value: string }
  date: { value: string }
  geoPrecision: { value: string }
  article?: { value: string }
}

interface SparqlResponse {
  results: { bindings: SparqlBinding[] }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Same shape as `05-antiquity-atlas.ts`'s `fetchCached` — kept local for
 *  the same reason `12-antiquity-periods.ts` already gives: `scripts/` has
 *  no shared-utility module either script can import from without pulling
 *  in Nitro auto-imports. */
const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  // Wikimedia's User-Agent policy (meta.wikimedia.org/wiki/User-Agent_policy)
  // blocks anonymous-looking requests to query.wikidata.org with a 403 —
  // confirmed by hitting the endpoint here with no header and getting one.
  const response = await fetch(url, {
    headers: {
      accept: 'application/sparql-results+json',
      'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)',
    },
  })
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  const sink = createWriteStream(target)
  await pipeline(source, sink)

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024)} KB`)
  await wait(250)
  return target
}

/** The QNNNNN out of a full entity URI. */
const wikidataId = (uri: string): string => uri.split('/').pop()!

/**
 * Wikidata's ISO date strings use astronomical year numbering, where year 0
 * is 1 BCE and year -215 is 216 BCE — a real off-by-one against this
 * project's own convention, confirmed by a spot check that first stored
 * Cannae as "215 BCE" instead of the correct 216. `antiquity_period_extents`
 * and `antiquity_places` both store the traditional count negated (`-60`
 * means 60 BCE, not "the year before 60 BCE"), so a BCE astronomical year is
 * converted here rather than stored as-is; a CE year (> 0) needs no
 * conversion, since astronomical and traditional numbering agree there.
 */
const yearFromDate = (isoDate: string): number => {
  const match = /^(-?\d+)-/.exec(isoDate)
  const astronomicalYear = match ? Number(match[1]) : 0
  return astronomicalYear <= 0 ? astronomicalYear - 1 : astronomicalYear
}

/** Wikidata's geoPrecision is a coordinate's declared resolution in
 *  degrees — collapsed into the same two-value vocabulary
 *  `isLocatedPrecisely` already reads off Pleiades, not a new scale.
 *  Roughly 100 m at these latitudes. */
const locationPrecision = (geoPrecision: number): 'precise' | 'rough' =>
  geoPrecision <= 0.001 ? 'precise' : 'rough'

interface BattleRow {
  wikidataId: string
  title: string
  year: number
  locationPrecision: string
  wikipediaUrl: string | null
  lat: number
  lon: number
}

/**
 * Folds bindings into one row per Wikidata item, keeping the first binding
 * seen for a given id — items with more than one qualifying coordinate or
 * date (the 24 mentioned in the file docstring) produce more than one
 * binding, and the first one SPARQL returns wins rather than adjudicating
 * between them. `existing` lets a second call (the P580 fallback) add only
 * the items the first call did not already cover, so a point-in-time date
 * always wins over a start-time one for the same battle.
 */
const parseBindings = (bindings: SparqlBinding[], existing: Map<string, BattleRow>): void => {
  for (const binding of bindings) {
    const id = wikidataId(binding.battle.value)
    if (existing.has(id)) continue

    existing.set(id, {
      wikidataId: id,
      title: binding.battleLabel?.value ?? id,
      year: yearFromDate(binding.date.value),
      locationPrecision: locationPrecision(Number(binding.geoPrecision.value)),
      wikipediaUrl: binding.article?.value ?? null,
      lat: Number(binding.lat.value),
      lon: Number(binding.lon.value),
    })
  }
}

const insertBattles = async (rows: BattleRow[]): Promise<void> => {
  for (let start = 0; start < rows.length; start += 250) {
    const batch = rows.slice(start, start + 250)
    await sql`
      INSERT INTO antiquity_battles
        (wikidata_id, title, year, location_precision, wikipedia_url, geom)
      SELECT
        v.wikidata_id, v.title, v.year::int, v.location_precision, v.wikipedia_url,
        ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
      FROM unnest(
        ${batch.map((row) => row.wikidataId)}::text[],
        ${batch.map((row) => row.title)}::text[],
        ${batch.map((row) => String(row.year))}::text[],
        ${batch.map((row) => row.locationPrecision)}::text[],
        ${batch.map((row) => row.wikipediaUrl)}::text[],
        ${batch.map((row) => String(row.lon))}::text[],
        ${batch.map((row) => String(row.lat))}::text[]
      ) AS v(wikidata_id, title, year, location_precision, wikipedia_url, lon, lat)
      ON CONFLICT (wikidata_id) DO NOTHING
    `
  }
}

const fetchBindings = async (
  dateProperty: 'P585' | 'P580',
  cacheName: string,
): Promise<SparqlBinding[]> => {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(dateQuery(dateProperty))}`
  const path = await fetchCached(url, cacheName)
  const parsed = JSON.parse(await readFile(path, 'utf8')) as SparqlResponse
  return parsed.results.bindings
}

const importBattles = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_battles RESTART IDENTITY`

  const rows = new Map<string, BattleRow>()
  parseBindings(await fetchBindings('P585', 'battles-point-in-time.json'), rows)
  parseBindings(await fetchBindings('P580', 'battles-start-time.json'), rows)

  await insertBattles([...rows.values()])
  return rows.size
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('Ancient battles — Wikidata (CC0)\n')

  const total = await importBattles()
  console.log(`${total} battles imported.`)

  await sql`ANALYZE antiquity_battles`

  // Rides the atlas cache generation, same as every other antiquity_* import.
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    const stale = await redis.keys('atlas:v*battle*')
    if (stale.length > 0) await redis.del(...stale)
    console.log(
      `\nAtlas cache generation is now ${version}; ${stale.length} stale battle tiles dropped.`,
    )
  } catch (error) {
    console.warn(
      `\nBattles imported, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous sheet.`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
