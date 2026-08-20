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
