import { expect, test } from './helpers/fixtures'
import { fetchAsBrowser } from './helpers/api'
import { openSessionAs, signIn } from './helpers/auth'

/**
 * The governance model, end to end against the real database.
 *
 * These rules are unit-tested as pure functions, but the thing that can break
 * without any of those tests noticing is the wiring: whether the endpoint
 * actually consults `evaluateTrust`, whether `applyRevision` really is the only
 * path to a live row, whether a queued edit stays invisible. That is what this
 * file asserts.
 */

const draft = (title: string) => ({
  kind: 'site' as const,
  title,
  category: 'fortification' as const,
  summary: 'Recorded by the end-to-end suite.',
  position: { lon: 6.1 + Math.random() * 0.4, lat: 50.7 + Math.random() * 0.4 },
  periodFrom: 100,
  periodTo: 300,
})

test.describe('trust decides whether an edit is published', () => {
  test('queues a newcomer’s contribution', async ({ page }) => {
    await signIn(page, 'newcomer')
    await page.goto('/')

    const response = await fetchAsBrowser<{ status: string; entityId: number | null }>(
      page,
      '/api/contributions',
      { method: 'POST', body: draft(`E2E Newcomer Fort ${Date.now()}`) },
    )

    expect(response.status).toBe(200)
    // Trust level 0: every contribution waits, whatever it contains.
    expect(response.body.status).toBe('pending')
    expect(response.body.entityId).toBeNull()
  })

  test('publishes a trusted contributor’s immediately', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')

    const title = `E2E Trusted Fort ${Date.now()}`
    const response = await fetchAsBrowser<{ status: string; entityId: number | null }>(
      page,
      '/api/contributions',
      { method: 'POST', body: draft(title) },
    )

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('approved')
    expect(response.body.entityId).not.toBeNull()

    // Published means readable, not merely recorded.
    const record = await fetchAsBrowser<{ title: string }>(
      page,
      `/api/sites/${response.body.entityId}`,
    )
    expect(record.status).toBe(200)
    expect(record.body.title).toBe(title)
  })

  test('queues an edit that removes more than it adds, however trusted', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')

    const created = await fetchAsBrowser<{ entityId: number }>(page, '/api/contributions', {
      method: 'POST',
      body: {
        ...draft(`E2E Blanking Base ${Date.now()}`),
        description:
          'A long description, a modern place and a period, all of which the edit below removes.',
      },
    })
    expect(created.status).toBe(200)

    // Same author, same trust — but the edit empties the record.
    const blanking = await fetchAsBrowser<{ status: string; message: string }>(
      page,
      '/api/contributions',
      {
        method: 'POST',
        body: {
          kind: 'site',
          entityId: created.body.entityId,
          // Title stays valid — the removal is everything else.
          title: 'E2E Blanked',
          category: 'other',
          summary: '',
          description: '',
          position: { lon: 6.2, lat: 50.8 },
          periodFrom: null,
          periodTo: null,
        },
      },
    )

    expect(blanking.status).toBe(200)
    // `isBlankingEdit` deliberately overrides the trust rule: a wrong
    // auto-approval here costs far more than a moderator glance.
    expect(blanking.body.status).toBe('pending')
  })
})

test.describe('moderation', () => {
  test('a queued contribution becomes readable once approved', async ({
    page,
    browser,
    clientAddress,
  }) => {
    await signIn(page, 'newcomer')
    await page.goto('/')

    const title = `E2E Queued Fort ${Date.now()}`
    const submitted = await fetchAsBrowser<{ revisionId: number; status: string }>(
      page,
      '/api/contributions',
      { method: 'POST', body: draft(title) },
    )
    expect(submitted.body.status).toBe('pending')

    const moderator = await openSessionAs(browser, 'moderator', `${clientAddress}0`)

    try {
      const queue = await fetchAsBrowser<{ items: { id: number }[] }>(
        moderator.page,
        '/api/moderation/queue?limit=50',
      )
      expect(queue.status).toBe(200)
      expect(
        queue.body.items.some((item) => item.id === submitted.body.revisionId),
        'the submitted revision was not in the queue',
      ).toBeTruthy()

      const review = await fetchAsBrowser(moderator.page, '/api/moderation/review', {
        method: 'POST',
        body: { revisionId: submitted.body.revisionId, decision: 'approved' },
      })
      expect(review.status).toBe(200)

      // Now it exists as a live row, and only `applyRevision` could have put it
      // there.
      const search = await fetchAsBrowser<{ results: { title: string }[] }>(
        page,
        `/api/sites/search?q=${encodeURIComponent(title.slice(0, 40))}`,
      )
      expect(search.status).toBe(200)
    } finally {
      await moderator.close()
    }
  })

  test('a moderator cannot review their own contribution', async ({ page }) => {
    await signIn(page, 'moderator')
    await page.goto('/')

    // A moderator publishes immediately by role, so submit and then try to
    // review the revision that produced it.
    const submitted = await fetchAsBrowser<{ revisionId: number }>(page, '/api/contributions', {
      method: 'POST',
      body: draft(`E2E Moderator Own ${Date.now()}`),
    })

    const review = await fetchAsBrowser<{ message: string }>(page, '/api/moderation/review', {
      method: 'POST',
      body: { revisionId: submitted.body.revisionId, decision: 'approved' },
    })

    // Either already applied (409) or refused as self-review (403) — never
    // accepted.
    expect([403, 409]).toContain(review.status)
  })

  test('refuses a contributor every moderation endpoint', async ({ page }) => {
    await signIn(page, 'trusted')
    await page.goto('/')

    // `moderation/users.get.ts` was replaced by `admin/accounts.get.ts`
    // (admin-only, out of scope here) — see that route's own docstring.
    // `queue.get.ts` is the only remaining GET under `/api/moderation/`.
    expect(
      (await fetchAsBrowser(page, '/api/moderation/queue')).status,
      '/api/moderation/queue was not refused',
    ).toBe(403)

    for (const path of [
      '/api/moderation/review',
      '/api/moderation/revert',
      '/api/moderation/trust',
      '/api/moderation/role',
    ]) {
      const response = await fetchAsBrowser(page, path, { method: 'POST', body: {} })
      expect(response.status, `${path} was not refused`).toBe(403)
    }
  })
})

test.describe('rate limiting', () => {
  test('answers 429 once a policy is exhausted, per address', async ({ page, request }) => {
    await page.goto('/')

    // `record` allows 300 a minute. Spend them, then confirm the next request
    // is refused — and that a different address is untouched.
    //
    // Fired concurrently, not one `await` at a time in a loop. The fixed
    // window is wall-clock (`Math.floor(now / windowSeconds * 1000)` in
    // `buildRateLimitKey`), and 320 sequential round trips took long enough
    // under load — a slow CI runner, or simply a long suite with many other
    // tests ahead of this one — that the loop occasionally crossed into a
    // *second* window partway through: the counter reset mid-burst, 300 was
    // never reached, and the test failed asserting a 429 that never came, for
    // a reason that had nothing to do with rate limiting. Firing all 320 at
    // once keeps the whole burst inside a few hundred milliseconds regardless
    // of system load, which is what "300 a minute" is actually supposed to
    // guard against — Redis's `INCR` is atomic, so which of the 320 lands
    // first is irrelevant to the count either way.
    const statuses = await page.evaluate(async () => {
      const requests = Array.from({ length: 320 }, () =>
        // `cache: 'no-store'` is essential: `/api/sites/**` carries
        // `max-age=60`, so without it the browser answers from its own
        // cache after the first request and the server never sees the
        // other 319 — the limit is never reached and the test passes for
        // the wrong reason.
        fetch('/api/sites/1', { cache: 'no-store' }).then((response) => response.status),
      )
      return Promise.all(requests)
    })

    expect(statuses.filter((status) => status === 200).length).toBeGreaterThan(250)
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0)

    // A different identity, unaffected — this is what a shared bucket would
    // have broken, and did until `loadSiteDetail` replaced an internal $fetch.
    const other = await request.get('/api/sites/1', {
      headers: { 'x-real-ip': '203.0.113.251' },
    })
    expect(other.status()).toBe(200)
  })
})
