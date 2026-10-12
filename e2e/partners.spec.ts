import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'

/**
 * The build runs with `NUXT_PUBLIC_SHOW_EXAMPLE_PARTNERS=true` (see
 * `playwright.config.ts`), so the page lists its three invented organisations. A
 * real deployment shows none until a source has agreed to be named.
 */
test.describe('the partners page', () => {
  test('is reachable from the menu and says its partners are examples', async ({ page }) => {
    const problems = watchForProblems(page)

    await page.goto('/about')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Partners' }).click()

    await expect(page).toHaveURL(/\/partners$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Partners' })).toBeVisible()
    await expect(
      page.getByText('no real organisation has agreed to be listed here', { exact: false }),
    ).toBeVisible()

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('lists partners alphabetically, each with its words, what is drawn and how to cite', async ({
    page,
  }) => {
    await page.goto('/partners')

    const names = await page.getByRole('heading', { level: 3 }).allInnerTexts()
    expect(names.length).toBeGreaterThanOrEqual(3)
    expect(names, 'the order is alphabetical, never by agreement or importance').toEqual(
      [...names].sort((first, second) =>
        first.localeCompare(second, 'en', { sensitivity: 'base' }),
      ),
    )

    const card = page.getByRole('article').filter({ hasText: 'Example Harbours Database' })
    await expect(card.getByText('Example', { exact: true })).toBeVisible()
    await expect(card.getByText('In their words')).toBeVisible()
    await expect(card.getByText('Drawn on the map')).toBeVisible()
    await expect(card.getByText('How to cite')).toBeVisible()
    await expect(card.getByText('1,240 records')).toBeVisible()
  })

  test('sends a reader to a partner in a new tab, without handing it our page', async ({
    page,
  }) => {
    await page.goto('/partners')

    const link = page.getByRole('link', { name: /Visit Example Harbours Database/ })
    await expect(link).toHaveAttribute('href', 'https://example.org/harbours')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
  })

  test('serves every mark and badge from our own origin', async ({ page }) => {
    const foreign: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.pathname.startsWith('/partner-assets/') &&
        url.origin !== new URL(page.url()).origin
      ) {
        foreign.push(request.url())
      }
    })

    await page.goto('/partners')

    for (const path of [
      '/partner-assets/examples/harbours.svg',
      '/partner-assets/examples/coins.svg',
      '/partner-assets/badge/seen-on-vestigian.en.svg',
      '/partner-assets/badge/seen-on-vestigian.de.svg',
    ]) {
      const response = await page.request.get(path)
      expect(response.status(), path).toBe(200)
      expect(response.headers()['content-type'], path).toContain('image/svg+xml')
    }
    expect(foreign).toEqual([])
  })

  test('offers the badge for download in each interface language, with markup to paste', async ({
    page,
  }) => {
    await page.goto('/partners')

    const downloads = page.getByRole('link', {
      name: /English|Français|Español|Deutsch|Italiano|Nederlands/,
    })
    await expect(downloads).toHaveCount(6)
    await expect(page.getByRole('link', { name: 'Deutsch' })).toHaveAttribute(
      'href',
      '/partner-assets/badge/seen-on-vestigian.de.svg',
    )

    const markup = page.locator('pre code')
    await expect(markup).toContainText('<a href=')
    await expect(markup).toContainText('seen-on-vestigian.en.svg')
    // The file name is bare because the partner hosts the file; the comment says where it goes.
    await expect(markup).toContainText('<!-- Save the badge file next to this page')
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 667 } })

    test('does not scroll sideways', async ({ page }) => {
      await page.goto('/partners')
      await expect(page.getByRole('heading', { level: 1, name: 'Partners' })).toBeVisible()

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflows).toBe(false)
    })
  })
})
