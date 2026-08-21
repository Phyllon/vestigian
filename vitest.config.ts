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
    include: ['server/**/__test__/**/*.test.ts', 'app/composables/**/__test__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['server/utils/**', 'app/composables/**'],
      exclude: ['**/__test__/**'],
      thresholds: { statements: 70, branches: 70, functions: 70, lines: 70 },
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
