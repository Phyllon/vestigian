# End-to-end tests

What unit tests structurally cannot reach: the browser, the built server, and
the wiring between them.

```bash
pnpm stack:up && pnpm db:migrate   # once
pnpm test:e2e                      # builds, starts, runs, tears down
pnpm test:e2e:ui                   # interactive
```

Unit tests stay `pnpm test`. `vitest.config.ts` lists its directories
explicitly, so nothing here is ever picked up by it, and nothing there is
picked up by Playwright's `**/*.spec.ts`.

## Why it runs the production build

Two of this project's worst bugs were invisible in development and appeared
only in the built output: a CSP without a nonce token that stopped Vue mounting
at all, and Pino's worker transport being tree-shaken out of the server bundle.
A suite against `nuxt dev` would have passed through both.

The cost is a build per run, roughly a minute. `reuseExistingServer` means a
server left running on 3111 is reused, so local iteration skips it.

## What the suite already caught

Written to cover known-risky paths; it found three live bugs on first contact.

- **Signup was completely broken.** ALTCHA v3 renamed `challengeurl` to
  `challenge`, and the old name is ignored rather than rejected — the widget
  fell back to fetching the form's own action, received the register page's
  HTML, and never produced a payload. The submit button stayed disabled. A 200
  everywhere and nothing in the logs.
- **`/api/sites/<huge number>` answered 500.** `z.coerce.number().int().positive()`
  accepts `9999999999999999999999` because JavaScript reads it as `1e+22` and
  calls that a positive integer. Postgres does not. Now bounded by
  `routeIdentifier` in `server/utils/validation.ts`.
- **A stale `x-forwarded-for` reading.** Covered by `resolveForwardedIdentifier`'s
  own tests, but the e2e run is what proves the header path end to end.

## How flakiness is kept out

Every one of these was a real failure before it was a rule.

- **Readiness, not liveness.** `global-setup` waits on `/api/ready`, which
  touches both Postgres pools and Valkey. Waiting on `/api/health` races the
  database and fails in whichever test happens to run first.
- **One rate-limit identity per test.** All requests come from 127.0.0.1, and
  `login` allows eight attempts per fifteen minutes. Each test presents its own
  `x-real-ip` from the RFC 5737 documentation range, so no test can exhaust
  another's budget.
- **Rate-limit counters are cleared per run.** The addresses are handed out by a
  counter that restarts with the process, so test one always gets
  `203.0.113.1` — and Valkey counters outlive the run. Three runs inside fifteen
  minutes used to fail on the fourth, with the failure moving around depending
  on how recently the suite had been run.
- **The server is warmed before the first test.** The first server-rendered
  request after a build is materially slower, and whichever test ran first
  absorbed that as a timeout unrelated to what it asserted.
- **`cache: 'no-store'` when a test counts requests.** `/api/sites/**` carries
  `max-age=60`, so without it the browser answers from its own cache and the
  server never sees the traffic — the rate-limit test passed for the wrong
  reason.
- **Assertions land on outcomes, not on URLs.** The login form navigates only
  after re-fetching the session; a URL check races that round trip.
- **`fetchAsBrowser`, not `page.request`.** The session cookie is `Secure`, and
  Playwright's Node-side request context will not send a Secure cookie over
  plain HTTP while Chromium will. Every API assertion made through
  `page.request` came back 401 for a reason unrelated to the application.

## Fixtures

Seeded by `global-setup`, removed by `global-teardown`, and removed again
before the next seed so a crashed run cannot poison the following one. All
addresses end in `@e2e.local`; published records are titled `E2E …`. The suite
writes real contributions, so without the teardown the moderation queue fills
with revisions a human would have to dismiss.

| Account      | Standing                                                             |
| ------------ | -------------------------------------------------------------------- |
| `newcomer`   | trust 0 — everything queued                                          |
| `unverified` | never confirmed its address — login refuses it and re-sends the link |
| `trusted`    | five accepted — publishes immediately                                |
| `moderator`  | reviews the queue                                                    |
| `admin`      | changes roles                                                        |

## Known environment mismatch

The suite runs a production build against the development imgproxy, which is
served over plain HTTP. Production enables `upgrade-insecure-requests`, so the
browser rewrites `http://localhost:8080/...` to `https://` and then refuses it.
That cannot happen in production, where the image host is https. It is filtered
explicitly by `IMGPROXY_OVER_HTTP` in `helpers/console.ts` — every other CSP
refusal still fails the run.
