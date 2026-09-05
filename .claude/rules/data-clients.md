---
paths:
  - 'server/utils/db.ts'
  - 'server/utils/revisions.ts'
  - 'server/utils/mvt.ts'
---

## Which client to reach for

`useDatabase()` — Drizzle — is the default. Column names are checked against
`server/database/schema` at compile time and rows are typed from the same
place, which the raw client cannot do: `sql<{ id: number }[]>` is an assertion
the compiler takes on trust, so a renamed column stays green until production.

`useSql()` is for **PostGIS and nothing else** — eight files, each with a
reason a query builder cannot answer: `ST_AsMVT` and its aggregates
(`server/utils/mvt.ts`, via the tile route), `ST_AsMVTGeom`,
`ST_SetSRID`/`ST_MakePoint`/`ST_GeomFromGeoJSON` on write, the `geography`
casts behind proximity search, `ST_AsGeoJSON` on read, and the `SELECT 1` in
`ready.get.ts`.

A handful of geometry accessors is **not** such a reason. `sites/[id]/enrichment`
reads `ST_X`/`ST_Y` through Drizzle, as `` sql`ST_X(${schema.sites.geom})` `` inside
a normal `.select()`: table, columns and enum literals stay checked, and only the
two accessors are raw. Reach for `useSql()` when the _statement shape_ is beyond
the builder, not when one expression is.

**The two hold separate connections, so a transaction cannot span them.**
`server/utils/revisions.ts` is the reason it matters: `applyRevision()` writes
geometry and bumps a trust counter inside one `sql.begin`, and splitting the
counter onto Drizzle would put it outside that transaction while still looking
atomic. A handler that needs one transaction picks one client for all of it.

The split exists because `drizzle(client)` overwrites the timestamp parsers on
whatever client it is handed — see the note in `server/utils/db.ts`.
