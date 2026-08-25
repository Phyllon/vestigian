import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../database/schema'

let client: postgres.Sql | undefined
let database: ReturnType<typeof drizzle<typeof schema>> | undefined
let databaseClient: postgres.Sql | undefined

/**
 * The raw client, for the queries Drizzle cannot express.
 *
 * That means PostGIS and nothing else: `ST_AsMVT` and its aggregate friends,
 * `ST_AsMVTGeom`, `ST_SnapToGrid`, the `geography` casts behind proximity
 * search. A query builder gains you nothing there — you would be passing the
 * same SQL through `sql\`\`` escapes with an extra layer in the way — so those
 * stay here, deliberately, and everything else has moved to `useDatabase()`.
 *
 * The pool is smaller than Drizzle's now that it serves the narrower half. Both
 * together stay at sixteen, which is what the tile workload was tuned for:
 * tile queries are short and CPU-bound in Postgres, so a larger pool only moves
 * the queue from the app into the database.
 */
export const useSql = (): postgres.Sql => {
  if (!client) {
    const { databaseUrl } = useRuntimeConfig()
    client = postgres(databaseUrl, {
      max: 6,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: true,
    })
  }
  return client
}

/**
 * The query builder, and the default for anything that is not PostGIS.
 *
 * Every column name it uses is checked against `server/database/schema` at
 * compile time, and every row it returns is typed from the same place. The raw
 * client cannot do either: `sql<{ id: number }[]>` is an assertion the compiler
 * takes on trust, so a renamed column stays green until it fails in
 * production.
 *
 * It gets a connection of its own, and must never be handed the one `useSql()`
 * returns. `drizzle(client)` reaches into `client.options.parsers` and
 * overwrites the handlers for oids 1082/1083/1114/1184 with a pass-through,
 * because it maps timestamps itself further up. Sharing one client therefore
 * turns every `timestamptz` in every raw query into a string like
 * `2026-08-20 14:40:59.213745+00` — no error, just a `Date` that is not one,
 * surfacing far away as `updated_at.toISOString is not a function`.
 */
export const useDatabase = () => {
  if (!database) {
    const { databaseUrl } = useRuntimeConfig()
    databaseClient = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: true,
    })
    database = drizzle(databaseClient, { schema })
  }
  return database
}

export { schema }
