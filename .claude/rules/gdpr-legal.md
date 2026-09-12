---
paths:
  - 'server/api/auth/account.delete.ts'
  - 'server/api/auth/export.get.ts'
  - 'app/pages/privacy.vue'
  - 'app/pages/impressum.vue'
---

## GDPR / legal

Not legal advice — the operator's real identity still has to go into
`app/pages/impressum.vue` and the controller/supervisory-authority blocks of
`app/pages/privacy.vue` before either goes live, and a lawyer should read both
before real users see them. What follows is the technical side, verified
against the actual code rather than assumed.

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
