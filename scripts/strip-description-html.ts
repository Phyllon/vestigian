/**
 * Strips markup out of every free-text column that predates `stripHtml`
 * (`server/utils/sanitize.ts`) running on write: `sites.description`,
 * `sites.summary`, `tracings.description`, and `site_images.caption` /
 * `site_images.attribution`. All five went through the same gap —
 * `stripHtml` originally covered only the two `description` columns, and
 * `summary`, `caption` and `attribution` accepted raw markup (including a
 * literal `<script>` tag, found while auditing the upload pipeline) until
 * `server/api/contributions/index.post.ts` and
 * `server/api/contributions/images.post.ts` were fixed to match.
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
import { requireDatabaseUrl } from '../server/database/database-url'

const shouldRepair = process.argv.includes('--repair')

const sql = postgres(requireDatabaseUrl())

interface TextRow {
  id: number
  value: string
}

const processColumn = async (table: string, column: string): Promise<void> => {
  // Cheap prefilter — most rows carry no '<' at all, and reading every value
  // through stripHtml just to find no change would cost far more than the
  // query saves.
  const rows = await sql<TextRow[]>`
    SELECT id, ${sql(column)} AS value FROM ${sql(table)}
    WHERE ${sql(column)} IS NOT NULL AND ${sql(column)} LIKE '%<%'
  `

  const changed = rows
    .map((row) => ({ id: row.id, before: row.value, after: stripHtml(row.value) }))
    .filter((row) => row.before !== row.after)

  console.log(
    `${table}.${column}: ${rows.length} candidate rows, ${changed.length} actually change.`,
  )
  for (const row of changed.slice(0, 5)) {
    console.log(`  · #${row.id}: ${JSON.stringify(row.before.slice(0, 60))} → stripped`)
  }
  if (changed.length > 5) console.log(`    … and ${changed.length - 5} more`)

  if (changed.length > 0 && shouldRepair) {
    for (const row of changed) {
      await sql`UPDATE ${sql(table)} SET ${sql(column)} = ${row.after} WHERE id = ${row.id}`
    }
    console.log(`  written ${changed.length} rows.`)
  }
}

const main = async (): Promise<void> => {
  await processColumn('sites', 'description')
  await processColumn('sites', 'summary')
  await processColumn('tracings', 'description')
  await processColumn('site_images', 'caption')
  await processColumn('site_images', 'attribution')

  if (!shouldRepair) {
    console.log('\nRun again with --repair to write the stripped values.')
  }

  await sql.end()
}

await main()
