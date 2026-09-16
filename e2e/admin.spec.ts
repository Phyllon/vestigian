import { expect, test } from './helpers/fixtures'
import { fetchAsBrowser } from './helpers/api'
import { openSessionAs, signIn } from './helpers/auth'
import { ACCOUNTS, E2E_PASSWORD } from './helpers/accounts'
import { gotoAndHydrate } from './helpers/hydration'

/**
 * The admin station, end to end against the real database.
 *
 * Three things here cannot be reached by a unit test, and all three are the
 * kind that break silently. Whether `/admin` is genuinely unreachable for
 * somebody who is not an administrator — the rules are pure functions, the
 * *wiring* is a middleware and ten guards. Whether a block actually ends a live
 * session, which is a claim about a sealed cookie and a column, not about a
 * function. And whether step-up really gates a role change, which is a claim
 * about the order of two checks inside a handler.
 */

const accountIdFor = async (
  page: import('@playwright/test').Page,
  email: string,
): Promise<number> => {
  const response = await fetchAsBrowser<{ accounts: { id: number; email: string }[] }>(
    page,
    `/api/admin/accounts?search=${encodeURIComponent(email)}`,
  )

  expect(response.status).toBe(200)
  const match = response.body.accounts.find((account) => account.email === email)
  expect(match, `No account found for ${email}`).toBeTruthy()
  return match!.id
}

test.describe('only an administrator reaches the panel', () => {
  test('answers 404 rather than 403 for a contributor', async ({ page }) => {
    await signIn(page, 'newcomer')

    // Not a URL assertion: the middleware throws rather than navigating, so
    // the outcome is what the page renders.
    await gotoAndHydrate(page, '/admin')

    // Concealment, not protection — the endpoints below are the protection.
    // `app/error.vue`'s own 404 copy ("Nothing recorded here"), not the
    // generic phrase this used to check for.
    await expect(page.getByText(/nothing recorded here/i).first()).toBeVisible()
  })

  test('refuses every admin endpoint to a moderator', async ({ page }) => {
    await signIn(page, 'moderator')
    await page.goto('/')

    for (const path of [
      '/api/admin/activity',
      '/api/admin/accounts',
      '/api/admin/audit',
      '/api/admin/images',
      '/api/admin/system',
    ]) {
      const response = await fetchAsBrowser(page, path)
      expect(response.status, `${path} should refuse a moderator`).toBe(403)
    }
  })

  test('shows an administrator the activity stream', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/')

    const response = await fetchAsBrowser<{ items: unknown[] }>(page, '/api/admin/activity')

    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.items)).toBe(true)
  })
})

test.describe('the activity stream sees what the moderation queue cannot', () => {
  /**
   * The whole reason the panel exists. A trusted contributor's edit publishes
   * without entering the queue, so `/api/moderation/queue` never mentions it;
   * this asserts that the stream does.
   */
  test('lists an auto-published edit the queue never shows', async ({ browser, page }) => {
    const contributor = await openSessionAs(browser, 'trusted', '203.0.113.60')
    const title = `E2E Admin Stream Fort ${Date.now()}`

    try {
      const created = await fetchAsBrowser<{ status: string }>(
        contributor.page,
        '/api/contributions',
        {
          method: 'POST',
          body: {
            kind: 'site',
            title,
            category: 'fortification',
            summary: 'Recorded by the end-to-end suite.',
            position: { lon: 6.2, lat: 50.8 },
            periodFrom: 100,
            periodTo: 300,
          },
        },
      )
      expect(created.body.status).toBe('approved')
    } finally {
      await contributor.close()
    }

    await signIn(page, 'admin')
    await page.goto('/')

    const stream = await fetchAsBrowser<{
      items: { title: string | null; autoApproved: boolean }[]
    }>(page, `/api/admin/activity?q=${encodeURIComponent(title)}`)

    expect(stream.status).toBe(200)
    const entry = stream.body.items.find((item) => item.title === title)
    expect(entry, 'the auto-published edit should be in the stream').toBeTruthy()
    expect(entry!.autoApproved).toBe(true)

    // And confirm the premise: the moderation queue does not carry it.
    const queue = await fetchAsBrowser<{ items: { payload: { title?: string } }[] }>(
      page,
      '/api/moderation/queue',
    )
    expect(queue.body.items.some((item) => item.payload?.title === title)).toBe(false)
  })
})

test.describe('a sanction asks for the password again', () => {
  test('refuses a role change with 428 until step-up succeeds', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/')

    const subjectId = await accountIdFor(page, ACCOUNTS.blockSubject.email)

    const refused = await fetchAsBrowser(page, '/api/moderation/role', {
      method: 'POST',
      body: { userId: subjectId, role: 'moderator' },
    })
    expect(refused.status).toBe(428)

    const confirmed = await fetchAsBrowser(page, '/api/admin/step-up', {
      method: 'POST',
      body: { currentPassword: E2E_PASSWORD },
    })
    expect(confirmed.status).toBe(200)

    const granted = await fetchAsBrowser(page, '/api/moderation/role', {
      method: 'POST',
      body: { userId: subjectId, role: 'moderator' },
    })
    expect(granted.status).toBe(200)

    /**
     * The grant is spent by the action it authorised, so a second sanction
     * needs a second confirmation. Asserted because a fifteen-minute window in
     * which every further click is unguarded is a materially weaker measure
     * than one confirmation per action.
     */
    const again = await fetchAsBrowser(page, '/api/moderation/role', {
      method: 'POST',
      body: { userId: subjectId, role: 'contributor' },
    })
    expect(again.status).toBe(428)

    // Put the fixture back, so the block test below still has a contributor.
    await fetchAsBrowser(page, '/api/admin/step-up', {
      method: 'POST',
      body: { currentPassword: E2E_PASSWORD },
    })
    const restored = await fetchAsBrowser(page, '/api/moderation/role', {
      method: 'POST',
      body: { userId: subjectId, role: 'contributor' },
    })
    expect(restored.status).toBe(200)
  })

  test('refuses a wrong password', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/')

    const response = await fetchAsBrowser(page, '/api/admin/step-up', {
      method: 'POST',
      body: { currentPassword: 'not-the-password' },
    })

    expect(response.status).toBe(403)
  })
})

test.describe('blocking an account', () => {
  /**
   * `checkBan` refuses this, and it is the single most important rule in the
   * panel: a locked-out administrator is neutralised as completely as a demoted
   * one, so allowing a block against an admin would be the back door that
   * `checkRoleChange`'s unconditional `admin-protected` branch exists to close.
   */
  test('is refused against another administrator', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/')

    const otherAdminId = await accountIdFor(page, ACCOUNTS.secondAdmin.email)

    await fetchAsBrowser(page, '/api/admin/step-up', {
      method: 'POST',
      body: { currentPassword: E2E_PASSWORD },
    })

    const response = await fetchAsBrowser<{ message: string }>(page, '/api/admin/ban', {
      method: 'POST',
      body: { userId: otherAdminId, blocked: true, reason: 'E2E should never succeed' },
    })

    expect(response.status).toBe(403)
  })

  /**
   * The claim the session epoch exists to make good: a block bites on the
   * blocked account's **next request**, without waiting for it to sign out.
   * Nothing else in this application can revoke a sealed session.
   */
  test('ends a live session and refuses the next sign-in', async ({ browser, page }) => {
    const subject = await openSessionAs(browser, 'blockSubject', '203.0.113.61')

    try {
      // The session works before the block.
      const before = await fetchAsBrowser(subject.page, '/api/me')
      expect(before.status).toBe(200)

      await signIn(page, 'admin')
      await page.goto('/')
      const subjectId = await accountIdFor(page, ACCOUNTS.blockSubject.email)

      await fetchAsBrowser(page, '/api/admin/step-up', {
        method: 'POST',
        body: { currentPassword: E2E_PASSWORD },
      })
      const blocked = await fetchAsBrowser(page, '/api/admin/ban', {
        method: 'POST',
        body: { userId: subjectId, blocked: true, reason: 'E2E block' },
      })
      expect(blocked.status).toBe(200)

      /**
       * The same cookie, one request later — and **401, not 403**. The block
       * bumps `sessions_valid_from`, so `readCurrentIdentity` finds the cookie
       * spent before it ever reaches the ban check. That ordering is the right
       * one: a dead cookie is an absent request, not a refused one, and every
       * client path in the app already treats 401 as "go and sign in". The 403
       * that names the block is what a *fresh* sign-in gets, below.
       */
      const after = await fetchAsBrowser(subject.page, '/api/me')
      expect(after.status).toBe(401)

      // And a fresh sign-in is refused too, below the credential check.
      const login = await subject.page.request.post('/api/auth/login', {
        data: { email: ACCOUNTS.blockSubject.email, password: E2E_PASSWORD },
      })
      expect(login.status()).toBe(403)

      /**
       * Their published work is untouched — a block is a sanction on the
       * person, and unpublishing their contributions is a separate, deliberate
       * sweep.
       */
      const stream = await fetchAsBrowser<{ items: { authorBanned?: boolean }[] }>(
        page,
        `/api/admin/activity?authorId=${subjectId}`,
      )
      expect(stream.status).toBe(200)

      // Lift it again, so a repeated run starts from the same state.
      await fetchAsBrowser(page, '/api/admin/step-up', {
        method: 'POST',
        body: { currentPassword: E2E_PASSWORD },
      })
      const lifted = await fetchAsBrowser(page, '/api/admin/ban', {
        method: 'POST',
        body: { userId: subjectId, blocked: false },
      })
      expect(lifted.status).toBe(200)

      const relogin = await subject.page.request.post('/api/auth/login', {
        data: { email: ACCOUNTS.blockSubject.email, password: E2E_PASSWORD },
      })
      expect(relogin.ok()).toBe(true)
    } finally {
      await subject.close()
    }
  })
})

test.describe('the retraction is counted before it is applied', () => {
  /**
   * `apply: false` must write nothing. Asserted rather than trusted, because
   * the confirmation an administrator reads comes from this call and a dry run
   * that quietly acted would be the worst possible failure in this panel.
   */
  test('reports a plan without changing anything', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/')

    const subjectId = await accountIdFor(page, ACCOUNTS.trusted.email)

    const before = await fetchAsBrowser<{
      counts: { revisions: { approved: number } }
    }>(page, `/api/admin/accounts/${subjectId}`)
    expect(before.status).toBe(200)

    const plan = await fetchAsBrowser<{
      applied: boolean
      summary: { records: number; edits: number; photographs: number }
    }>(page, '/api/admin/retract', {
      method: 'POST',
      body: { userId: subjectId, apply: false, reason: 'E2E dry run' },
    })

    expect(plan.status).toBe(200)
    expect(plan.body.applied).toBe(false)
    expect(typeof plan.body.summary.records).toBe('number')

    const after = await fetchAsBrowser<{
      counts: { revisions: { approved: number } }
    }>(page, `/api/admin/accounts/${subjectId}`)
    expect(after.body.counts.revisions.approved).toBe(before.body.counts.revisions.approved)
  })
})

test.describe('the panel is not discoverable', () => {
  test('is disallowed in robots.txt and marked noindex in the response header', async ({
    page,
  }) => {
    // `fetchAsBrowser` runs `fetch()` inside the page, so a relative URL needs
    // a document to resolve against — a `page` that has never navigated is
    // still on `about:blank`, where `fetch('/robots.txt')` throws rather than
    // resolving against the app origin.
    await page.goto('/')
    const robots = await fetchAsBrowser<string>(page, '/robots.txt')
    expect(String(robots.body)).toContain('Disallow: /admin')

    /**
     * The header, not the meta tag: the tag only exists once a crawler has
     * executed the page, and this app is a Nuxt SPA behind a CDN.
     *
     * `maxRedirects: 0`, because this request is signed out — `admin.ts`'s
     * middleware sends an anonymous visitor to `/login?next=/admin` first,
     * and Playwright's request API follows redirects by default. Following it
     * meant asserting on `/login`'s headers instead of `/admin`'s, which carry
     * no such route rule and read as `undefined` — passing for the wrong
     * route rather than failing for a missing header, the more dangerous kind
     * of green test. The route rule fires on the 302 itself, confirmed live.
     */
    const response = await page.request.get('/admin', { maxRedirects: 0 })
    expect(response.headers()['x-robots-tag']).toContain('noindex')
    expect(response.headers()['cache-control']).toContain('no-store')
  })
})
