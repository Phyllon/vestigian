import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../database/schema'

let client: postgres.Sql | undefined
let database: ReturnType<typeof drizzle<typeof schema>> | undefined

/**
 * A single pooled connection per Nitro process. The pool is deliberately small:
 * tile queries are short and CPU-bound in Postgres, so a large pool only moves
 * the queue from the app into the database.
 */
export const useDatabase = () => {
  if (!database) {
    const { databaseUrl } = useRuntimeConfig()
    client = postgres(databaseUrl, {
      max: 12,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: true,
    })
    database = drizzle(client, { schema })
  }
  return database
}

/** Escape hatch for the PostGIS queries Drizzle cannot express. */
export const useSql = (): postgres.Sql => {
  if (!client) useDatabase()
  return client as postgres.Sql
}

export { schema }
