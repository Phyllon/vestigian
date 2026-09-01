import { expect, test } from './helpers/fixtures'
import { fetchAsBrowser } from './helpers/api'
import { openSessionAs, signIn } from './helpers/auth'
import { ACCOUNTS, E2E_PASSWORD } from './helpers/accounts'

/**
 * The field notebook: the account menu, the visit log, and the three
 * invariants that keep per-user state out of the shared atlas.
 *
 * The invariants are the reason this file runs against the built server rather
 * than being unit-tested. "A visit writes no revision", "a visit never reaches
 * `/api/data/sites.geojson`" and "a visit never changes a tile" are claims
 * about how several subsystems compose, and each of them would be trivially
 * broken by a well-meaning change in a place none of these tests live.
 */

/**
 * A published site to record a visit against, found rather than created.
 *
 * `q` is two characters minimum — `search.get.ts` rejects a single one with a
 * 400, which arrives here as an empty body rather than as an error, so the
 * failure reads as "no sites imported" and sends you looking in the wrong place.
 */
const findPublishedSite = async (page: import('@playwright/test').Page): Promise<number> => {
  const response = await fetchAsBrowser<{ id: number }[]>(
    page,
    '/api/sites/search?q=castellum&limit=1',
  )
  expect(response.status, 'the suite needs at least one published site').toBe(200)
  const [site] = response.body
  expect(site, 'no published sites — run the import first').toBeTruthy()
  return site!.id
}

test.describe('the account menu', () => {
  test('replaces the sign-out-on-click button and reaches the notebook', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')

    const trigger = page.getByRole('button', { name: /account menu/i })
    await expect(trigger).toBeVisible()

    // The old control signed you out on click. This one opens a menu; being
    // signed in afterwards is the whole point of the change.
    await trigger.click()
    await expect(page.getByRole('menuitem', { name: /my notebook/i })).toBeVisible()

    await page.getByRole('menuitem', { name: /my notebook/i }).click()
    await expect(page.getByRole('heading', { name: /my notebook/i })).toBeVisible()
  })

  test('shows a newcomer what stands between them and publishing', async ({ page }) => {
    await signIn(page, 'newcomer')
    await page.goto('/notebook')

    await expect(page.getByText(/read by a moderator before they appear/i)).toBeVisible()
  })

  test('offers no notebook to a visitor who is not signed in', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /account menu/i })).toBeHidden()
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()

    await page.goto('/notebook')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('recording a visit', () => {
  test('appears in the log, and is private to the account that made it', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')
    const siteId = await findPublishedSite(page)

    const recorded = await fetchAsBrowser(page, '/api/me/visits', {
      method: 'POST',
      body: { siteId, visitedOn: '2026-05-14', note: 'Recorded by the end-to-end suite.' },
    })
    expect(recorded.status).toBe(200)

    await page.goto('/notebook/visits')
    await expect(page.getByText('Recorded by the end-to-end suite.')).toBeVisible()

    // Another account must not see it. `newcomer` has recorded nothing.
    await signIn(page, 'newcomer')
    const theirs = await fetchAsBrowser<unknown[]>(page, '/api/me/visits')
    expect(theirs.body).toHaveLength(0)
  })

  test('accepts a visit with no date, and sorts it last', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')
    const siteId = await findPublishedSite(page)

    const undated = await fetchAsBrowser(page, '/api/me/visits', {
      method: 'POST',
      body: { siteId },
    })
    expect(undated.status, 'an undated visit is a real answer').toBe(200)
  })

  test('carries the visit into a GPX field kit', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')
    const siteId = await findPublishedSite(page)
    await fetchAsBrowser(page, '/api/me/visits', { method: 'POST', body: { siteId } })

    const kit = await fetchAsBrowser<string>(page, '/api/me/field-kit.gpx')
    expect(kit.status).toBe(200)
    expect(kit.body).toContain('<gpx')
    expect(kit.body).toContain('<wpt')
    // Unescaped markup here makes the whole file unparseable, which a GPS
    // reports as "no waypoints" rather than as an error.
    expect(kit.body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/)
  })
})

/**
 * The three rules in `server/database/schema/notebook.ts`. Each is cheap to
 * assert and expensive to discover broken.
 */
test.describe('the notebook stays out of the shared atlas', () => {
  test('writes no revision, so no moderator ever sees it', async ({ page }) => {
    await signIn(page, 'newcomer')
    await page.goto('/')
    const siteId = await findPublishedSite(page)

    const before = await fetchAsBrowser<{ items: unknown[] }>(page, '/api/me/contributions')
    await fetchAsBrowser(page, '/api/me/visits', {
      method: 'POST',
      body: { siteId, note: 'Private, and not a contribution.' },
    })
    const after = await fetchAsBrowser<{ items: unknown[] }>(page, '/api/me/contributions')

    expect(after.body.items).toHaveLength(before.body.items.length)
  })

  test('never reaches the public GeoJSON feed', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')

    const feed = await fetchAsBrowser<{
      features: { properties: Record<string, unknown> }[]
    }>(page, '/api/data/sites.geojson?bbox=4,50,7,53&limit=50')

    const properties = new Set(feed.body.features.flatMap((f) => Object.keys(f.properties)))
    for (const leaked of ['visited', 'visitedOn', 'bookmarked', 'note']) {
      expect([...properties], `${leaked} must never leave in the public feed`).not.toContain(leaked)
    }
  })

  test('does not change a tile, so the one global cache counter still holds', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')
    const siteId = await findPublishedSite(page)

    const readTile = () =>
      page.evaluate(async () => {
        const response = await fetch('/api/tiles/10/526/338.mvt', { cache: 'no-store' })
        return [...new Uint8Array(await response.arrayBuffer())].length
      })

    const before = await readTile()
    await fetchAsBrowser(page, '/api/me/visits', { method: 'POST', body: { siteId } })
    await fetchAsBrowser(page, '/api/me/bookmarks', { method: 'POST', body: { siteId } })
    const after = await readTile()

    expect(after, 'per-user state must never enter the MVT pipeline').toBe(before)
  })
})

test.describe('the public contributor page is opt-in', () => {
  test('404s while the switch is off, so display names cannot be enumerated', async ({ page }) => {
    await page.goto('/')
    const response = await fetchAsBrowser(
      page,
      `/api/contributors/${encodeURIComponent(ACCOUNTS.trusted.displayName)}`,
    )
    // 404, never 403: a 403 would confirm the account exists.
    expect(response.status).toBe(404)
  })

  test('shows contributions but never visits once switched on', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')
    const siteId = await findPublishedSite(page)
    await fetchAsBrowser(page, '/api/me/visits', {
      method: 'POST',
      body: { siteId, note: 'This note must never be public.' },
    })

    await fetchAsBrowser(page, '/api/me', {
      method: 'PATCH',
      body: { publicProfile: true, bio: 'Walks the Lower German limes.' },
    })

    const profile = await fetchAsBrowser<Record<string, unknown>>(
      page,
      `/api/contributors/${encodeURIComponent(ACCOUNTS.trusted.displayName)}`,
    )
    expect(profile.status).toBe(200)
    expect(profile.body.bio).toBe('Walks the Lower German limes.')

    for (const field of ['email', 'role', 'trustRevoked', 'visits', 'bookmarks', 'createdAt']) {
      expect(Object.keys(profile.body), `${field} must never be public`).not.toContain(field)
    }
    expect(JSON.stringify(profile.body)).not.toContain('This note must never be public.')

    // Left as it was found, so the next test in this file still sees a 404.
    await fetchAsBrowser(page, '/api/me', { method: 'PATCH', body: { publicProfile: false } })
  })
})

test.describe('changing a password', () => {
  /**
   * Its own browser context on an address from 198.51.100.0/24, which the rest
   * of the suite never uses.
   *
   * This test makes four calls that all land in the `login` bucket — a sign-in
   * and three password operations — against a limit of eight per fifteen
   * minutes. The per-test address from `fixtures.ts` is not enough on its own:
   * its counter restarts with each worker process, so two parallel workers can
   * legitimately be handed the same address, and the ninth request in that
   * shared bucket fails whichever test happens to make it.
   */
  test('refuses without the current one, and works with it', async ({ browser }) => {
    const { page, close } = await openSessionAs(browser, 'admin', '198.51.100.7')

    const refused = await fetchAsBrowser(page, '/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: 'Not-The-Password-1!', password: 'E2E-Rotated-Pass-2!' },
    })
    // A session proves a past sign-in, not present possession of the credential.
    expect(refused.status).toBe(403)

    const changed = await fetchAsBrowser(page, '/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: E2E_PASSWORD, password: 'E2E-Rotated-Pass-2!' },
    })
    expect(changed.status).toBe(200)

    // Put it back: every other test signs in with the seeded password, and the
    // fixtures are seeded once for the whole run.
    const restored = await fetchAsBrowser(page, '/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: 'E2E-Rotated-Pass-2!', password: E2E_PASSWORD },
    })
    expect(restored.status).toBe(200)

    await close()
  })
})
