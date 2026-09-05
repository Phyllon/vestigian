---
paths:
  - 'app/pages/columns.vue'
  - 'app/components/columns/**'
  - 'server/api/columns/**'
  - 'server/api/column-reliefs/**'
  - 'scripts/import/11-column-reliefs.ts'
  - 'server/database/schema/column-reliefs.ts'
  - 'shared/types/column-reliefs.ts'
---

## Column reliefs — one monument mirrored, one monument live

`/columns` explores the reliefs of two Roman columns in detail — a feature
with no vici.org analogue at all, since vici's corpus is frontier/site
archaeology, not monument photography. The two monuments deliberately use
**different mechanisms**, each matching what its own source actually is,
not a single uniform treatment:

- **Trajan's Column**: Conrad Cichorius's 1896–1900 photographic plates —
  the standard scene-by-scene scholarly reference for the column — from
  Wikimedia Commons' [Cichorius Plates category](https://commons.wikimedia.org/wiki/Category:Trajan's_Column_-_Cichorius_Plates),
  **mirrored** into this project's own storage (`scripts/import/11-column-reliefs.ts`,
  `pnpm import:column-reliefs`) — the same shape as the DARE/satellite
  basemap mirrors and the vici.org photograph mirror, because it's a
  bounded, individually-licensed file set.
- **The Column of Marcus Aurelius**: Eugen Petersen, Alfred von Domaszewski
  & Guglielmo Calderini's 1896 _Die Marcus-Säule auf Piazza Colonna in Rom_
  (128 plates, scenes I–CXVI) — the direct equivalent, for this column, of
  Cichorius's work — digitised by Heidelberg University Library in two
  plate volumes (`petersen1896tafeln1`, Tafeln I–LXIV; `petersen1896tafeln2`,
  Tafeln LXV–CXXVIII) and served **live via IIIF**
  (`ColumnMarcusAureliusViewer.client.vue`), the same OpenSeadragon pattern
  the Tabula Peutingeriana viewer already established. Not mirrored: it's
  one scanned book, not a bounded file pyramid.

Both sources are unambiguously public domain (all contributors to both
works have been dead for decades), but public domain content and a
reachable, well-behaved _service_ are two different questions — the same
distinction this project already applies to DARE, EOX and Voorburg.

**Verified live before any of this was built, not assumed from a summary.**
Three things this session's research got wrong on the first pass, each
caught by actually running a real request rather than trusting a
description:

1. **Heidelberg's IIIF API answers a plain server-side request; a real
   browser's own cross-origin `fetch`/XHR to it does not.** `curl` and a
   Node `fetch` both reach `digi.ub.uni-heidelberg.de`'s manifest, `info.json`
   and tile endpoints reliably (confirmed repeatedly, not a one-off) — but a
   real Chromium session's `fetch()` to the same URLs, from this app's own
   origin, fails outright with `net::ERR_FAILED` / "Failed to fetch",
   reproduced directly in Playwright, not inferred from a header dump.
   `curl -H "Origin: …"` still shows `Access-Control-Allow-Origin: *` on
   both the real response and its OPTIONS preflight, which is exactly why
   this looked safe during initial research — a header dump proves a server
   _can_ answer permissively, not that a real browser's request pipeline
   will actually complete, and only the second claim is the one that
   matters. (Anubis, mentioned in earlier drafts of this section as the
   likely cause, turned out to be a red herring for this specific failure —
   it guards the human-facing book-viewer pages, confirmed separately, but
   is not what blocks the IIIF API.) The fix is architectural, not a header
   tweak: every Heidelberg request is proxied through this project's own
   server (`server/api/columns/marcus-aurelius/manifest.get.ts` and
   `tile/[...path].get.ts`) — the same reasoning that already routes
   Wikidata/Wikipedia enrichment through a server proxy rather than a direct
   browser fetch. The browser never talks to `digi.ub.uni-heidelberg.de` at
   all now, so it isn't in the CSP's `img-src`/`connect-src` either.
2. **Commons' "Cichorius Plates" category is not purely Cichorius's 138
   numbered plates.** It also holds a handful of community-contributed
   detail photographs of specific reliefs (titled descriptively, e.g.
   "Tubicen", not via the "NNN Conrad Cichorius…, Tafel N" convention). The
   import does not try to force a scene number onto these — `sceneNumber`
   stays `null`, the same honest "don't guess" choice already documented
   for the Tabula Peutingeriana import's unlocated places.
3. **Commons' `imageinfo.url` now carries UTM tracking query parameters**
   (`?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original`)
   — confirmed by fetching a real API response, not assumed. A naive
   `url.split('.').pop()` for the file extension read the query string's
   own `commons.wikimedia.org` instead of the real extension before the
   `?`, producing storage keys like
   `column-reliefs/trajans-column/5074858.org&utm_campaign=imageinfo&utm_content=original`.
   Fixed by reading the extension from `new URL(info.url).pathname` instead
   — caught by actually running the mirror against live data and reading
   the resulting rows, not by reasoning about the code.
4. **A first full run mirrored only 5 of 138 plates, not because of a
   licence or parsing bug but because the run was never actually completed**
   — proving the setup with `MIRROR_LIMIT=5` (this script's own documented
   first step, same as the basemap tile mirrors) and then not following up
   with the unbounded run. Running it in full then surfaced a real, separate
   bug: the main loop's failure path (`continue` on a non-mirrored outcome)
   skipped `wait(REQUEST_INTERVAL)` entirely, so once Commons returned one
   non-2xx response the next request fired with no pause at all — and a
   sustained run showed long stretches of consecutive failures for exactly
   this reason, confirmed by the fact that every individually-retested
   "failing" URL succeeded immediately in isolation seconds later. Fixed two
   ways: every real request now paces regardless of outcome (only the local
   `isAlreadyStored` HEAD check skips the wait), and `mirrorPlate` retries a
   `deferred` (not `absent` — see point 3's `isPermanentFailure` split,
   restored here from the tile mirror's own pattern, which this script had
   dropped) outcome up to twice with a short backoff before giving up for
   the run. Together this took a single run from 45/138 mirrored (93
   deferred) to 137/138, with the last straggler picked up by simply running
   `pnpm import:column-reliefs` again — the resumable design doing exactly
   what it's for, not a workaround.
5. **OpenSeadragon does not consume a IIIF Presentation manifest directly**
   — a wrong assumption in earlier drafts of this section, corrected against
   the library's own source rather than general IIIF familiarity:
   `TileSource.determineType` only ever matches a registered `*TileSource`
   class against the data, and every one of them expects a single IIIF
   _Image_ API `info.json` shape, not a `sc:Manifest`. Handing OpenSeadragon
   the manifest URL directly threw "Unable to load tile source" for every
   canvas. `ColumnMarcusAureliusViewer.client.vue` instead fetches the
   manifest itself, resolves each canvas's own Image API service, and hands
   OpenSeadragon an _array_ of `info.json` URLs — the shape it actually
   understands for a multi-page sequence, at which point its own sequence
   controls do become a real page-by-page browser.
6. **An `info.json` response carries its own `@id` field pointing back at
   Heidelberg**, and OpenSeadragon builds every tile URL from that field,
   not from the URL it fetched the document at. Rewriting only the
   manifest's service URLs (point 5) was not enough — every actual tile
   image request bounced straight back to `digi.ub.uni-heidelberg.de`,
   correctly refused by the CSP once that host was removed from it (point
   1). `tile/[...path].get.ts` rewrites an `info.json` response's embedded
   `@id` the same way the manifest proxy rewrites the manifest's; actual
   tile image bytes pass through untouched.
7. **A valid magic-byte header is not a valid image.** Plate 095 (Commons
   pageid 5128786, `Tafel XCV`) downloaded byte-for-byte identical to
   Commons' own copy — same size, confirmed with a direct re-fetch and a
   byte comparison — and still fails a real decode in both `sharp` and
   imgproxy ("Corrupt JPEG data: premature end of data segment"), the same
   libvips build behind both. The corruption is in Commons' own source
   file, not introduced by the mirror. `detectImageFormat`'s magic-byte
   check only reads the first 12 bytes and cannot catch this — the import
   now also attempts a real `sharp` decode (`failOn: 'none'`, discarding
   the result) before storing a plate, and treats a decode failure the same
   as an unrecognised format: skipped, reported, never published.
8. **Commons' own `extmetadata.ImageDescription` is a real, legally usable
   source of per-plate interpretive text** — short scholarly scene captions
   ("Cavalry battle against Sarmatians (scene XXXVII)"), licensed
   identically to the image itself since both live on the same Commons file
   page, confirmed by fetching real `extmetadata` for several plates before
   relying on it, not assumed to exist. Stripped of the HTML Commons wraps
   it in (`stripHtml`, the same policy every other piece of free text in
   this project gets on the way in) and stored as `description`.

**Schema**: `column_relief_plates` (`server/database/schema/column-reliefs.ts`)
is its own table, no `siteId`, no `status`/moderation column — the same
reasoning that already keeps `antiquity_*` and `tabula_peutingeriana_*` out
of `sites`/`site_images`: this is imported reference material, not a
contributed record, so `applyRevision()`'s governance model doesn't apply,
and `site_images.site_id` being `NOT NULL` besides means there's no
existing precedent for a site-less image row to extend. `monument` is a
free `varchar`, not an enum — cheap, and leaves room for a second mirrored
monument later without a second near-identical table, though nothing here
speculatively builds for that today. `source_url` is the import's own
conflict target (`ON CONFLICT … DO UPDATE`), so re-running the mirror
refreshes a row's metadata rather than duplicating it — resumability here
is a deliberate hybrid of the tile mirror's bucket-state skip-if-exists and
the vici.org photograph mirror's DB-driven metadata, cheap enough at ~140
rows that there's no reason to skip the metadata refresh even when the
object is already stored.

**Licence normalisation is deliberately local to the import script, not
`server/utils/images.ts`'s shared `LICENCE_ALIASES`.** That file also
exports `buildImageUrl`, which calls the Nitro-only `useRuntimeConfig`, and
`tsconfig.scripts.json` only whitelists server/utils files verified free of
Nitro auto-imports (`uploads.ts`, `sanitize.ts`, `enrichment.ts`,
`concordance-sources.ts`) — importing anything from `images.ts` into a
script pulls that Nitro dependency into a context with none of the ambient
types for it. A small, self-contained `COMMONS_LICENCE_ALIASES` map in the
script itself is the correct fix, not widening that whitelist to a file
that isn't pure. Commons' own `Copyrighted: "False"` structured field is
checked ahead of the free-text `LicenseShortName`, so a stray non-PD file
in the category still gets its own real licence rather than an assumption
of perfect category uniformity — resolved to a canonical `PUBLIC-DOMAIN`
value, kept distinct from `CC0-1.0`: a "no known copyright" mark is not the
same legal act as an active CC0 dedication.

**Serving**: `/api/column-reliefs` (list, filtered by `?monument=`) and
`/api/column-reliefs/[id]/[preset]` (signed imgproxy redirect) are
dedicated siblings of `/api/sites/search` and `/api/images/[id]/[preset]`
rather than widened versions of them — this project never mixes licensing
regimes behind one query, the same reasoning that keeps `antiquity_*`
routes separate from `sites` ones. `useImageUrl.ts`'s `buildCredit` was
loosened from a `SiteImage`-specific parameter to a small structural
`CreditedImage` interface (`{ attribution, licence }`) so both the site
gallery and this feature's plate credit line share one implementation
rather than two copies of the same three lines. `server/api/columns/
marcus-aurelius/manifest.get.ts` and `tile/[...path].get.ts` are a
different shape entirely — a live pass-through proxy, not a redirect to a
signed rendition — because nothing about the Marcus Aurelius plates is
mirrored into this project's own storage; see finding 1 above for why they
have to exist at all.

**The Trajan gallery is a grid _and_ a carousel, not a grid that opens one
image at a time.** Clicking a thumbnail opens a `UModal` containing a
`UCarousel` (Nuxt UI's own `embla-carousel-vue` wrapper — already a
transitive dependency of `@nuxt/ui`, so no new library was added) started
at that plate's index; swiping, dragging or the built-in prev/next arrows
move through every plate in order without closing and reopening the modal.
The carousel is only mounted while the modal is open (`v-if`), so
`start-index` re-applies fresh to whichever thumbnail was actually clicked
each time, rather than needing an imperative `scrollTo` call after the
fact.

**Reached from the app menu (`AppMenu.vue`), not the basemap switcher's
antiquity group.** The Tabula Peutingeriana viewer sits in that group
because it's another way of looking at _the map_; this feature is
monument-specific reference material with no geographic-view angle, so it
doesn't belong there. The app menu itself is grouped under three
non-interactive `type: 'label'` headers — Column reliefs; Legal & data
(licence, privacy, impressum); Offline maps — once a second and then a
third destination arrived with nothing left to say which parts of the app
they belonged to.
