/**
 * Dated sites out of the Ancient Sites and Monuments Survey.
 *
 * The survey (https://survey.jensineandresen.com, Jensine Andresen) is 1.3 M points,
 * overwhelmingly prehistoric northern Europe, with no period column. Eight of its upstream sources
 * state a Hellenistic-to-Byzantine period in prose, and those are the only rows read here
 * (`shared/utils/survey-sites.ts` is the reader and says why each other source is left out):
 *
 * | Source in the survey                                   | Licence — and where it was read, 15 Oct 2026 |
 * | ------------------------------------------------------ | -------------------------------------------- |
 * | Villages to Empires, South Levant (Titolo, Turin 2025) | CC BY 4.0 — Zenodo record 17285091           |
 * | Gwiazda 2020, Syro-Palestinian chamber tombs           | CC BY 4.0 — Zenodo record 4156221            |
 * | Marmarica (Laguna-Palma 2022)                          | CC BY 4.0 — Zenodo record 7678852            |
 * | LuwianSiteAtlas (Aşınmaz, Mutlu & Zangger 2025)        | CC BY 4.0 — Zenodo record 17128262           |
 * | Cornwall & Scilly HER (Cornwall Council)               | OGL v3 — data.gov.uk listing                 |
 * | Canmore (Historic Environment Scotland)                | OGL — the Survey's credits page              |
 * | Historic England, scheduled monuments                  | OGL v3 — the Survey's credits page           |
 * | Sardinia, Piano Paesaggistico Regionale (2006)         | CC BY 4.0 — the Survey's credits page        |
 *
 * The last three were not re-read at their publishers (canmore.org.uk and historicengland.org.uk
 * answer 403 to a script); the Survey's own credits page is the evidence.
 *
 * The survey file itself is ODbL 1.0 (share-alike) and is a compilation; what is stored here is
 * the rows' fields as the survey passes them on. The ODbL question for the combined file is
 * recorded in `.claude/rules/reference-overlays.md` and is the maintainer's to settle.
 *
 * **What is left out, and why it is countable.** vici.org rows (the atlas already is vici.org);
 * spot-height survey labels ("Elevation Point 577"); and every source whose prose names no
 * Hellenistic-to-Byzantine period or whose licence the Survey does not state: Kwok & Peters (CC0,
 * but "Roman" appears only in bibliography titles), Latvia (CC0, but its dating is "Pre-Roman Iron
 * Age"), the Italian GNA (no licence stated), IPHAN (terms "being confirmed"), Portugal (CC BY-NC,
 * and not in the Survey's own download), OSM limes points (the limes overlay already draws them).
 * The run prints the count for each reason.
 *
 * **What is deliberately kept.** Cornwall's destroyed and uncertain records — see the table's
 * docstring. And anything within 500 m of a site, place, hillfort, monument, port, battle or mint
 * the atlas already holds is removed *after* loading, so a re-run against a bigger atlas shrinks
 * this table rather than doubling a pin.
 *
 *   pnpm import:survey-sites                          # newest .import/ancient-monuments-survey-*.csv
 *   pnpm import:survey-sites -- --file path/to.csv
 *   pnpm import:survey-sites -- --dry-run
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'
import {
  readSurveyRecord,
  type SurveyRecord,
  type SurveySite,
  type SurveySkipReason,
} from '../../shared/utils/survey-sites'
import { refreshAtlasCache } from './atlas-cache'
import { guardImport, isDryRun, recordImportRun } from './guard'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const IMPORT_DIR = join(process.cwd(), '.import')
const SOURCE_ID = 'survey:ancient-monuments:dated-prose'
const BATCH_SIZE = 500
/** Anything nearer than this to a record the atlas already holds is the same place. */
const DUPLICATE_RADIUS_METRES = 500

/** Tables whose points mean "the atlas already has something here". */
const EXISTING_LAYERS = [
  'sites',
  'antiquity_places',
  'antiquity_hillforts',
  'antiquity_monuments',
  'antiquity_ports',
  'antiquity_battles',
  'antiquity_mints',
] as const

type SurveyCsvRow = Record<string, string>

const toSurveyRecord = (row: SurveyCsvRow): SurveyRecord | null => {
  const lat = Number(row.lat)
  const lon = Number(row.lon)
  if (!row.survey_id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return {
    surveyId: row.survey_id,
    name: row.name ?? '',
    typeInSource: row.type_in_source ?? '',
    note: row.note ?? '',
    sources: row.sources ?? '',
    lat,
    lon,
  }
}

const findSurveyFile = async (argv: readonly string[]): Promise<string> => {
  const flag = argv.indexOf('--file')
  const given = flag === -1 ? undefined : argv[flag + 1]
  if (given) return given

  const names = (await readdir(IMPORT_DIR))
    .filter((name) => /^ancient-monuments-survey-.*\.csv$/.test(name))
    .sort()
  const newest = names[names.length - 1]
  if (!newest) throw new Error(`No ancient-monuments-survey-*.csv in ${IMPORT_DIR}; pass --file.`)
  return join(IMPORT_DIR, newest)
}

const checksumOfFile = async (path: string): Promise<string> => {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

interface ParseOutcome {
  sites: SurveySite[]
  rowsRead: number
  skipped: Record<SurveySkipReason | 'unplaceable', number>
}

const readSurveyFile = async (path: string): Promise<ParseOutcome> => {
  const outcome: ParseOutcome = {
    sites: [],
    rowsRead: 0,
    skipped: {
      'unsupported-source': 0,
      vici: 0,
      'generic-label': 0,
      'no-period': 0,
      unplaceable: 0,
    },
  }

  const parser = createReadStream(path, 'utf8').pipe(
    parse({
      columns: true,
      comment: '#',
      // The survey's `#` line is a whole line; a `#` inside a name or note ("no. #12") is data.
      comment_no_infix: true,
      relax_quotes: true,
      relax_column_count: true,
    }),
  )
  for await (const row of parser as AsyncIterable<SurveyCsvRow>) {
    outcome.rowsRead += 1
    const record = toSurveyRecord(row)
    if (!record) {
      outcome.skipped.unplaceable += 1
      continue
    }
    const result = readSurveyRecord(record)
    if ('skipped' in result) outcome.skipped[result.skipped] += 1
    else outcome.sites.push(result.site)
  }
  return outcome
}

const insertBatch = async (sites: SurveySite[]): Promise<void> => {
  const rows = sites.map((site) => ({
    surveyId: site.surveyId,
    source: site.source,
    name: site.name.slice(0, 240),
    kind: site.kind,
    periodKeys: site.periods.keys,
    periodFrom: site.periods.from,
    periodTo: site.periods.to,
    periodBasis: site.periods.basis,
    destroyed: site.destroyed,
    uncertain: site.uncertain,
    evidence: site.evidence,
    lon: site.lon,
    lat: site.lat,
  }))
  await sql`
    INSERT INTO antiquity_survey_sites
      (survey_id, source, name, kind, period_keys, period_from, period_to, period_basis,
       destroyed, uncertain, evidence, geom)
    SELECT
      e->>'surveyId', e->>'source', e->>'name', e->>'kind',
      ARRAY(SELECT jsonb_array_elements_text(e->'periodKeys')),
      (e->>'periodFrom')::int, (e->>'periodTo')::int, e->>'periodBasis',
      (e->>'destroyed')::boolean, (e->>'uncertain')::boolean, e->>'evidence',
      ST_SetSRID(ST_MakePoint((e->>'lon')::double precision, (e->>'lat')::double precision), 4326)
    FROM jsonb_array_elements(${sql.json(rows as unknown as postgres.JSONValue)}) AS e
  `
}

/** Returns how many rows each existing layer accounted for, in the order they were removed. */
const removeWhatTheAtlasAlreadyHolds = async (): Promise<Array<[string, number]>> => {
  const removed: Array<[string, number]> = []
  for (const layer of EXISTING_LAYERS) {
    const deleted = await sql`
      DELETE FROM antiquity_survey_sites AS survey
      WHERE EXISTS (
        SELECT 1 FROM ${sql(layer)} AS existing
        WHERE existing.geom && ST_Expand(survey.geom, 0.01)
          AND ST_DWithin(existing.geom::geography, survey.geom::geography, ${DUPLICATE_RADIUS_METRES})
      )
    `
    removed.push([layer, deleted.count])
  }
  return removed
}

const main = async (): Promise<void> => {
  const path = await findSurveyFile(process.argv)
  console.log(`Ancient Sites and Monuments Survey — ODbL 1.0 — ${path}\n`)

  const outcome = await readSurveyFile(path)
  const checksum = await checksumOfFile(path)
  console.log(`${outcome.rowsRead} rows read, ${outcome.sites.length} dated from their prose.`)
  for (const [reason, count] of Object.entries(outcome.skipped)) {
    console.log(`  left out — ${reason}: ${count}`)
  }

  const proceed = await guardImport({
    sql,
    source: SOURCE_ID,
    rowCount: outcome.rowsRead,
    checksum,
    dryRun: isDryRun(process.argv),
  })
  if (!proceed) {
    await sql.end()
    return
  }

  await sql`TRUNCATE antiquity_survey_sites RESTART IDENTITY`
  for (let start = 0; start < outcome.sites.length; start += BATCH_SIZE) {
    await insertBatch(outcome.sites.slice(start, start + BATCH_SIZE))
  }

  for (const [layer, count] of await removeWhatTheAtlasAlreadyHolds()) {
    console.log(`  already held — within ${DUPLICATE_RADIUS_METRES} m of ${layer}: ${count}`)
  }
  await sql`ANALYZE antiquity_survey_sites`
  await recordImportRun(sql, { source: SOURCE_ID, rowCount: outcome.rowsRead, checksum })

  const summary = await sql<
    { source: string; total: number; destroyed: number; uncertain: number }[]
  >`
    SELECT source, count(*)::int AS total,
           count(*) FILTER (WHERE destroyed)::int AS destroyed,
           count(*) FILTER (WHERE uncertain)::int AS uncertain
    FROM antiquity_survey_sites GROUP BY source ORDER BY total DESC
  `
  for (const row of summary) {
    console.log(
      `  ${row.source}: ${row.total} (${row.destroyed} destroyed, ${row.uncertain} uncertain)`,
    )
  }

  await refreshAtlasCache(['reference:survey-sites:*'])
  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
