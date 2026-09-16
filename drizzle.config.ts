import { defineConfig } from 'drizzle-kit'
import { requireDatabaseUrl } from './server/database/database-url'

/**
 * drizzle-kit does not read `.env` itself, and there is no fallback URL any
 * more — without this `db:generate` and `db:studio` would stop at
 * `requireDatabaseUrl`.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // Absent in CI, where the values come from the environment already.
}

export default defineConfig({
  schema: './server/database/schema/index.ts',
  out: './server/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: requireDatabaseUrl(),
  },
  verbose: true,
  strict: true,
})
