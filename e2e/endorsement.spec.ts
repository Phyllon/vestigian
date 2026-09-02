import type { Page } from '@playwright/test'
import { expect, test } from './helpers/fixtures'
import { signIn } from './helpers/auth'
import { fetchAsBrowser } from './helpers/api'
import { gotoAndHydrate } from './helpers/hydration'

const SITE_PATH = '/api/data/sites.geojson?limit=1'

/**
 * Clicks an endorsement toggle, then confirms the server actually agrees —
 * by asking it directly, not by intercepting the request the click fired.
 *
 * `useSiteEndorsement` updates the button optimistically before its request
 * settles, so a plain `.click()` followed only by a UI assertion can pass a
 * beat before the server has recorded anything, which matters here because
 * every test in this file reuses the same fixture site and a later test
 * needs an earlier one's cleanup to have actually landed. `waitForResponse`
 * keyed on the request URL was tried first and proved flaky — polling the
 * record itself is a stronger assertion regardless: it is the fact this test
 * cares about, not a proxy for it.
 */
interface ToggleAndConfirmInput {
  page: Page
  buttonName: RegExp
  slug: string
  expectEndorsed: boolean
}

const toggleAndConfirm = async ({
  page,
  buttonName,
  slug,
  expectEndorsed,
}: ToggleAndConfirmInput): Promise<void> => {
  await page.getByRole('button', { name: buttonName }).click()
  await expect
    .poll(async () => {
      const response = await fetchAsBrowser<{ endorsedByMe: boolean }>(
        page,
        `/api/sites/slug/${slug}`,
      )
      return response.body.endorsedByMe
    })
    .toBe(expectEndorsed)
}

/**
 * "Found this useful" — a general, positive-only signal open to any
 * signed-in reader, decoupled from the private visit log. See
 * `server/database/schema/endorsements.ts` for why its count is public where
 * a visit's would not be.
 */
test.describe('endorsing a site', () => {
  test('toggles from the site page, updates the public count, and is idempotent', async ({
    page,
    request,
  }) => {
    const feed = await (await request.get(SITE_PATH)).json()
    const { slug } = feed.features[0].properties as { slug: string }

    await signIn(page, 'trusted')
    await gotoAndHydrate(page, `/site/${slug}`)

    const button = page.getByRole('button', { name: /found this useful/i })
    await expect(button).toBeVisible()

    await toggleAndConfirm({ page, buttonName: /^found this useful$/i, slug, expectEndorsed: true })
    await expect(page.getByRole('button', { name: /you found this useful/i })).toBeVisible()
    await expect(page.getByText(/1 person found this useful/i)).toBeVisible()

    // Withdrawing is the same control, toggled back — and left that way, for
    // the tests after this one in the same file.
    await toggleAndConfirm({
      page,
      buttonName: /you found this useful/i,
      slug,
      expectEndorsed: false,
    })
    await expect(page.getByRole('button', { name: /^found this useful$/i })).toBeVisible()
    await expect(page.getByText(/found this useful/i, { exact: false })).not.toContainText(
      '1 person',
    )
  })

  test('is visible to a signed-out reader as a count only, never a control', async ({
    page,
    request,
  }) => {
    const feed = await (await request.get(SITE_PATH)).json()
    const { slug } = feed.features[0].properties as { slug: string }

    await signIn(page, 'trusted')
    await gotoAndHydrate(page, `/site/${slug}`)
    await toggleAndConfirm({ page, buttonName: /^found this useful$/i, slug, expectEndorsed: true })
    await expect(page.getByText(/1 person found this useful/i)).toBeVisible()

    await page.request.post('/api/auth/logout')
    await gotoAndHydrate(page, `/site/${slug}`)

    await expect(page.getByText(/1 person found this useful/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /found this useful/i })).toBeHidden()

    // Clean up: sign back in to withdraw, so this test does not leave a
    // permanent mark on a real fixture record for the next run.
    await signIn(page, 'trusted')
    await gotoAndHydrate(page, `/site/${slug}`)
    await toggleAndConfirm({
      page,
      buttonName: /you found this useful/i,
      slug,
      expectEndorsed: false,
    })
  })

  test('never reveals who endorsed, even to a moderator', async ({ page, request }) => {
    const feed = await (await request.get(SITE_PATH)).json()
    const { slug } = feed.features[0].properties as { slug: string }

    await signIn(page, 'trusted')
    await gotoAndHydrate(page, `/site/${slug}`)
    await toggleAndConfirm({ page, buttonName: /^found this useful$/i, slug, expectEndorsed: true })
    await expect(page.getByText(/1 person found this useful/i)).toBeVisible()

    await signIn(page, 'moderator')
    const response = await fetchAsBrowser<Record<string, unknown>>(page, `/api/sites/slug/${slug}`)
    expect(JSON.stringify(response.body)).not.toContain('trusted@e2e.local')
    expect(JSON.stringify(response.body)).not.toContain('E2E Trusted')

    // Clean up.
    await signIn(page, 'trusted')
    await gotoAndHydrate(page, `/site/${slug}`)
    await toggleAndConfirm({
      page,
      buttonName: /you found this useful/i,
      slug,
      expectEndorsed: false,
    })
  })
})
