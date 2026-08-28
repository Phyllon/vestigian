import { defineConfig, devices } from '@playwright/test'

/**
 * The built server does not read `.env` — Nitro only does that in development,
 * and these tests deliberately run the production output. Without this the
 * server starts, fails to reach Postgres, and every test times out waiting for
 * a readiness check that can never pass.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // Absent in CI, where the values come from the environment already.
}

/**
 * End-to-end tests, run against the **production build** rather than `nuxt dev`.
 *
 * That is a stability decision, not a purity one. Two of the worst bugs this
 * project has had were invisible in development and only appeared in the built
 * output: a CSP without a nonce token that stopped Vue mounting at all, and
 * Pino's worker transport being tree-shaken out of the server bundle. A suite
 * that exercises the dev server would have passed through both.
 *
 * Chromium only. These tests assert that the application works, not that it
 * works in five browsers — the map is WebGL and the rendering differences
 * between engines are not what this suite is for.
 */
export default defineConfig({
  testDir: './e2e',
  // Unit tests live in `__test__` folders next to their subject and are run by
  // vitest; nothing here should ever pick them up.
  testMatch: '**/*.spec.ts',

  // Ordered so a failure reads as a cause rather than a symptom: readiness
  // first, then the map, then everything that assumes both.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3111',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  globalSetup: './e2e/helpers/global-setup.ts',
  globalTeardown: './e2e/helpers/global-teardown.ts',

  /**
   * `reuseExistingServer` is what makes local iteration bearable: start the
   * built server once and every subsequent run skips the sixty-second build.
   * CI always builds fresh.
   */
  webServer: {
    command: 'pnpm build && node .output/server/index.mjs',
    // 3111 rather than the obvious 3100: that is Loki in the observability
    // profile, and a suite that fails only when someone happens to be running
    // Grafana is worse than one that fails always.
    url: 'http://127.0.0.1:3111/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      NITRO_PORT: '3111',
      NITRO_HOST: '127.0.0.1',
      // Tracing off: the suite has no collector, and a batch exporter retrying
      // against nothing adds noise to every failure trace.
      NUXT_TELEMETRY_OTLP_ENDPOINT: '',
      NUXT_TELEMETRY_LOG_LEVEL: 'warn',
      NUXT_DATABASE_URL: process.env.NUXT_DATABASE_URL ?? '',
      NUXT_REDIS_URL: process.env.NUXT_REDIS_URL ?? '',
      NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD ?? '',
      NUXT_ALTCHA_SECRET: process.env.NUXT_ALTCHA_SECRET ?? '',
      NUXT_STORAGE_ENDPOINT: process.env.NUXT_STORAGE_ENDPOINT ?? '',
      NUXT_STORAGE_BUCKET: process.env.NUXT_STORAGE_BUCKET ?? '',
      NUXT_STORAGE_ACCESS_KEY_ID: process.env.NUXT_STORAGE_ACCESS_KEY_ID ?? '',
      NUXT_STORAGE_SECRET_ACCESS_KEY: process.env.NUXT_STORAGE_SECRET_ACCESS_KEY ?? '',
      NUXT_IMGPROXY_BASE_URL: process.env.NUXT_IMGPROXY_BASE_URL ?? '',
      NUXT_IMGPROXY_KEY: process.env.NUXT_IMGPROXY_KEY ?? '',
      NUXT_IMGPROXY_SALT: process.env.NUXT_IMGPROXY_SALT ?? '',
      // On for the suite, so each test can present its own `x-real-ip` and get
      // its own rate-limit bucket. Every request otherwise comes from
      // 127.0.0.1 and shares one — `login` allows eight per fifteen minutes,
      // so the ninth sign-in in the suite would 429 and blame the wrong test.
      // See `e2e/helpers/fixtures.ts`.
      NUXT_BEHIND_TRUSTED_PROXY: 'true',
    },
  },
})
