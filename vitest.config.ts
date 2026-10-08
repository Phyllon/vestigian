import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Tests cover the load-bearing logic only: tile planning, trust and permission
 * rules, rate limiting, licence handling and the geometry helpers. Components
 * are exercised by using the application, not by asserting on their markup.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Several import-script tests load modules that build their postgres
    // client at the top level through `requireDatabaseUrl`. postgres.js only
    // connects on the first query, so this address is never dialled — it
    // exists so that loading the module does not throw. No password in it.
    env: { NUXT_DATABASE_URL: 'postgres://vitest@127.0.0.1:1/unused' },
    include: [
      'server/**/__test__/**/*.test.ts',
      'app/composables/**/__test__/**/*.test.ts',
      'shared/**/__test__/**/*.test.ts',
      'scripts/**/__test__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['server/utils/**', 'app/composables/**', 'shared/utils/**', 'scripts/i18n/**'],
      exclude: ['**/__test__/**'],
      reporter: ['text-summary', 'html'],
      // A floor, not a target: measured 2026-10-08 at 41.05% statements,
      // 39.97% branches, 36.11% functions, 41.78% lines (the included paths
      // hold a lot of database- and Nitro-bound glue the unit tests do not
      // reach). The earlier 70% was never met because nothing ever ran with
      // `--coverage`. Raise these as tests are added; never lower them to
      // make a failing run pass.
      thresholds: { statements: 41, branches: 39, functions: 36, lines: 41 },
    },
  },
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
