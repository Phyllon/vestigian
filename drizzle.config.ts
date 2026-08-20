import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/database/schema/index.ts',
  out: './server/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.NUXT_DATABASE_URL ?? 'postgres://vestigia:vestigia@127.0.0.1:5432/vestigia',
  },
  verbose: true,
  strict: true,
})
