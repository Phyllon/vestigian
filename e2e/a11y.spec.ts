import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './helpers/fixtures'
import { signIn } from './helpers/auth'
import { gotoAndHydrate } from './helpers/hydration'

/**
 * Automated WCAG checks, on the built output, alongside everything else in
 * this suite that only ever broke in production. axe catches what a manual
 * pass misses at scale — missing accessible names, contrast regressions,
 * duplicate ids — but it cannot judge whether a keyboard *route* through the
 * page makes sense, so it complements the hand audits in CLAUDE.md rather
 * than replacing them.
 *
 * `wcag2a`/`wcag2aa`/`wcag21aa` only: axe also ships a `best-practice` set
 * that is opinionated beyond the standard (e.g. "prefer h1 as the first
 * heading"), which would fail this app's map-first layout for reasons that
 * are not actual conformance issues.
 */
const runAxe = (page: ConstructorParameters<typeof AxeBuilder>[0]['page']) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()

test.describe('accessibility', () => {
  test('the map shell has no automatically detectable violations', async ({ page }) => {
    await gotoAndHydrate(page, '/')
    const results = await runAxe(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  test('the login page has no automatically detectable violations', async ({ page }) => {
    await gotoAndHydrate(page, '/login')
    const results = await runAxe(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  test('the register page has no automatically detectable violations', async ({ page }) => {
    await gotoAndHydrate(page, '/register')
    const results = await runAxe(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  test('the open account menu has no automatically detectable violations', async ({ page }) => {
    await signIn(page, 'trusted')
    await gotoAndHydrate(page, '/')

    await page.getByRole('button', { name: /account menu/i }).click()
    await expect(page.getByRole('menuitem', { name: /my notebook/i })).toBeVisible()

    const results = await runAxe(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  test('the notebook and settings pages have no automatically detectable violations', async ({
    page,
  }) => {
    await signIn(page, 'trusted')

    await gotoAndHydrate(page, '/notebook')
    expect((await runAxe(page)).violations).toEqual([])

    await gotoAndHydrate(page, '/settings')
    expect((await runAxe(page)).violations).toEqual([])
  })
})
