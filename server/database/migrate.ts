import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { requireDatabaseUrl } from './database-url'

/**
 * Migrations run as a one-shot before the app container starts, never from
 * inside a request. A single connection is used so a failed migration cannot
 * leave a pool of half-configured connections behind.
 */
const connection = postgres(requireDatabaseUrl(), { max: 1 })

await migrate(drizzle(connection), { migrationsFolder: './server/database/migrations' })
await connection.end()

console.log('Migrations applied.')
