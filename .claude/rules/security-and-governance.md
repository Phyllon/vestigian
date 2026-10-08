---
paths:
  - 'server/utils/revisions.ts'
  - 'server/utils/permissions.ts'
  - 'shared/utils/authorization.ts'
  - 'server/api/auth/**'
  - 'server/api/moderation/**'
  - 'server/api/admin/**'
  - 'server/utils/step-up.ts'
  - 'server/utils/retraction.ts'
  - 'server/utils/admin-audit.ts'
  - 'app/middleware/admin.ts'
  - 'server/api/contributions/**'
  - 'server/database/schema/users.ts'
  - 'nuxt.config.ts'
---

## Governance model — do not weaken these

- Every change to a site or tracing is written to `revisions` **before** any live table is touched.
- `applyRevision()` in `server/utils/revisions.ts` is the **only** place a live row is written. Automatic approval, moderator approval and revert all go through it. Do not add a second path.
- **What that file decides is pure and unit-tested; only the writes touch the
  database.** `planRevisionWrite`, `shouldCountTowardsTrust`, `planRevert`,
  `buildRetractionPayload` and `geometryKindFor` are exported and asserted in
  `server/utils/__test__/revisions.test.ts`, following the same split
  `retraction.ts`/`planRetraction` already used. Before that, every rule in this
  section was reachable only through a transaction, a live PostGIS geometry and
  three call sites — which is exactly why the governance core went untested
  longest despite being the part that matters most. **Extending `applyRevision`
  means extending the plan function and its test, not adding a branch inside the
  transaction.**
  Two holes the extraction closed rather than merely described:
  a payload carrying `retracted: true` with no resolvable target used to fall
  _past_ the retraction branch into the insert path — so a retraction that had
  lost its entity id would have published a brand-new record built from the
  retraction payload, credited to the moderator who pressed the button; and
  `revisions.entity_type` is a plain `varchar(20)` with no check constraint, so
  a value outside the vocabulary produced a payload whose `kind` matched neither
  branch, making a revert write history, log `revision.applied`, and change
  nothing. Both are now explicit refusals.
- **`planRevert` and `buildRetractionPayload` force `kind` and `entityId` from
  the revision row, after the spread of the stored payload.** That ordering is
  the property keeping a revert aimed at its own record: `previousPayload` is
  stored JSON, and one naming a different record would otherwise redirect the
  write at something no moderator looked at, with `applyRevision` applying it
  without complaint.
- **Every authorization rule lives in `shared/utils/authorization.ts`** and nowhere else — both sides import it, and the guards that throw are the only thing left in `server/utils/permissions.ts`. Casbin, CASL and Cerbos were assessed as replacements and rejected: three roles fixed in a `pgEnum` buy nothing from a runtime policy engine, and the rules that actually matter here are not the subject/action/resource shape they model. `users.trust_level` was dropped for the same reason — a derived column written by two hand-transcribed SQL copies of the threshold.
- **Trust:** new accounts are queued. After **2 accepted contributions** (`evaluateTrust`), edits publish immediately. Moderators can revoke. Images do not count toward trust — uploading two photos is a weaker signal than two records surviving review.
- **A moderator cannot approve their own contribution** (`canReviewRevision`).
- **There is no bootstrap path to the first admin.** `role.post.ts` is the only write to `users.role`, and `checkRoleChange` requires the actor to already hold `admin` — by design, so nobody can self-promote. On a brand-new instance that means the very first admin can only be created outside the app, with a direct database write: `UPDATE users SET role = 'admin' WHERE email = '...';`. This is intentional, not a gap to close with a seed script or setup wizard — a bootstrap endpoint reachable before any admin exists is an unauthenticated role-escalation path by construction, which is a worse risk than "run one SQL statement once per instance." Role reads always hit the database (see below), so this takes effect on the admin's very next request, no restart or re-login needed.
- **An edit that removes more than it adds is queued regardless of trust** (`isBlankingEdit`). This deliberately overrides the trust rule; a wrong auto-approval on a blanking edit costs far more than a moderator glance.
- **Revert writes a new revision** restoring the prior state. Never delete a revision. History is append-only.
- **Reverts do not increment the moderator's trust counter** — housekeeping is not contribution.
- **A decision reaches the person it was made about.** `review`, `review-batch`
  and `trust` mail the author or the account after the write, never before, and
  a mail failure can never undo a decision that has already been applied — see
  `server/utils/notifications.ts`. A revert is excluded: its author is the
  moderator, so the mail would report someone's housekeeping back to them.
  The review queue and the contributor list send the moderator's own words with
  it — the note per revision, the reason for a suspension. Both are optional and
  the copy adapts, but a rejection with nothing in it is a decision the author
  cannot act on, which is why suspending is now two clicks with a field between
  them.
- **Nobody can change their own role, and no admin can demote another admin, ever** (`checkRoleChange`). This used to allow it once a second admin existed — the `last-admin` branch only blocked demoting the _final_ one, so granting someone admin also handed them the power to strip your own admin role back off, as long as a third account existed to keep the count above one. Reported directly as an unacceptable outcome ("even if I granted some other partner admin rights, this must hold") and closed by making the `admin-protected` branch unconditional: an admin can promote anyone up to admin, but taking admin away from an existing admin is refused regardless of how many others exist. Removing a rogue or compromised co-admin is deliberately left to the same database surgery that creates the first admin — see above — a slower path chosen on purpose over a button any admin could press against any other.
- **Role and trust are re-read from the database inside every guard.** The session cookie is sealed at login and nothing refreshes it, so reading a role from it let a demoted moderator keep moderating until they logged out. `requireModerator`/`requireAdmin` cost one primary-key lookup and are the reason a demotion bites on the next request.
- **The order those checks run in is itself a rule, and is tested.**
  `decideIdentity` (`server/utils/permissions.ts`, pure, asserted in
  `__test__/permissions.test.ts`) judges deleted-account, then spent session,
  then ban, then role. Session-before-ban matters because blocking bumps
  `sessions_valid_from` and **so does lifting the block** — so somebody whose
  block was just lifted arrives with a spent cookie and a clean record, and must
  be told to sign in again rather than that they are still blocked, which would
  be both false and unactionable. The 401/403 split is load-bearing for the same
  reason: every client path treats 401 as "go and sign in", so answering 403 to a
  spent cookie strands someone on a page telling them they may not do a thing
  they are in fact allowed to do.
- **Slugs never change on edit.** Inbound links, citations and the sitemap point at them.
- Suspension leaves `approved_contributions` untouched, so restoring trust returns someone exactly where they were.

## The admin station — `/admin`

Added because the moderator's queue is scoped to `status = 'pending'`, so from
the moment a contributor crosses `TRUST_THRESHOLD` their edits published and
appeared on **no screen in this application** — `applyRevision()` logged every
one of those writes, but that line goes to Loki. `admin/activity.get.ts` is the
same projection `moderation/queue.get.ts` builds, minus that status filter.

- **A block is a sanction on the person, not on their work.** `users.banned_at`
  (plus `ban_reason`, `banned_by`) refuses login and every guarded route, and
  leaves the sites, tracings, photographs and revision history exactly where
  they are, still credited. Distinct in kind from `trust_revoked`, which only
  re-queues someone's edits and otherwise leaves the account fully working.
  Taking the work offline is a separate, counted, reversible sweep
  (`admin/retract.post.ts`) — never a side effect of the block, because a block
  that silently unpublished a productive contributor's back catalogue would be
  a far larger decision than the button implies and a lifted block could not
  undo it.
- **`users.sessions_valid_from` is the only session revocation this app has.**
  The session is a stateless iron cookie with no server-side store to delete a
  row from, so revocation is a comparison: `isSessionCurrent` checks the
  `loggedInAt` sealed at login against this column, and anything older is spent.
  Bumped by a block, by lifting a block (so a cookie that was live at the moment
  of the block cannot come back), and by `admin/sessions.post.ts`. Without it a
  block would wait for the person to sign out, which is exactly when they have
  no reason to.
- **A ban can never touch an administrator** (`checkBan`), unconditionally, for
  the same reason `checkRoleChange`'s `admin-protected` branch is unconditional:
  an account that cannot sign in, cannot write and has every session killed is
  neutralised as completely as one whose role was stripped, so allowing the
  second while refusing the first would be a distinction without a difference.
  Removing a rogue co-admin stays the same database surgery that creates the
  first one.
- **`requireActiveUser` is what makes a block bite where it matters.** Extending
  `readCurrentIdentity` alone would have enforced it on precisely the routes a
  blocked contributor could never reach anyway. A Nitro middleware was
  considered and rejected twice over: it would run on tile and record traffic
  carrying no session, and it would put an authorization decision somewhere
  other than the guards file.
- **Step-up re-authentication, and it fails closed.** `requireStepUp`
  (`server/utils/step-up.ts`) gates `moderation/role.post.ts`,
  `admin/ban.post.ts` and the retraction sweep — the actions this application
  cannot undo from inside itself, since a second permanent admin minted from a
  stolen session can only be removed with direct database access. The Valkey
  grant is keyed on `{userId}:{loggedInAt}`, so a _different_ live session for
  the same admin cannot ride a grant the real one minted, and it is **spent by
  the action it authorises** rather than leaving a fifteen-minute unguarded
  window. On a Valkey outage it **refuses** — the one deliberate inversion of
  `enforceRateLimit`'s fail-open, because an outage that waved privileged
  actions through would turn a service problem into a window for the
  irreversible ones. `sessions.post.ts` is deliberately _not_ behind it: it
  takes nothing away that signing in again does not restore, and a password
  prompt in front of the one fast containment action would mean it is not fast.
- **Retraction still goes through `applyRevision`.** There was no withdrawal
  path for a site or tracing at all, and the obvious implementation — an
  `UPDATE sites SET status` in the endpoint — would have been the second write
  path the whole governance model exists to prevent. Instead `retractRecord`
  writes an approved revision carrying `retracted: true`, and `applyRevision`
  has one new branch that sets `status = 'rejected'` (already what every tile
  query excludes) without touching the fields. Three things fall out for free:
  the retraction appears in the record's own history, `revert.post.ts`
  un-retracts it with no new code, and history stays append-only. Which of an
  author's contributions get retracted versus reverted versus left alone is
  `planRetraction` (`server/utils/retraction.ts`), pure and unit-tested —
  reverting an edit to somebody else's record rolls back a state a third party
  may have built on, and reverting a _revert_ re-applies what a moderator
  removed.
- **`admin_audit_log` is append-only and holds no IPs or credentials.** Nothing
  in the application updates or deletes a row; `recordAdminAction` only inserts,
  and it never throws — a failed audit write must not be able to roll back a
  block that has already taken effect, so it lands in the request log and the
  action stands. It duplicates the `audit:` log lines on purpose: those live in
  Loki on a 30-day retention and need Grafana open, while this is the durable
  in-app record, and the thing that makes an admin-visible email address
  defensible rather than merely convenient.
- **`/admin` answers 404 to a signed-in non-administrator**
  (`app/middleware/admin.ts`), so the route's existence is not confirmed to
  somebody who cannot use it. That is concealment, worth nothing on its own; the
  protection is `requireAdmin` on every endpoint, which answers an honest 403
  because by then the caller is authenticated and a truthful error is worth more
  than a coy one. The unindexability measures are in `.claude/rules/seo.md`.
- **There is still no admin variant of `auth/export.get.ts`.** The dossier shows
  an account's contributions, which are public work; it stops short of handing an
  administrator the personal-data dump its owner gets under Art. 15.

## Security invariants — do not weaken these either

- argon2id at OWASP parameters. Login always hashes (against `DUMMY_HASH` when no user matches) so timing cannot enumerate the user table.
- `forgot-password` responds **identically** whether or not the address exists. Registration no longer does: a duplicate email or display name is reported as a 409 so the person can try again. That was a deliberate trade of the enumeration guarantee for a form that is not a dead end — see the comment in `server/api/auth/register.post.ts`, which records what still throttles it and what the alternative was.
- Only the SHA-256 **hash** of an email token is stored; comparison is constant-time.
- **A password reset tells the owner it happened.** The reset link goes to an
  inbox an attacker may already hold; this message lands afterwards and is the
  only point at which the real owner finds out, so it names the recovery route
  rather than merely confirming.
- **An unverified login re-sends the confirmation link**, at most one per
  quarter of an hour. It sits _below_ the credential check on purpose: after a
  correct password there is nothing left to enumerate. Without it the flow dead
  ends — the first link is worth nothing after a day, login refuses an
  unconfirmed address, and nothing else issues another.
- **Mail delivery never throws.** A provider outage that propagated would make
  `forgot-password` answer 500 for a registered address and 200 for an unknown
  one — the exact oracle the identical-response rule exists to close. Failures
  land in the log and in `mail_deliveries_total{outcome="failed"}` instead.
- **Nothing a user typed reaches an inbox as markup.** Display names and the
  submitted address are escaped by `renderTokenEmail`; that is what
  `mail-template`'s tests are for.
- Uploads: the declared content type is a hint. Format is read from **magic bytes** (`detectImageFormat`), and every image is **re-encoded through sharp**, which strips EXIF and guarantees the stored object is a plain JPEG. Storage keys derive from database ids, **never** from the uploaded filename.
- Images with an unresolved licence (`UNKNOWN`) or `ARR` are never published.
- Signup: **self-hosted ALTCHA** proof of work + honeypot (positioned off-screen, not `display:none`) + per-IP rate limit + email verification. ALTCHA replaced Turnstile to remove the last third-party runtime dependency; it prices automated signup rather than detecting it, which is **weaker** against a funded attacker. That is acceptable only because login refuses unverified addresses and every new account is trust level 0, so a bot that solves the puzzle still earns nothing but a queued revision. The solved salt is burned in Valkey — `verifySolution` checks the HMAC and expiry, both of which a replay satisfies.
- **Forwarded headers are believed only behind a trusted proxy** (`NUXT_BEHIND_TRUSTED_PROXY`). `cf-connecting-ip` used to be taken unconditionally, so anything reaching the origin could mint a fresh rate-limit bucket per request and every policy in `RATE_LIMITS` was decorative. The header is now `x-real-ip`, and **`x-forwarded-for` is deliberately never read**: Bunny sends the CDN address first and the visitor second, so the usual "leftmost is the client" reading would put every visitor in one bucket. Setting the flag without an origin firewall is worse than leaving it off.
- **The session cookie expires.** `maxAge` was unset, which in h3 means the iron seal is sealed with `ttl: 0` — never expiring — and the cookie carries no `Max-Age`. A captured session was valid forever, with no server-side revocation because the session is stateless.
- **sharp is given an explicit `limitInputPixels`.** Its ~268 MP default meant a compressible PNG under the 8 MB body limit could decode to about a gigabyte of resident memory, and `.rotate()` forces the full decode.
- **Detection is not enforcement.** CrowdSec writes decisions; nothing applies them until a bouncer does. The Bunny-edge bouncer is the enforcement and is verified for single IPv4/IPv6 addresses only; its 100-entry cap, origin filter and pruning are in `.claude/rules/deployment-and-releases.md` ("Security layer").
- Rate limiting **fails open** — a cache outage must not lock everyone out.
- CSP allows only the map asset origins listed in `nuxt.config.ts`.
- **Two-factor login is opt-in TOTP, and nothing else.** RFC 6238 was chosen
  specifically because it has no provider: no SMS gateway, no push service,
  no third party ever contacted — a shared secret and the current time,
  checked entirely on this server and in the visitor's own authenticator
  app. `server/utils/totp.ts`. The account's secret has to be reversible
  (verifying a live code means recomputing it, not comparing digests), so
  unlike every hash and token digest elsewhere in this app it is
  **encrypted, not hashed** — AES-256-GCM, key in `NUXT_TOTP_ENCRYPTION_KEY`
  (`openssl rand -hex 32`, generated the same way as `NUXT_ALTCHA_SECRET`).
  That reversibility is the one real new operational risk this feature adds:
  losing or rotating the key makes every enrolled user's secret permanently
  unverifiable, with no self-service recovery for that specific failure —
  only their own backup codes, or an admin clearing the two `users` columns
  directly in Postgres, get them back in. The ten backup codes issued at
  enrollment are hashed with `hashToken`, the same one-way pattern
  `emailTokens` already uses, and each is single-use, enforced by a
  conditional `UPDATE … WHERE consumed_at IS NULL` rather than a
  read-then-write, so two concurrent submissions of the same code cannot
  both succeed. Disabling 2FA requires **both** the current password and a
  working code — the stronger bar, not the weaker one either check alone
  would be, since turning a second factor off is itself a security-lowering
  action. The login flow never sets a session for a two-factor account until
  `verify-2fa.post.ts` sees a correct code; the intervening state is an
  opaque, short-lived challenge in Valkey, not a partial cookie, and it
  invalidates itself after 8 wrong attempts on top of the IP-wide
  `twoFactorVerify` rate limit.
- **`nuxt-security`'s `xssValidator` is off** (`security.xssValidator: false` in
  `nuxt.config.ts`), and that is a considered decision, not a gap. It ran every
  GET query and POST body through the `xss` package's `FilterXSS`, then
  rejected the request outright the moment filtering changed a single byte.
  `FilterXSS` HTML-escapes any `<` it cannot parse as a tag it recognises, so a
  site summary reading "the wall is <2m tall" or a field note with "<1m wide"
  was escaped to `&lt;2m` and refused — identically to `<script>alert(1)`,
  because the check only asks "did anything change", not "was anything
  dangerous". No whitelist option fixes that: it is what the library is for,
  applied to a body it assumes is HTML rather than JSON carrying free prose.
  Turning it off is safe here specifically because **there is no `v-html`
  anywhere in this app** (`grep -rn v-html app/` returns nothing), so every
  value a Vue template renders is escaped by `{{ }}` regardless of this
  middleware, and the two surfaces that are not Vue-rendered already encode for
  their own context explicitly and are unit-tested for it: HTML mail
  (`mail-template.ts`'s `escapeHtml`) and the GPX field kit (`gpx.ts`'s
  `escapeXml`). If a `v-html` is ever added, this decision needs revisiting
  before that lands, not after.
- **A description is stripped of markup on the way in, not merely escaped on
  the way out.** `stripHtml` (`server/utils/sanitize.ts`) runs inside the
  `siteDraftSchema`/`tracingDraftSchema` zod pipeline
  (`server/api/contributions/index.post.ts`), between `.trim()` and the
  `.max(20000)` length check, so the stored payload — and everything derived
  from it, `revisions.payload` included — never carries a tag at all. This is
  a different guarantee than the `xssValidator` decision above: that one
  relies entirely on Vue's own `{{ }}` escaping happening at render time and
  is correct as long as nothing renders a description through `v-html`;
  `stripHtml` means the description is plain text even if that assumption
  ever stops holding, or the same text leaves the app through a surface that
  is not Vue at all (the OpenAPI-documented `GET /api/data/sites.geojson`
  feed, an RSS-style export, anything not yet built). It uses `sanitize-html`
  (`allowedTags: []`) rather than a hand-rolled regex, with two adjustments
  the library does not do on its own: block-level tags and `<br>` become a
  newline _before_ stripping, so `<p>one</p><p>two</p>` survives as two lines
  instead of running together, and `he.decode` reverses the HTML-entity
  encoding `sanitize-html` applies to whatever text remains — its normal job
  is producing safe markup, not plain text, so without this step "Tom & Jerry"
  would be stored as "Tom &amp; Jerry" and then double-encoded again by Vue's
  own escaping when rendered. It never rejects and it does not touch `<` that
  is not part of a real tag: "the wall is <2m tall" — the exact example above
  — comes through untouched, because `sanitize-html`'s parser has no tag
  named `2m` to match. `pnpm strip-description-html --repair`
  (`scripts/strip-description-html.ts`) backfills every `sites.description`
  and `tracings.description` row that predates this check. It writes the live
  columns directly rather than going through `applyRevision()` — this is data
  hygiene in the same category as `images:reconcile`, not an editorial change
  to what a record says, and revision history is append-only, so a bulk
  backfill has nowhere to go there even if it wanted to.

## CORS — what a production build actually does

Checked 2026-10-02 against `pnpm build` output started with
`NUXT_SECURITY_CORS_HANDLER_ORIGIN=https://vestigian.example` (nuxt-security 2.6.0
over h3 1.15; read `corsHandler.js` and h3's `createOriginHeaders` too):

- The env override works. `Origin: https://vestigian.example` gets
  `access-control-allow-origin: https://vestigian.example` + `vary: origin`; every
  other origin — `evil.example`, `null`, `https://www.…`, `http://…`, a lookalike
  subdomain — gets **no** ACAO header. No `access-control-allow-credentials` anywhere,
  so no credentialed cross-origin read is possible even from the allowed origin.
- **A request with no `Origin` header always answers `ACAO: *`** (h3: `!origin → "*"`).
  Not exploitable — browsers send `Origin` on every cross-origin request and omit it on
  same-origin GETs — but it is why `curl` without `-H Origin` "shows a wildcard".
- **Known imperfection:** the no-match response carries no `Vary: Origin`, while the
  match response does. Behind a CDN that ignores `Vary`, one cached variant could be
  served for another origin. It only affects third-party cross-origin consumers, of
  which there are none by design; not changed.
- Preflights from a disallowed origin still answer `204` with `allow-methods` and an
  echo of the requested headers, but without ACAO, so the browser refuses the request.
- `/api/data/sites.geojson` and `sites.lp.json` send an explicit `ACAO: *` — public,
  read-only, bounded; intended.
- The CDN pull zone that serves PMTiles (basemap, terrain) is configured in Bunny, not
  here: it must answer `206` to ranges and allow the site origin (runbook §15a step 5).

## Drift sampling — watching trust after it is granted

Trust is binary and permanent until revoked: two accepted contributions and
everything afterwards publishes immediately, with nothing ever looking again.
That is correct for the failure it was designed against — somebody obviously bad
from their first edit — and blind to the one it was not: a contributor who
behaves well enough to earn trust and then degrades records slowly. The
append-only revision history makes that detectable; nothing looked.

`server/utils/sampling.ts` draws a fraction of auto-approved work back for a
second look. `planSample` is pure and tested; `sampleAutoApprovedRevision` is
the thin database half.

**It is post-hoc, and that is load-bearing rather than incidental.** It flags a
revision that is _already live_. Nothing in it writes `status`, and the draw
happens after the transaction commits. Making it hold a contribution back would
quietly undo the trust model, whose entire promise is that trusted work
publishes immediately — so a future change that turns this into a gate is a
change to the governance model, not an improvement to the sampler.

### The curve

`INITIAL / (1 + contributions since the threshold)`, clamped at a floor:
50% on the first auto-approved contribution, then 25%, 17%, 12.5%, decaying to a
permanent **5%**.

Weighted towards the beginning because that is where the evidence is thinnest
and a mistaken grant of trust is cheapest to catch. The floor matters more than
the curve: a rate reaching zero would leave long-standing accounts permanently
unwatched, which is exactly the position a patient bad actor wants to reach.
One in twenty keeps every account occasionally visible without making
established contributors feel policed.

`newly-trusted` versus `routine-audit` is the reason label, and it is the
elevated window versus the floor — a moderator triaging the list can tell "this
account was just trusted" from "this is the routine one-in-twenty".

### Three exclusions, each for its own reason

- **Moderator-approved work** is never sampled: a human already looked, and a
  second look is not a sample.
- **Moderators and administrators** are never sampled on their own
  contributions. They publish immediately because of their _role_ rather than an
  earned count, they are already accountable through `admin_audit_log`, and
  sampling them would crowd out the contributors this exists to watch.
- **Reverts and retractions** never reach the draw, because they are not
  auto-approved — they arrive at `applyRevision` with `auto_approved = 0`.

### Two implementation details that are not arbitrary

**Drawn in `applyRevision`, not at the contribution endpoint.** Automatic
approval, moderator approval and revert all arrive at that one function, which
is the same reason the live-row write lives there: a rule applied at the single
path cannot diverge between the three callers. It reads `auto_approved` off the
revision row to tell automatic publishing from the rest, and is called with
`void` — the record is already published and correct, and a failed spot-check
must never be able to fail a contribution. Same fail-open reasoning as rate
limiting, mail delivery and concordance verification.

**`crypto.randomInt`, not `Math.random()`.** This mechanism is adversarial by
design — it exists to catch somebody degrading records on purpose. V8's
`Math.random()` is a seeded xorshift whose internal state is recoverable from a
modest run of outputs, so an attacker able to observe which of their own
contributions were drawn could in principle predict the sequence and time the
damaging edits into the gaps. `randomInt` draws from the OS entropy pool, is
itself rejection-sampled, and leaves no such inference. (ESLint's
`sonarjs/pseudo-random` flagged the original `Math.random()`; it was right.)

### Surfaced in

`/api/admin/activity?sampledOnly=true` — the answer to "what should a moderator
actually spot-check today", as opposed to everything that published.
`AdminActivityStream.vue` marks drawn rows in verdigris, this project's
confirmed/approved token, because a draw is a request for attention rather than
a warning; oxide red stays reserved for a blanking edit, which is one.

### Verified

`planSample`'s rule in `__test__/sampling.test.ts` (14 assertions, draw
injected). Separately, the real `crypto.randomInt` draw path was run 40,000
times at each of five points on the decay curve and the observed rate matched
the nominal one within 1.5% throughout. The columns and their partial index were
exercised against the live database. Note the index is not yet _proven_ under
load: at 208 revisions Postgres correctly prefers a sequential scan, so the plan
that matters will only appear once the table is large.
