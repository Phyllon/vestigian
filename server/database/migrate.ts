import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Migrations run as a one-shot before the app container starts, never from
 * inside a request. A single connection is used so a failed migration cannot
 * leave a pool of half-configured connections behind.
 */
const connection = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigia:vestigia@127.0.0.1:5432/vestigia',
  { max: 1 },
)

await migrate(drizzle(connection), { migrationsFolder: './server/database/migrations' })
await connection.end()

console.log('Migrations applied.')
