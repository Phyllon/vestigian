# Migrations

`0000_initial.sql` is hand-written, not generated. Three parts of the schema are
outside what `drizzle-kit generate` can emit — the PostGIS geometry columns, the
GiST indexes they need, and the expression indexes behind site search — so
regenerating from scratch would silently drop them.

For later changes:

1. Edit the schema in `server/database/schema/`.
2. Run `pnpm db:generate` to produce the next numbered file.
3. **Read the generated SQL** before committing. If it touches a geometry column
   or an index listed above, correct it by hand.
4. Apply with `pnpm db:migrate`.

Never edit a migration that has already run anywhere.

**A missing snapshot makes `db:generate` regenerate everything, not just your
change — check `meta/` before trusting the output.** Every hand-written
migration through `0007` had a `_journal.json` entry but no matching
`meta/000N_snapshot.json`, so drizzle-kit had no "previous state" to diff a
schema edit against and proposed recreating the full 19-table schema from
scratch for what should have been a one-table addition — including bare
`CREATE TYPE` statements with no `IF NOT EXISTS` (Postgres has none), which
would have failed outright against a database that already had those types.
Trimmed to the real delta by hand for `0008`, which is also what finally
created `meta/0008_snapshot.json` — a real baseline for the first time.
Migrations `0009` onward generated clean, single-table diffs against it, so
this should be a one-off repair, not a standing step — but if a future
`db:generate` ever proposes recreating tables that already exist, this is
why, and the fix is the same: trim it to the delta, don't apply it as-is.
