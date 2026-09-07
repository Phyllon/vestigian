---
paths:
  - 'server/utils/revisions.ts'
  - 'server/utils/permissions.ts'
  - 'shared/utils/authorization.ts'
  - 'server/api/auth/**'
  - 'server/api/moderation/**'
  - 'server/api/contributions/**'
  - 'server/database/schema/users.ts'
  - 'nuxt.config.ts'
---

## Governance model — do not weaken these

- Every change to a site or tracing is written to `revisions` **before** any live table is touched.
- `applyRevision()` in `server/utils/revisions.ts` is the **only** place a live row is written. Automatic approval, moderator approval and revert all go through it. Do not add a second path.
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
- **Slugs never change on edit.** Inbound links, citations and the sitemap point at them.
- Suspension leaves `approved_contributions` untouched, so restoring trust returns someone exactly where they were.

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
- **Detection is not enforcement.** CrowdSec writes decisions; nothing applies them until a bouncer exists. See `docker/security/README.md`.
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
