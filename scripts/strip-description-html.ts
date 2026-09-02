/**
 * Strips markup out of `sites.description` and `tracings.description` for
 * rows imported or edited before `stripHtml` (`server/utils/sanitize.ts`)
 * started running on every new contribution.
 *
 * A direct UPDATE, not a revision: this is data hygiene, the same category as
 * `images:reconcile`, not an editorial change to a record's content — the
 * words themselves are untouched, only the markup around them is removed.
 * Routing it through `applyRevision()` would put a moderator in front of a
 * mechanical cleanup, and revision history is append-only, so a bulk backfill
 * has no home there anyway.
 *
 *   pnpm strip-description-html           report only
 *   pnpm strip-description-html --repair  also write the stripped text
 */
import postgres from 'postgres'
import { stripHtml } from '../server/utils/sanitize'

const shouldRepair = process.argv.includes('--repair')

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
)

interface DescribedRow {
  id: number
  description: string
}

const processTable = async (table: 'sites' | 'tracings'): Promise<void> => {
  // Cheap prefilter — most rows carry no '<' at all, and reading every
  // description through stripHtml just to find no change would cost far more
  // than the query saves.
  const rows = await sql<DescribedRow[]>`
    SELECT id, description FROM ${sql(table)}
    WHERE description IS NOT NULL AND description LIKE '%<%'
  `

  const changed = rows
    .map((row) => ({ id: row.id, before: row.description, after: stripHtml(row.description) }))
    .filter((row) => row.before !== row.after)

  console.log(`${table}: ${rows.length} candidate rows, ${changed.length} actually change.`)
  for (const row of changed.slice(0, 5)) {
    console.log(`  · #${row.id}: ${JSON.stringify(row.before.slice(0, 60))} → stripped`)
  }
  if (changed.length > 5) console.log(`    … and ${changed.length - 5} more`)

  if (changed.length > 0 && shouldRepair) {
    for (const row of changed) {
      await sql`UPDATE ${sql(table)} SET description = ${row.after} WHERE id = ${row.id}`
    }
    console.log(`  written ${changed.length} rows.`)
  }
}

const main = async (): Promise<void> => {
  await processTable('sites')
  await processTable('tracings')

  if (!shouldRepair) {
    console.log('\nRun again with --repair to write the stripped descriptions.')
  }

  await sql.end()
}

await main()
