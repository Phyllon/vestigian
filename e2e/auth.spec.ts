import { expect, test } from './helpers/fixtures'
import { ACCOUNTS, E2E_PASSWORD } from './helpers/accounts'
import { openSessionAs, signIn, signOut } from './helpers/auth'
import { fetchAsBrowser } from './helpers/api'
import { watchForProblems } from './helpers/console'
import { gotoAndHydrate } from './helpers/hydration'

test.describe('signing in', () => {
  test('signs in through the form and reaches the map', async ({ page }) => {
    const problems = watchForProblems(page)

    await gotoAndHydrate(page, '/login')
    await page.getByLabel('Email').fill(ACCOUNTS.trusted.email)
    await page.getByLabel('Password').fill(E2E_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()

    // Assert on the outcome, not on the URL: the form navigates only after the
    // session has been re-fetched, so a URL check races that round trip and
    // fails for a reason unrelated to signing in.
    await expect(page.getByText(ACCOUNTS.trusted.displayName).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page).not.toHaveURL(/\/login/)
    expect(problems.cspViolations).toEqual([])
  })

  test('refuses a wrong password without saying which half was wrong', async ({ page }) => {
    await gotoAndHydrate(page, '/login')
    await page.getByLabel('Email').fill(ACCOUNTS.trusted.email)
    await page.getByLabel('Password').fill('Definitely-Not-It-9!')
    await page.getByRole('button', { name: /sign in/i }).click()

    const message = page.getByText(/do not match/i).first()
    await expect(message).toBeVisible({ timeout: 10_000 })

    // The endpoint hashes against DUMMY_HASH so a missing account and a wrong
    // password are indistinguishable. The message must not undo that.
    await expect(message).not.toContainText(/no such|unknown|not found|no account/i)
  })

  test('gives an unknown address the identical answer', async ({ request }) => {
    const unknown = await request.post('/api/auth/login', {
      data: { email: 'nobody@e2e.local', password: E2E_PASSWORD },
    })
    const wrongPassword = await request.post('/api/auth/login', {
      data: { email: ACCOUNTS.trusted.email, password: 'Definitely-Not-It-9!' },
    })

    expect(unknown.status()).toBe(wrongPassword.status())
    expect(await unknown.json()).toMatchObject({ message: (await wrongPassword.json()).message })
  })

  /**
   * The dead end this closed: an account that never confirmed its address could
   * not sign in, the first link was worth nothing after a day, and nothing else
   * issued another. The second attempt proves the throttle, which is the reason
   * the branch cannot be used to send mail at somebody — and it only runs at
   * all once the password has already matched, so it reveals nothing a wrong
   * password would not.
   */
  test('re-sends the confirmation link to an unconfirmed account, once', async ({ request }) => {
    const first = await request.post('/api/auth/login', {
      data: { email: ACCOUNTS.unverified.email, password: E2E_PASSWORD },
    })
    const second = await request.post('/api/auth/login', {
      data: { email: ACCOUNTS.unverified.email, password: E2E_PASSWORD },
    })

    expect(first.status()).toBe(403)
    expect((await first.json()).message).toMatch(/fresh link/i)

    expect(second.status()).toBe(403)
    expect((await second.json()).message).toMatch(/sent recently/i)
  })

  test('does not re-send anything when the password is wrong', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: { email: ACCOUNTS.unverified.email, password: 'Definitely-Not-It-9!' },
    })

    expect(response.status()).toBe(401)
    expect((await response.json()).message).not.toMatch(/link/i)
  })
})

test.describe('route guards', () => {
  test('sends an anonymous visitor from /moderation to the login page', async ({ page }) => {
    await page.goto('/moderation')
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 10_000 })
  })

  test('refuses a signed-in contributor', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/moderation')

    // The middleware throws a 403 rather than redirecting — a contributor is
    // authenticated, just not permitted.
    // `app/error.vue` renders the 403 in the project's own words rather than
    // echoing the status message.
    await expect(page.getByRole('heading', { name: 'Not yours to open' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('This page is for moderators.')).toBeVisible()
  })

  test('admits a moderator', async ({ page }) => {
    await signIn(page, 'moderator')
    await page.goto('/moderation')
    await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible()
  })

  test('stops moderating the moment the role is taken away', async ({
    page,
    browser,
    clientAddress,
  }) => {
    await signIn(page, 'moderator')
    await page.goto('/')

    expect(
      (await fetchAsBrowser(page, '/api/moderation/queue')).status,
      'the moderator could not read the queue to begin with',
    ).toBe(200)

    // A separate admin session, because this test needs two people acting at
    // the same time.
    const admin = await openSessionAs(browser, 'admin', `${clientAddress}0`)

    try {
      const listing = await fetchAsBrowser<{ contributors: { id: number; displayName: string }[] }>(
        admin.page,
        '/api/moderation/users',
      )
      expect(listing.status).toBe(200)

      const moderator = listing.body.contributors.find(
        (row) => row.displayName === ACCOUNTS.moderator.displayName,
      )
      expect(moderator, 'the moderator was not in the contributor listing').toBeDefined()

      const demotion = await fetchAsBrowser(admin.page, '/api/moderation/role', {
        method: 'POST',
        body: { userId: moderator!.id, role: 'contributor' },
      })
      expect(demotion.status).toBe(200)

      // The moderator's session cookie still says "moderator" — it is sealed at
      // login and nothing refreshes it. `requireModerator` re-reads the role
      // from Postgres, which is the only reason a demotion bites before the
      // next sign-in.
      expect((await fetchAsBrowser(page, '/api/moderation/queue')).status).toBe(403)

      // Restore, so the order tests run in cannot matter.
      await fetchAsBrowser(admin.page, '/api/moderation/role', {
        method: 'POST',
        body: { userId: moderator!.id, role: 'moderator' },
      })
    } finally {
      await admin.close()
    }
  })
})

test.describe('the registration form', () => {
  test('checks the password rules as they are typed', async ({ page }) => {
    await gotoAndHydrate(page, '/register')

    const password = page.getByLabel('Password', { exact: true })
    await password.fill('short')

    // All three rules are always listed, met or not — a checklist that only
    // shows failures makes the requirements look like they are growing.
    await expect(page.getByText('Between 12 and 30 characters')).toBeVisible()
    await expect(page.getByText('One capital letter')).toBeVisible()
    await expect(page.getByText('One special character')).toBeVisible()

    await expect(page.getByRole('button', { name: /create account/i })).toBeDisabled()
  })

  test('reveals the password on request', async ({ page }) => {
    await gotoAndHydrate(page, '/register')

    const password = page.getByLabel('Password', { exact: true })
    await password.fill('Perfectly-Fine-1!')
    await expect(password).toHaveAttribute('type', 'password')

    // Two fields carry a reveal button; this is the first one's.
    await page.getByRole('button', { name: 'Show password' }).first().click()
    await expect(password).toHaveAttribute('type', 'text')

    await page.getByRole('button', { name: 'Hide password' }).first().click()
    await expect(password).toHaveAttribute('type', 'password')
  })

  test('stays disabled until the challenge is solved, then registers', async ({ page }) => {
    await gotoAndHydrate(page, '/register')

    const unique = Date.now()
    await page.getByLabel('Display name').fill(`E2E Signup ${unique}`)
    await page.getByLabel('Email').fill(`signup-${unique}@e2e.local`)
    await page.getByLabel('Password', { exact: true }).fill('Perfectly-Fine-1!')
    await page.getByLabel('Repeat password').fill('Perfectly-Fine-1!')

    const submit = page.getByRole('button', { name: /create account/i })

    // Every field is valid and it is still refused: the proof of work has not
    // been done. That is the whole defence, so it is worth asserting directly.
    await expect(submit).toBeDisabled()

    // Playwright pierces the widget's shadow DOM.
    await page.getByText("I'm not a robot").click()
    await expect(submit).toBeEnabled({ timeout: 30_000 })

    await submit.click()
    await expect(page.getByText(/check your (email|inbox)|verification/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('refuses a display name that is already taken', async ({ page }) => {
    await gotoAndHydrate(page, '/register')

    await page.getByLabel('Display name').fill(ACCOUNTS.trusted.displayName)
    await page.getByLabel('Email').fill(`fresh-${Date.now()}@e2e.local`)
    await page.getByLabel('Password', { exact: true }).fill('Perfectly-Fine-1!')
    await page.getByLabel('Repeat password').fill('Perfectly-Fine-1!')
    await page.getByText("I'm not a robot").click()

    const submit = page.getByRole('button', { name: /create account/i })
    await expect(submit).toBeEnabled({ timeout: 30_000 })
    await submit.click()

    // Reported rather than swallowed, deliberately: a form that silently does
    // nothing is a dead end for someone who forgot they had signed up.
    await expect(page.getByText(/already taken/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('loads no third-party script', async ({ page }) => {
    const external: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() !== 'script') return
      const host = new URL(request.url()).host
      if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost')) external.push(host)
    })

    await page.goto('/register')
    await page.waitForLoadState('domcontentloaded')

    // ALTCHA replaced Turnstile precisely so this list stays empty.
    expect(external).toEqual([])
  })
})

test.describe('signing out', () => {
  test('clears the session', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')
    expect((await fetchAsBrowser(page, '/api/moderation/queue')).status).toBe(403)

    await signOut(page)
    await page.reload()

    // 401, not 403: without a session there is nobody to refuse.
    expect((await fetchAsBrowser(page, '/api/moderation/queue')).status).toBe(401)
  })
})
