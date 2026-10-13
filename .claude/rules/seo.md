---
paths:
  - 'server/routes/sitemap*'
  - 'app/composables/data/useNoIndex.ts'
  - 'app/composables/data/useCanonicalUrl.ts'
  - 'app/composables/data/useSocialMeta.ts'
  - 'shared/utils/structuredData.ts'
  - 'scripts/generate-og-placeholders.ts'
  - 'scripts/generate-app-icons.ts'
  - 'server/utils/sitemap*'
---

## SEO

No SEO npm module (`@nuxtjs/sitemap`, `@nuxtjs/robots`, `nuxt-og-image` and
friends) — everything below is hand-rolled Nitro routes/composables, on
purpose: `sitemap.xml.get.ts` already does the hard part these modules exist
to save you from (DB-driven URL discovery across two entity types plus
dynamic limes sectors), so wrapping that in a generic module's config shape
would buy nothing and add a build-hook surface to reconcile with
`nuxt-security`'s CSP.

**Sitemap is an index, not one file.** `sitemap.xml.get.ts` returns a `<sitemapindex>`
pointing at `sitemap-static.xml` (the hand-written pages in `SITEMAP_STATIC_PATHS`, plus every
limes sector) and one paginated child per kind of record in `SITEMAP_SOURCES`
(`server/utils/sitemap-sources.ts`):

| Child                              | Rows                                   | Order, `lastmod`        |
| ---------------------------------- | -------------------------------------- | ----------------------- |
| `sitemap-sites/{n}`                | approved sites                         | `id`, from `updated_at` |
| `sitemap-tracings/{n}`             | approved tracings                      | `id`, from `updated_at` |
| `sitemap-inscriptions/{n}`         | EDH inscriptions (`/inscriptions/HD…`) | `id`, none              |
| `sitemap-attic-inscriptions/{n}`   | Attic Inscriptions Online              | `id`, none              |
| `sitemap-isicily-inscriptions/{n}` | I.Sicily                               | `id`, none              |

**Where it stood (2026-10-12, dev database, which holds the full import):** 61,273 sites,
11,496 tracings, 79,201 + 3,412 + 5,136 inscriptions, 17 limes sectors and 11 static pages —
**160,546 URLs in 8 files**, the largest 4.1 MB and 40,000 URLs. Before this the inscriptions
(about 88,000 URLs) and `/about`, `/partners`, `/features`, `/columns`, `/tabula-peutingeriana`,
`/inscriptions` and `/inscriptions/attic` were not listed at all.

**Pages are fixed runs of the primary key, not `updated_at desc`.** The old order carried an
edited row to page 0 and pushed 40,000 others across a file boundary; a page is now stable and
`lastmod` is what says a row changed. The mirrored corpora carry **no `lastmod`**: their rows
are written by an import, so any date they have is when it last ran, and one date on every URL
is worse than none. `changefreq`/`priority` are still not emitted — Google ignores both.

**A page past the last is a 404**, not an empty file; page 0 always exists. The index computes
its children from live row counts (cached an hour), so a corpus that outgrows a file gains a
page by itself.

**The limits, and what to do at them** (sitemaps.org): a file holds at most **50,000 URLs and
50 MiB uncompressed**; an index at most **50,000 sitemaps** and may not list another index.
`SITEMAP_PAGE_SIZE` is 40,000, so a file is 4–10 MB. Nothing needs doing as the data grows —
that is what the computed child list is for — until an index would hold 50,000 files, which is
two billion URLs. Then a second index is submitted beside the first (Search Console takes up to
500 per site) and `robots.txt` lists both. The realistic limits arrive much earlier and are not
the protocol's: `OFFSET` paging gets slower as a corpus reaches millions of rows (move the
sources to keyset paging on `id`), and a crawler's budget, not the sitemap, decides how fast
160,000 URLs are read. `buildUrlsetXml` and `buildSitemapIndexXml` **throw** over 50,000
entries rather than write a file a crawler would reject whole.

**A new page cannot be forgotten.** `server/utils/__test__/sitemap-pages.test.ts` compares
`app/pages/` with `server/utils/sitemap-pages.ts`: every page that is not `noindex` must be in
`SITEMAP_STATIC_PATHS`, `SITEMAP_DYNAMIC_ROUTES` or `SITEMAP_LEFT_OUT` (with a reason), no
`noindex` page may be listed, and nothing may name a page that no longer exists. A new kind of
record takes a source in `SITEMAP_SOURCES`, a route file `sitemap-<name>/[page].get.ts`, and an
entry in `SITEMAP_DYNAMIC_ROUTES`.

**Left out on purpose:** contributor profiles (`/contributor/…`) — a person's page, reached from
the record they contributed to, not enumerated for a crawler. They are not `noindex` either, so
a crawler that follows a link still indexes one; whether people should be indexed at all is a
privacy decision that has not been taken. Also out: every `noindex` page (`/nearby`, `/offline`,
`/settings`, `/notebook/*`, the auth pages, `/moderation`, `/admin`, the editors).

**robots.txt disallows crawling, page-level `noindex` disallows indexing.**
These are different mechanisms and this app uses both: `robots.txt` keeps a
crawler from spending budget on `/login`, `/register`, `/site/*/edit`, etc.,
but an already-linked disallowed URL can still be indexed sans content —
`useNoIndex()` (`app/composables/data/useNoIndex.ts`) closes that gap on the
same pages plus `/moderation`, `/verify`, `/reset-password`.

**`/admin` gets a third measure, and the third is the one that binds.** The
admin station carries `Disallow: /admin` in `robots.txt` and `useNoIndex()` on
the page like everything above, _plus_ an `X-Robots-Tag: noindex, nofollow,
noarchive` response header in `nuxt.config.ts`'s `routeRules` (spelled out for
both `/admin` and `/admin/**`, since whether the wildcard also matches the bare
prefix is a radix3 detail not worth resting this on). The header exists because
a `<meta name="robots">` only exists once a crawler has executed the page, and
this app is a Nuxt SPA behind a CDN — a fetcher that never runs JavaScript sees
the tag not at all, and `robots.txt` binds only the crawlers that read it. The
same `routeRules` entries set `cache-control: no-store` on `/admin/**` and
`/api/admin/**`: those responses carry registered email addresses and one
person's complete contribution history, and nothing in this config forbids
page-level edge caching at Bunny. Every admin fetch is `server: false` for the
same reason `AuthAccountMenu` is `ClientOnly` — admin-visible data must never be
baked into server-rendered HTML. `e2e/admin.spec.ts` asserts the header and the
`robots.txt` line, not the meta tag, because the header is the part a
non-executing client obeys.

**Canonical URLs never carry a query string.** `useCanonicalUrl()` always
resolves to the bare `route.path`, never `route.fullPath` — there is no
filtered or paginated content view in this app today, so a query param
reaching a canonical would only ever be noise, and stripping it defensively
now avoids inventing a rule later once one exists.

**Structured data (JSON-LD) lives in `shared/utils/structuredData.ts`**, not
`server/utils/` — the builders are called from page `<script setup>` blocks,
which run in the Nuxt app, and `server/utils/` is Nitro-only and not part of
that module graph. Sites and tracings are both `@type: "Place"` (not
`ArchaeologicalSite` — not a real schema.org type). Tracing geometry
(GeoJSON Line/Polygon) is never encoded as `geo` — schema.org's `GeoShape`
has poor real-world rich-result support, so omitting it beats emitting
something a crawler silently ignores.

**OG images: a real photo when one exists, a static category card otherwise.**
`IMAGE_PRESETS.og` (1200×630, Open Graph's documented size) reuses the
existing signed imgproxy redirect at `/api/images/:id/og` — no CSP change
needed, since `og:image`/`twitter:image` are fetched directly by the sharing
platform's scraper, never loaded as an in-page `<img>`. Entities with no
photo (every tracing — `site_images` has no FK to `tracings` — and any site
with zero approved images) fall back to one of the eleven static cards in
`public/og/`, regenerated by `pnpm brand:build`
(`scripts/generate-og-placeholders.ts`, with the mark — see `brand-and-share-assets.md`). **Rerun it whenever the product name or the mark changes**: the rename to Vestigian updated the script but not the committed PNGs, so shares kept the old name on the card for a month. After deploying, purge `/og/*` in the Bunny pull zone (it ignores query strings, so `?v=` cannot bust it) — and WhatsApp/Facebook keep their own copy per URL until re-scraped (Facebook Sharing Debugger). Per-entity dynamic OG rendering
(the title actually burned into the card) is deliberately deferred: Open
Graph only requires a reachable, correctly sized image, and a headless-
browser or Satori/SVG render pipeline is a real new dependency for a purely
cosmetic gain.

**`hreflang` is not implemented, and should not be.** With i18n's `no_prefix`
strategy there is exactly one URL per page regardless of locale, and
`hreflang` alternates require distinct crawlable URLs per language variant —
tags here would either no-op or read as contradictory duplicates. See the
comment on the `i18n` block in `nuxt.config.ts` for the two cheap
mitigations instead (`htmlAttrs.lang`, already correct; the
`Content-Language` response header from `server/middleware/content-language.ts`).

`pnpm icons:build` (`scripts/generate-app-icons.ts`, run by `brand:build`) rasterizes
`public/favicon.svg` into the three PWA icon files `manifest.webmanifest` has
referenced from the start — a maskable icon needs its artwork rendered at
80% and centred, per the W3C's safe-zone convention, not a plain resize, or
content gets clipped the moment an OS masks the icon to a circle.
