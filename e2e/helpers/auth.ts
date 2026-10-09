import { answerIntroTour } from './fixtures'
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { ACCOUNTS, E2E_PASSWORD, type AccountName } from './accounts'

/**
 * Signs in through the real endpoint and leaves the session cookie on the
 * page's context.
 *
 * Deliberately not through the login form: the form is covered by its own test,
 * and every other test that needs a session should not re-exercise it. This
 * keeps a failure in the login UI from turning the whole suite red.
 */
export const signIn = async (page: Page, account: AccountName): Promise<void> => {
  const response = await page.request.post('/api/auth/login', {
    data: { email: ACCOUNTS[account].email, password: E2E_PASSWORD },
  })

  expect(
    response.ok(),
    `Could not sign in as ${account}: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
}

/** The same, for tests that never open a browser page. */
export const signInViaApi = async (
  context: APIRequestContext,
  account: AccountName,
): Promise<void> => {
  const response = await context.post('/api/auth/login', {
    data: { email: ACCOUNTS[account].email, password: E2E_PASSWORD },
  })
  expect(response.ok(), `Could not sign in as ${account}: ${response.status()}`).toBeTruthy()
}

export const signOut = async (page: Page): Promise<void> => {
  await page.request.post('/api/auth/logout')
}

/**
 * A second signed-in session, in its own browser context.
 *
 * Needed whenever a test has to act as two people at once — demoting a
 * moderator while that moderator's session is open, for instance. The
 * standalone `request` fixture cannot do this: the session cookie is `Secure`,
 * and Playwright's Node-side request context will not send a Secure cookie over
 * plain HTTP, so it silently arrives unauthenticated. A real browser context
 * does send it, because Chromium treats 127.0.0.1 as trustworthy.
 *
 * The caller closes the returned context.
 */
export const openSessionAs = async (
  browser: Browser,
  account: AccountName,
  clientAddress: string,
): Promise<{ page: Page; close: () => Promise<void> }> => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3111',
    extraHTTPHeaders: { 'x-real-ip': clientAddress },
  })
  await answerIntroTour(context)
  const page = await context.newPage()

  await signIn(page, account)
  await page.goto('/')

  return { page, close: () => context.close() }
}
