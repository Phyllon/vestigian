import { test as base, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Gives every test its own rate-limit identity.
 *
 * Without this the suite defeats itself. Every request originates from
 * 127.0.0.1, so all tests share one bucket — and `login` permits eight attempts
 * per fifteen minutes. The ninth sign-in in a suite returns 429 and the failure
 * lands on whichever test happened to run ninth, which is the definition of a
 * flaky test: real, reproducible, and blamed on the wrong code.
 *
 * The server is therefore run with `NUXT_BEHIND_TRUSTED_PROXY=true` for the
 * suite only, and each test presents a distinct `x-real-ip`. That is the same
 * mechanism Bunny uses in production, so the tests exercise the real identity
 * path rather than bypassing it — and a test that wants to prove rate limiting
 * can hammer its own address without touching anyone else's.
 *
 * Addresses come from 203.0.113.0/24, which RFC 5737 reserves for
 * documentation and which can therefore never collide with anything real.
 */
let nextOctet = 0

const nextTestAddress = (): string => {
  nextOctet = (nextOctet % 250) + 1
  return `203.0.113.${nextOctet}`
}

interface Fixtures {
  /** The address this test is counted against. Useful when asserting on 429s. */
  clientAddress: string
}

export const test = base.extend<Fixtures>({
  /*
   * The empty pattern is mandatory, not sloppiness: Playwright inspects the
   * first parameter's destructuring to work out which fixtures this one
   * depends on, and rejects a plain identifier outright — "First argument must
   * use the object destructuring pattern". This fixture depends on nothing.
   */
  // eslint-disable-next-line no-empty-pattern
  clientAddress: async ({}, use) => {
    await use(nextTestAddress())
  },

  context: async ({ browser, baseURL, clientAddress }, use) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { 'x-real-ip': clientAddress },
    })

    /**
     * `extraHTTPHeaders` is set per context, not per origin, so it rides along
     * on requests to third parties too. A custom header makes a cross-origin
     * request non-simple, and the browser sends a preflight that a plain tile
     * server has no reason to answer — every basemap request then fails on
     * "x-real-ip is not allowed by Access-Control-Allow-Headers", which looks
     * exactly like a broken application. The header exists for this app's rate
     * limiter; nobody else should be told the test's address either.
     */
    const appOrigin = new URL(baseURL ?? 'http://127.0.0.1:3111').origin
    await context.route(
      (url) => url.origin !== appOrigin,
      async (route) => {
        const headers = { ...route.request().headers() }
        delete headers['x-real-ip']
        await route.continue({ headers })
      },
    )

    await use(context)
    await context.close()
  },

  // The standalone `request` fixture has its own context and would otherwise
  // fall back to the shared socket address.
  request: async ({ playwright, baseURL, clientAddress }, use) => {
    const context = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-real-ip': clientAddress },
    })
    await use(context)
    await context.dispose()
  },
})

export { expect } from '@playwright/test'
export type { APIRequestContext, Page }
