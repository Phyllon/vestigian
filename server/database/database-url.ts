/**
 * The database URL, required — deliberately without a fallback.
 *
 * Every script, `migrate.ts`, `drizzle.config.ts` and the e2e account helper
 * used to fall back to the dev compose credentials
 * (`postgres://vestigian:…@127.0.0.1`). That put a password into 31 files
 * (SonarQube `secrets:S6698`), and a run with the variable missing quietly
 * connected to whatever answered on loopback instead of saying so.
 *
 * `.env` carries the value in development: every `tsx` entry in
 * `package.json` passes `--env-file-if-exists=.env`, and `drizzle.config.ts`
 * and `playwright.config.ts` load the file themselves; `vitest.config.ts` sets
 * a never-dialled placeholder, because some tests import scripts that build
 * their client at load time. The running app never calls this — it reads
 * `runtimeConfig.databaseUrl`.
 *
 * Lives in `server/database/`, not `server/utils/`, so Nitro does not
 * auto-import it into the app.
 */
export const requireDatabaseUrl = (): string => {
  const databaseUrl = process.env.NUXT_DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'NUXT_DATABASE_URL is not set — run through pnpm, or pass --env-file-if-exists=.env to tsx.',
    )
  }
  return databaseUrl
}
