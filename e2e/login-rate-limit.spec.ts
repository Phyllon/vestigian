import type { Page } from '@playwright/test'
import { expect, test } from './helpers/fixtures'
import { ACCOUNTS, E2E_PASSWORD } from './helpers/accounts'
import { gotoAndHydrate } from './helpers/hydration'

/**
 * What a person sees when the sign-in limit bites, and just before.
 *
 * The login endpoint is answered by `page.route` here, not by the server. The
 * real limit is eight attempts per fifteen minutes per address, and exhausting
 * it for real is exactly the shared-budget trap `helpers/fixtures.ts` exists to
 * avoid; what is under test is how the form *reads* a refusal, and that is the
 * same whatever produced it. The server's side — the structured `data` on the
 * 429 — is covered by the unit tests around `readRateLimitFailure`.
 */

const refuseAsRateLimited = async (
  page: Page,
  retryAfterSeconds: number,
  endpoint = '**/api/auth/login',
): Promise<void> => {
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'retry-after': String(retryAfterSeconds) },
      body: JSON.stringify({
        statusCode: 429,
        statusMessage: 'Too many requests',
        message: `Too many attempts. Try again in ${retryAfterSeconds} seconds.`,
        data: { retryAfterSeconds, policy: 'login' },
      }),
    }),
  )
}

const refuseAsWrongPassword = async (page: Page, attemptsRemaining: number): Promise<void> => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 401,
        message: 'That email and password do not match.',
        data: { attemptsRemaining },
      }),
    }),
  )
}

const submitCredentials = async (page: Page): Promise<void> => {
  await gotoAndHydrate(page, '/login')
  await page.getByLabel('Email').fill(ACCOUNTS.trusted.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
}

test.describe('hitting the sign-in limit', () => {
  test('says so in minutes, in the interface language, and pauses the button', async ({ page }) => {
    await refuseAsRateLimited(page, 893)
    await submitCredentials(page)

    const alert = page.getByRole('alert').filter({ hasText: /too many attempts/i })
    await expect(alert).toBeVisible({ timeout: 10_000 })
    // 893 seconds is fifteen minutes to a person, not a number to divide.
    await expect(alert).toContainText(/15 minutes/i)
    await expect(alert).not.toContainText(/893|seconds/i)

    const button = page.getByRole('button', { name: /try again in/i })
    await expect(button).toBeDisabled()
    await expect(button).toContainText(/15 minutes/i)
  })

  test('is not confused with a wrong password', async ({ page }) => {
    await refuseAsRateLimited(page, 120)
    await submitCredentials(page)

    await expect(page.getByRole('alert').filter({ hasText: /too many attempts/i })).toBeVisible({
      timeout: 10_000,
    })
    // The red toast that means "your details were wrong" must not appear.
    await expect(page.getByText(/could not sign in/i)).toHaveCount(0)
    await expect(page.getByText(/do not match/i)).toHaveCount(0)
  })

  test('counts down in seconds near the end', async ({ page }) => {
    await refuseAsRateLimited(page, 20)
    await submitCredentials(page)

    const button = page.getByRole('button', { name: /try again in/i })
    await expect(button).toContainText(/\d{1,2} seconds?/i, { timeout: 10_000 })
    await expect(button).toBeDisabled()
  })
})

test.describe('approaching the sign-in limit', () => {
  test('warns when only a few attempts are left', async ({ page }) => {
    await refuseAsWrongPassword(page, 2)
    await submitCredentials(page)

    await expect(page.getByRole('status').filter({ hasText: /2 attempts left/i })).toBeVisible({
      timeout: 10_000,
    })
    // Still a normal refusal: the form stays usable.
    await expect(page.getByRole('button', { name: /sign in/i })).toBeEnabled()
  })

  test('says nothing while there is plenty of room', async ({ page }) => {
    await refuseAsWrongPassword(page, 6)
    await submitCredentials(page)

    await expect(page.getByText(/do not match/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/attempts? left/i)).toHaveCount(0)
  })
})

test.describe('the same refusal on the other forms', () => {
  test('forgot-password says so instead of promising a mail that was never sent', async ({
    page,
  }) => {
    await refuseAsRateLimited(page, 2400, '**/api/auth/forgot-password')
    await gotoAndHydrate(page, '/forgot-password')
    await page.getByLabel('Email').fill(ACCOUNTS.trusted.email)
    await page.getByRole('button', { name: /send/i }).click()

    const alert = page.getByRole('alert').filter({ hasText: /too many attempts/i })
    await expect(alert).toBeVisible({ timeout: 10_000 })
    await expect(alert).toContainText(/40 minutes/i)
    await expect(page.getByText(/check your inbox/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /try again in/i })).toBeDisabled()
  })

  test('forgot-password still shows the same confirmation for any other failure', async ({
    page,
  }) => {
    // Not a rate limit: the page must not become a way to tell which addresses
    // have accounts, so a server error reads exactly like success.
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":500}' }),
    )
    await gotoAndHydrate(page, '/forgot-password')
    await page.getByLabel('Email').fill('nobody@e2e.local')
    await page.getByRole('button', { name: /send/i }).click()

    await expect(page.getByText(/check your inbox/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('alert').filter({ hasText: /too many/i })).toHaveCount(0)
  })

  test('reset-password pauses its button rather than showing a failure toast', async ({ page }) => {
    await refuseAsRateLimited(page, 893, '**/api/auth/reset-password')
    await gotoAndHydrate(page, '/reset-password?token=not-a-real-token')
    await page.getByLabel('New password', { exact: false }).first().fill(E2E_PASSWORD)
    await page.getByLabel(/repeat/i).fill(E2E_PASSWORD)
    await page.getByRole('button', { name: /save/i }).click()

    await expect(page.getByRole('alert').filter({ hasText: /too many attempts/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('button', { name: /try again in/i })).toBeDisabled()
  })
})

test.describe('every other form that prints the server message', () => {
  // `/verify` prints `error.data.message` verbatim, as roughly fifteen other
  // places do. The client plugin rewrites it, so none of them needs to know.
  test('shows a refusal in minutes and in the interface language, not the server sentence', async ({
    page,
  }) => {
    await refuseAsRateLimited(page, 893, '**/api/auth/verify')
    await gotoAndHydrate(page, '/verify?token=anything')

    const card = page.getByText(/too many requests from this connection/i)
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText(/15 minutes/i)
    await expect(page.getByText(/893 seconds/i)).toHaveCount(0)
  })

  test('leaves a 429 that does not say how long exactly as it arrived', async ({ page }) => {
    // A proxy's 429: no structured data, no Retry-After. The plugin must not
    // invent a wait to print.
    await page.route('**/api/auth/verify', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 429, message: 'Slow down.' }),
      }),
    )
    await gotoAndHydrate(page, '/verify?token=anything')

    await expect(page.getByText('Slow down.')).toBeVisible({ timeout: 10_000 })
  })
})
