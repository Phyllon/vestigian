import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../database/schema'

let client: postgres.Sql | undefined
let database: ReturnType<typeof drizzle<typeof schema>> | undefined
let databaseClient: postgres.Sql | undefined

/**
 * A single pooled connection per Nitro process. The pool is deliberately small:
 * tile queries are short and CPU-bound in Postgres, so a large pool only moves
 * the queue from the app into the database.
 */
export const useSql = (): postgres.Sql => {
  if (!client) {
    const { databaseUrl } = useRuntimeConfig()
    client = postgres(databaseUrl, {
      max: 12,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: true,
    })
  }
  return client
}

/**
 * Drizzle gets a connection of its own, and must never be handed the one
 * `useSql()` returns.
 *
 * `drizzle(client)` reaches into `client.options.parsers` and overwrites the
 * handlers for oids 1082/1083/1114/1184 with a pass-through, because it maps
 * timestamps itself further up. Sharing one client therefore turns every
 * `timestamptz` in every raw query into a string like
 * `2026-08-20 14:40:59.213745+00` — no error, just a `Date` that is not one,
 * surfacing far away as `updated_at.toISOString is not a function`.
 *
 * Nothing in the app uses the query builder today; the raw client covers the
 * PostGIS hot path. This exists so that reaching for Drizzle later cannot
 * silently break the rest.
 */
export const useDatabase = () => {
  if (!database) {
    const { databaseUrl } = useRuntimeConfig()
    databaseClient = postgres(databaseUrl, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: true,
    })
    database = drizzle(databaseClient, { schema })
  }
  return database
}

export { schema }
