---
paths:
  - 'server/api/auth/account.delete.ts'
  - 'server/api/auth/export.get.ts'
  - 'app/pages/privacy.vue'
  - 'app/pages/impressum.vue'
---

## GDPR / legal

Not legal advice — a lawyer should read both `app/pages/impressum.vue` and
`app/pages/privacy.vue` before real users see them. What follows is the
technical side, verified against the actual code rather than assumed.

**`impressum.vue`'s identity, contact and supervisory-authority blocks are
filled in (2026-09-30), not placeholders** — operator "Vestigian — Alex
Lernbecher & René Voorburg", a c/o address via an Online-Impressum service
(`mein.online-impressum.de/vestigian`), and the DDG/MStV media-oversight
authority (Bayerische Landeszentrale für neue Medien). All three real,
provided by the operator directly, hand-translated into all six locales per
`.claude/rules/enrichment-and-i18n.md`'s "hand-translate every new key"
policy — not run through `pnpm i18n:translate`. The operator's real name,
address and the authority's proper name are kept **identical across every
locale** (postal addresses and institution names aren't translated); only
the surrounding labels are.

**`privacy.vue`'s `supervisoryPlaceholder` is still a placeholder, and
deliberately was not filled from the Impressum content above.** The two
"supervisory authority" fields are legally distinct, easy to conflate because
they use the same heading pattern: `impressum.vue`'s is the DDG/
Medienstaatsvertrag media-oversight body (who to complain to about the
service's telemedia/editorial compliance); `privacy.vue`'s is the GDPR data
protection authority (who to complain to about how personal data is
processed) — normally the DPA for wherever the controller is established,
which for a Bavarian c/o address would be the Bayerisches Landesamt für
Datenschutzaufsicht (BayLDA), not the Bayerische Landeszentrale für neue
Medien (BLM) named in the Impressum. Needs the operator to confirm which DPA
actually has jurisdiction before this placeholder is filled — not assumed
here.

**No cookie-consent banner exists, and none should be added.** The app sets
exactly three cookies — `nuxt-session` (7 days, `nuxt.config.ts`'s
`session.maxAge`), `vestigian-color-mode`, `vestigian-locale` — and all three
are strictly necessary for functionality the visitor directly requested.
There is no analytics, no tracking pixel, no advertising cookie anywhere in
the app (confirmed by grep, not assumed). §25(2) TDDDG — the German
implementation of the ePrivacy Directive — exempts exactly this case: consent
is required for storing or reading something on a device, not for cookies a
requested feature cannot work without. A banner here would be consent theatre
for cookies that need none. If a future change adds analytics or an
advertising cookie, **that** is what needs a banner — the exemption stops
applying the moment a cookie exists that a visitor could reasonably decline.

**Right to erasure** (`server/api/auth/account.delete.ts`) anonymises the
`users` row — email becomes `deleted-{id}@vestigian.invalid` (`.invalid` is the
TLD RFC 2606 reserves for exactly this), display name becomes
`Deleted account #{id}`, password hash becomes `DUMMY_HASH` — rather than
deleting it outright. `revisions.author_id`, `sites.created_by`,
`tracings.created_by` and `site_images.created_by` are all
`ON DELETE SET NULL`, so a hard delete would work too, but every erased
contributor's history would then read the same generic fallback with no way
to tell one from another. Anonymising keeps history exactly as legible as it
is for anyone else, while erasing everything that identifies the person. The
content of past contributions is kept, not the identity — the Art. 17(3)(d)
exemption for archival material of public interest, which is a reasonable
position for a cultural-heritage atlas but, like everything else on this
page, not a substitute for legal review of that specific argument. A
confirmation mail is sent to the _original_ address before it's overwritten,
per the project's standing rule that a decision reaches the person before
it's irreversible — see "A decision reaches the person it was made about"
under "Governance model."

**Right to access/portability** (`server/api/auth/export.get.ts`) returns the
caller's own account fields plus every site, tracing, image and revision they
authored, as JSON. Scoped entirely by the caller's own session id — there is
no admin variant of this endpoint. `/admin`'s dossier
(`server/api/admin/accounts/[id].get.ts`) is **not** that variant and should not
become one: it returns contributions, which are public work, and deliberately
never the password hash, the encrypted TOTP secret, the private visit log, or
the bookmarks.

**The admin panel reads email addresses, and records that it did.**
`server/api/admin/accounts.get.ts` returns the address and matches search
against it — a widening of what `moderation/users.get.ts` deliberately withheld,
decided on the grounds that an administrator has to act on an abuse report that
names an address or tie a run of signups to one disposable domain, which a
moderator judging contributions does not. Every request writes an
`accounts.viewed` row and every dossier an `account.inspected` row to
`admin_audit_log`, which is what makes the wider disclosure accountable rather
than merely convenient; the rows record _that_ the roll was read and how it was
narrowed, never the addresses returned, since a second copy of them buys nothing.

**`admin_audit_log` holds no IP addresses and no credentials**, by design. The
request log already retains addresses for 30 days on a documented
legitimate-interest basis; a second, unbounded store of them inside an
append-only table nothing prunes would be a new liability rather than a new
capability. The panel is not a log viewer — that is Loki's job.

**IP addresses are logged and retained 30 days** (Loki, per
`docker/observability/loki.yml`'s `retention_period`), on the
legitimate-interest basis of operating and securing the service — this
matches what `server/utils/logger.ts`'s `REDACTED_FIELDS` already does not
scrub (passwords, emails and tokens are redacted; IPs are not, deliberately,
since abuse investigation needs them). Rate-limit keys in Valkey embed a
plaintext IP for at most one hour (`RATE_LIMITS`' longest window).

**CrowdSec's `DISABLE_ONLINE_API: 'false'`** (`docker/compose.prod.yml`)
shares IP addresses flagged as abusive with CrowdSec's central community
blocklist — the one outbound flow of visitor-derived data that isn't proxied
or EU-internal, on the same legitimate-interest basis as the request logs.
Documented in both the compose file and `privacy.vue`'s recipients section;
previously undocumented anywhere.

**Wikidata, Wikipedia and Pleiades never see a visitor's IP** — confirmed in
`server/utils/enrichment-sources.ts`'s own docstring and unchanged by this
audit: the server proxies every call, so only the server's own request
reaches these non-EU services. **Mapterhorn's basemap tiles are fetched
directly by the browser** (`mapAssetOrigins` in `nuxt.config.ts`), so a
visitor's IP does reach that host the way it would for any embedded map — its
hosting location is not confirmed in this repository and should be verified
before the privacy policy's recipients section is treated as final.

## Anonymous performance measurement

`POST /api/vitals` (see `.claude/rules/observability.md`) keeps only histogram
buckets. Enforced in code, not by promise:

- **No address or user agent in our logs** for this route — `server/utils/anonymous-routes.ts`
  (`describeRequester` never even calls the resolver); metrics still count the request.
- **Rate limit keyed on a one-way pseudonym**, not the address (`anonymise: true`,
  `pseudonymiseIdentifier`: HMAC-SHA256 under a per-process random secret, 16 hex
  chars, Valkey TTL = the 60 s window, different after every restart). Verified live:
  the key is `rl:vitals:<16 hex>:<window>`.
- **Nothing on the device.** The plugin and `web-vitals` (grepped: no cookie,
  `localStorage`, `sessionStorage` or IndexedDB) store nothing; `e2e/vitals.spec.ts`
  asserts the beacon holds exactly `name`, `value`, `device` and that a first visit sets
  only the language cookie.
- **Same origin, nothing to third parties**; skipped under DNT / GPC.
- **Not controllable from this repo:** the CDN (Bunny) and proxy still see the connection
  like any request — check Bunny's log anonymisation setting in the dashboard.

Legal basis stated on the privacy page: legitimate interest (Art. 6(1)(f)). With the
above, the TDDDG §25 question (does reading the Performance API count as terminal
access?) is **narrowed, not settled** — nothing is stored or read back from the device
and no identifier leaves it, which is the strongest position available, but the
conclusion is a lawyer's, not this file's.

## The About page's "Operated in the EU" claim — what was checked

`about.vue` makes a public claim, so every sentence was checked against the code. It is
worded **"built to follow"**, never as a guarantee: a legal-compliance claim is not
something a code audit can certify. Keep text and code in step; if one of these facts
changes, change the page.

| Claim on the page                                                               | Evidence                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Own EU server runs app, DB, cache, imgproxy, LibreTranslate, ALTCHA, monitoring | `docker/compose.prod.yml` (all self-hosted containers)                                                                                                                                                                                                                                         |
| Bunny.net (Slovenia) CDN/map storage                                            | CSP origins, `PMTILES_URL`/`IMAGE_BASE_URL` in compose                                                                                                                                                                                                                                         |
| Brevo (France) for account mail                                                 | `server/utils/mail.ts`                                                                                                                                                                                                                                                                         |
| No analytics, ads, social widgets, third-party scripts or fonts                 | production CSP: `script-src`/`font-src` are `'self'` (+ nonce); jsdelivr is dev-only; fonts via `@fontsource`                                                                                                                                                                                  |
| Only functional storage; no cookie banner                                       | real browser session: cookie `vestigian-locale` (+ session cookie after sign-in); localStorage `vestigian-color-mode`, `vestigian-enrichment`, `vestigian-language-notice-dismissed`, `vestigian-intro-tour`, column position, `vestigian-offline-areas`; Cache Storage only for offline areas |
| Featured-list choice kept on the device                                         | localStorage `vestigian-featured-nearby`: two booleans, written only when a switch is flipped, read after mount (`useFeaturedSites.ts`); disclosed in `privacy.cookiesBody`                                                                                                                    |
| Photos stripped of EXIF/GPS                                                     | sharp re-encode in `contributions/images.post.ts`                                                                                                                                                                                                                                              |
| Export/delete from privacy page                                                 | `auth/export.get.ts`, `auth/account.delete.ts`                                                                                                                                                                                                                                                 |
| Vendors not told about us                                                       | `GF_ANALYTICS_REPORTING_ENABLED=false`, Loki `analytics.reporting_enabled: false`, Tempo `usage_report`, Alloy `--disable-reporting` (added)                                                                                                                                                   |
| Stated exceptions                                                               | `DISABLE_ONLINE_API: 'false'` (CrowdSec); DARE/satellite default hosts `dh.gu.se`, `tiles.maps.eox.at`                                                                                                                                                                                         |

**Found while checking, and what was done:**

- **Hillshade fell back to `tiles.mapterhorn.com`, which is Cloudflare** (real request:
  `server: cloudflare`, `cf-ray`; Mapterhorn's own policy stores IP and user agent for 30
  days). A production build now draws no relief unless `NUXT_PUBLIC_BASEMAP_TERRAIN_URL`
  names a PMTiles mirror on our CDN (`buildAtlasStyle`), and the **production CSP no longer
  allows the host at all** (`developmentOnlyOrigins` in `nuxt.config.ts`). The mirror is
  `scripts/ops/mirror-terrain.sh`, steps in runbook §15a. `tiles.openfreemap.org` is
  Cloudflare too but is development-only (production sets `provider: pmtiles`).
- **Alloy reported usage to Grafana Labs** by default — now disabled.
- **The privacy page said the theme preference was a cookie and never mentioned
  localStorage.** Both corrected (it is `localStorage`; the list above is now disclosed).
- **Open, not decided here:**
  - **Brevo's HTTP API is behind Cloudflare** (`api.brevo.com` and `api.sendinblue.com` both
    resolve to AS13335; there is no other Brevo API host). The call is server-to-server, so
    **no visitor IP is in it** — the payload is sender, recipient address, subject and the
    message body (display name, the verification/reset link with its token, moderation
    notes), and the source address is our VPS. But TLS ends at Cloudflare, so that content
    is decrypted on a US company's edge. Options and evidence in the answer log of
    2026-10-02: Brevo's own SMTP relay (`smtp-relay.brevo.com`, AS200484, France, no
    Cloudflare) was rejected as a transport; Scaleway Transactional Email
    (`api.scaleway.com`, AS12876, "Scaleway API Gateway fr-par") and Sweego (OVH, France) were
    checked and are not behind a US CDN; Mailjet and Mailgun EU run on Google Cloud;
    MailerSend is Cloudflare; SMTP2GO is Akamai.
  - `api.crowdsec.net` is on AWS (Ireland) — see runbook §19.
  - Bunny's edge network is global.
