import { createHash } from 'node:crypto'
import type postgres from 'postgres'

/**
 * A tripwire between a third-party source and the atlas.
 *
 * Twenty-four scripts in this directory fetch someone else's data and write it
 * straight into tables the map reads. None of them previously compared what
 * arrived against what arrived last time, so an upstream that changed shape,
 * lost half its rows, or was replaced outright would import silently and look
 * exactly like a successful run. The failure is not loud — it is a map that is
 * quietly wrong, discovered whenever somebody happens to notice.
 *
 * What this adds is a memory: every guarded run records how many rows it wrote
 * and a checksum of the bytes it read, and the next run refuses to proceed when
 * the delta is implausible. It is deliberately not a validator — it says
 * nothing about whether individual records are correct, only whether *this
 * fetch looks like the last one*. That is the class of problem a human cannot
 * catch by eye across 235,000 rows.
 *
 * The decision is pure and tested (`__test__/guard.test.ts`); only the two
 * helpers at the bottom touch a database.
 */

/** Bounds beyond which a run is refused rather than reported. */
export interface ImportTolerance {
  /**
   * How far the row count may fall, as a fraction of the previous run.
   * 0.1 refuses anything below 90% of last time.
   *
   * Sources here grow or hold steady; they do not shrink meaningfully. A real
   * upstream correction removing a few rows stays inside this, while a
   * truncated download or a changed API shape does not.
   */
  maximumShrinkFraction: number
  /**
   * How far the row count may rise, as a multiple of the previous run. Guards
   * the opposite failure: a parser that starts splitting one record into many,
   * or a fetch that pulls a superset nobody asked for.
   */
  maximumGrowthFactor: number
}

export const DEFAULT_IMPORT_TOLERANCE: ImportTolerance = {
  maximumShrinkFraction: 0.1,
  maximumGrowthFactor: 3,
}

export interface ImportRunRecord {
  rowCount: number
  /** SHA-256 of the source bytes, hex. See `checksumOfSource`. */
  checksum: string
}

export interface ImportDeltaInput {
  /** Stable identifier for the upstream, e.g. `geonames:cities500`. */
  source: string
  /** The newest previous run, or null when this source has never been imported. */
  previous: ImportRunRecord | null
  incoming: ImportRunRecord
  tolerance?: ImportTolerance
}

export type ImportRefusal = 'empty-source' | 'implausible-shrink' | 'implausible-growth'

export type ImportNote = 'first-run' | 'identical' | 'content-changed' | 'within-tolerance'

export type ImportDeltaVerdict =
  | { proceed: true; note: ImportNote; summary: string }
  | { proceed: false; refusal: ImportRefusal; summary: string }

/**
 * Whether this fetch resembles the last one closely enough to write.
 *
 * Order matters. An empty source is checked first because it is the only case
 * that is wrong on its own terms rather than relative to history — nothing
 * legitimately publishes zero rows, so it means the fetch failed in a way that
 * returned success, and importing it would also overwrite the stored baseline
 * with a zero that makes every subsequent run's comparison meaningless.
 *
 * `content-changed` is the interesting one and is deliberately *not* a refusal:
 * the same number of rows with different bytes is what an ordinary upstream
 * correction looks like, and also what a substituted dataset looks like. It
 * cannot be told apart here, so it is surfaced rather than judged.
 */
export const assessImportDelta = (input: ImportDeltaInput): ImportDeltaVerdict => {
  const { source, previous, incoming } = input
  const tolerance = input.tolerance ?? DEFAULT_IMPORT_TOLERANCE

  if (incoming.rowCount <= 0) {
    return {
      proceed: false,
      refusal: 'empty-source',
      summary: `${source}: parsed no rows at all. Treating an empty fetch as a successful import would record a zero baseline and hide the failure from the next run.`,
    }
  }

  if (!previous) {
    return {
      proceed: true,
      note: 'first-run',
      summary: `${source}: first recorded run, ${incoming.rowCount} rows. Nothing to compare against — this run becomes the baseline.`,
    }
  }

  const floor = Math.floor(previous.rowCount * (1 - tolerance.maximumShrinkFraction))

  if (incoming.rowCount < floor) {
    return {
      proceed: false,
      refusal: 'implausible-shrink',
      summary: `${source}: ${incoming.rowCount} rows, down from ${previous.rowCount} (floor ${floor}). An upstream this much smaller is a truncated download or a changed response shape far more often than a real correction — re-run with --dry-run to inspect, or raise the tolerance deliberately if the source genuinely shrank.`,
    }
  }

  const ceiling = previous.rowCount * tolerance.maximumGrowthFactor

  if (incoming.rowCount > ceiling) {
    return {
      proceed: false,
      refusal: 'implausible-growth',
      summary: `${source}: ${incoming.rowCount} rows, up from ${previous.rowCount} (ceiling ${ceiling}). Growth like that is usually a parser splitting one record into many, not an upstream that tripled.`,
    }
  }

  if (incoming.checksum === previous.checksum) {
    return {
      proceed: true,
      note: 'identical',
      summary: `${source}: byte-identical to the last run, ${incoming.rowCount} rows. Re-importing changes nothing.`,
    }
  }

  if (incoming.rowCount === previous.rowCount) {
    return {
      proceed: true,
      note: 'content-changed',
      summary: `${source}: ${incoming.rowCount} rows, same as last run, but the source bytes differ. That is what an upstream correction looks like — and also what a substituted dataset looks like. Worth a glance at what changed.`,
    }
  }

  return {
    proceed: true,
    note: 'within-tolerance',
    summary: `${source}: ${incoming.rowCount} rows, previously ${previous.rowCount}.`,
  }
}

/**
 * SHA-256 of exactly the bytes the upstream served, before any parsing.
 *
 * Hashing the raw payload rather than the parsed rows is the point: it catches
 * a source whose content changed in a way this project's own parser happens to
 * normalise away, which is precisely the change nobody would otherwise see.
 */
export const checksumOfSource = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex')

/** `--dry-run` anywhere in the arguments: fetch, parse, report, write nothing. */
export const isDryRun = (argv: readonly string[]): boolean => argv.includes('--dry-run')

export interface RecordImportRunInput {
  source: string
  rowCount: number
  checksum: string
}

/**
 * Raw SQL rather than Drizzle, against the project's usual preference, because
 * every script in this directory opens its own `postgres()` connection and
 * never touches the Nuxt `useDatabase()` handle Drizzle is configured around.
 * Two parameterised statements against a table with no geometry is the smaller
 * inconsistency.
 */
export const readLastImportRun = async (
  sql: postgres.Sql,
  source: string,
): Promise<ImportRunRecord | null> => {
  const [row] = await sql<{ row_count: number; checksum: string }[]>`
    SELECT row_count, checksum
    FROM import_runs
    WHERE source = ${source}
    ORDER BY ran_at DESC, id DESC
    LIMIT 1
  `

  return row ? { rowCount: Number(row.row_count), checksum: row.checksum } : null
}

/** Append-only: a run is never updated in place, so the history stays readable. */
export const recordImportRun = async (
  sql: postgres.Sql,
  input: RecordImportRunInput,
): Promise<void> => {
  await sql`
    INSERT INTO import_runs (source, row_count, checksum)
    VALUES (${input.source}, ${input.rowCount}, ${input.checksum})
  `
}

export interface GuardImportInput {
  sql: postgres.Sql
  source: string
  rowCount: number
  checksum: string
  dryRun: boolean
  tolerance?: ImportTolerance
}

/**
 * The whole cycle a script needs: read the last run, judge this one, print the
 * verdict, and exit non-zero on a refusal.
 *
 * Returns `false` when the caller should stop before writing — a dry run, or a
 * refusal that did not exit. It does not record the run; that happens *after*
 * the write succeeds, via `recordImportRun`, so a run that dies halfway through
 * does not leave a baseline claiming rows it never wrote.
 */
export const guardImport = async (input: GuardImportInput): Promise<boolean> => {
  const previous = await readLastImportRun(input.sql, input.source)
  const verdict = assessImportDelta({
    source: input.source,
    previous,
    incoming: { rowCount: input.rowCount, checksum: input.checksum },
    tolerance: input.tolerance,
  })

  if (!verdict.proceed) {
    console.error(`\n✗ import refused — ${verdict.summary}\n`)
    process.exitCode = 1
    return false
  }

  const marker = verdict.note === 'content-changed' ? '!' : '·'
  console.log(`${marker} ${verdict.summary}`)

  if (input.dryRun) {
    console.log('· --dry-run: nothing written.\n')
    return false
  }

  return true
}
