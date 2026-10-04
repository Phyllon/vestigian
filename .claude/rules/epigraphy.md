---
paths:
  - 'server/database/schema/epigraphy.ts'
  - 'server/utils/inscriptions.ts'
  - 'scripts/import/12-edh-inscriptions.ts'
  - 'scripts/import/13-edh-inscription-images.ts'
  - 'scripts/import/20-attic-inscriptions.ts'
  - 'server/utils/attic-inscriptions.ts'
  - 'server/api/inscriptions/**'
  - 'server/api/attic-inscriptions/**'
  - 'server/api/sites/[id]/inscriptions.get.ts'
  - 'server/api/sites/[id]/attic-inscriptions.get.ts'
  - 'server/api/tracings/[id]/inscriptions.get.ts'
  - 'server/api/tracings/[id]/attic-inscriptions.get.ts'
  - 'server/api/tiles/inscriptions/**'
  - 'server/api/tiles/attic-inscriptions/**'
  - 'app/components/epigraphy/**'
  - 'app/composables/epigraphy/**'
  - 'app/composables/map/useInscriptionsOverlay.ts'
  - 'app/composables/map/useAtticInscriptionsOverlay.ts'
  - 'app/pages/inscriptions/**'
---

## Inscriptions — a mirrored corpus, not a contributed one

`inscriptions` (`server/database/schema/epigraphy.ts`) mirrors the Epigraphic
Database Heidelberg's `inscriptions/` tree — the same
`epigraphic-database-heidelberg/data` GitHub repo `08-edh-findspots.ts`
already reads the `geography/` dump from, one EpiDoc TEI file per record.
Verified live before building: **79,206 files**, CC BY-SA 4.0 stated inside
every file (`<licence target="…/by-sa/4.0/">`). Own table, no `siteId`, no
`status` column — the same reasoning that already keeps `antiquity_*`,
`edh_findspots` and `column_relief_plates` out of `sites`/the public GeoJSON
feed: this is imported reference material carrying its own share-alike
licence, not something `applyRevision()`'s governance model applies to.

**Fetched as one tarball, not per-file.** GitHub's unauthenticated Contents
API caps at 60 req/hr — nowhere near workable at 79,206 files. `12-edh-
inscriptions.ts` downloads `codeload.github.com/epigraphic-database-
heidelberg/data/tar.gz/master` once into `.import/edh-inscriptions/`
(the same "scratch, read once" shape the vici.org MySQL dump already uses)
and extracts only the `inscriptions/` subtree via `tar`'s `filter` option —
`image_metadata/`, `bibliography/` and `geography/` are Phase 2/already
imported/unused here.

**Geometry is not in these files.** An inscription's `<origPlace>` carries a
Trismegistos _place_ reference, not coordinates — resolved in a second pass
by joining `edh_findspots.trismegistos_id`, the same identifier
`verifySiteAgainstEdh` already uses. **`edh_findspots.trismegistos_id` is not
unique** — checked live: 2,210 of 8,234 distinct ids (27%) resolve to more
than one distinct coordinate in the geography dump, one pair over 6 km apart.
`resolveGeometry` only accepts a match where `count(DISTINCT geom) = 1` for
that id; the other 27% are left with a null `geom` rather than an arbitrarily
chosen, possibly-wrong one — of the full 79,201 imported rows, **13,388
(17%) resolve this way**. See bug 5 below for how the first version of this
got it wrong, silently, and what actually caught it.

**Measured, not estimated, once the full import actually ran**: `inscriptions`
is **97 MB total** at full scale (79,201 rows, 13,388 of them carrying a
resolved `geom`) after `VACUUM FULL` (`pg_total_relation_size`, checked
directly — an unvacuumed reading after several `UPDATE`-heavy re-imports read
302 MB, MVCC row-version bloat, not the real footprint). Well under the
pre-import reasoned estimate (280–370 MB) — that estimate assumed a higher
geometry-resolution rate than turned out to be real (bug 5 below cut it from
a wrong 64% to an honest 17%, and a null `geom` costs nothing), which is
exactly the kind of thing an estimate made before any real row existed
can't know. Run `VACUUM FULL inscriptions` again after any bulk `UPDATE`
against this table (a geometry re-resolution, say) — the live figure is not
self-maintaining.

**Photographs are not imported here.** EDH's own `image_metadata/` rights
statements vary per photograph — checked live: a sample record reads
"Rights Reserved – Free Access on Epigraphischen Fotothek Heidelberg", not
an open licence. `13-edh-inscription-images.ts` (Phase 2) has to read each
record's own rights statement before deciding to mirror bytes or link out,
the same discipline `11-column-reliefs.ts` already applies to Commons'
`Copyrighted` field.

### Five real bugs, all found only by running the import against the full corpus

Every one of these passed typecheck and lint, and none was caught by a small
sample — the leading-zero fix (#1) needed only 5 records to surface, but #3
and #4 only appeared at full scale, and #5 needed a real cross-reference
against a genuine nearby site to notice at all, since it produced a
plausible-looking, merely wrong number rather than an error.

1. **The Trismegistos join silently matched nothing at first — a leading-zero
   mismatch, not a broken join.** This corpus's `ref` URLs carry zero-padded
   ids (`.../place/014437`); `edh_findspots` (parsed from a _different_ URL
   shape in the geography dump) stores the same id unpadded (`'14437'`). A
   verbatim string join matched 0 of 5 real records that plainly shared a
   findspot (confirmed by hand: both ids existed, just formatted
   differently). Fixed by round-tripping through `Number()` in `trailingId`
   before storing.
2. **Line numbers were off by one for every inscription.** EpiDoc's
   `<lb n="N"/>` marks the _start_ of line N, not a separator between two
   already-accumulated lines. The first version flushed-then-incremented on
   every `<lb>`, so `<lb n="1"/>` — which sits before any content at all —
   produced an empty flush and moved straight to "line 2" before the
   inscription's real first line had been read at all. Every line in every
   mirrored inscription was numbered one higher than the source. Fixed by
   reading the `n` attribute directly and flushing _before_ assigning the
   new number, with `currentLine` starting at 0 (not 1) so a flush before
   any line has been opened produces nothing rather than a phantom "line 1".
3. **A fixed `varchar(200)` on `title` overflowed on the full corpus**, not
   the 1,500-record sample that passed. Free-text scholarly fields
   (`title`, `material`, `origin_place_name`, `province_name`,
   `find_modern_place`) are `text`, uncapped, the same treatment
   `antiquity_places.description` already gets — a fixed-length `varchar`
   is for codes and short enums (`inscription_type`, `text_language`,
   `find_modern_country_code`), not scholarly prose whose real length this
   project doesn't control.
4. **One malformed file ("missing root element") crashed the whole run at
   record ~69,700 of 79,206.** xmldom's `errorHandler` option runs _before_
   a fatal parse error is thrown — it does not suppress the throw. The
   parser's own recoverable-entity handling stayed in place, and the call
   site in `main`'s loop gained its own `try`/`catch` around
   `parseInscriptionXml`, counting a thrown parse failure as `malformed` the
   same way a `null` return already was, rather than losing 87% of a
   completed run to one bad file.
5. **The geometry join silently mis-located inscriptions — nothing errored,
   nothing typechecked wrong, the count just quietly lied.** The first
   version joined `inscriptions.origin_trismegistos_id`
   to `edh_findspots.trismegistos_id` and took whatever Postgres handed back,
   assuming (never checked) that the id was unique in the geography dump. It
   is not: HD000001 resolved to a point 6 km from the Cumae findspot its own
   `<origPlace>` names, sitting instead near a place sharing the same
   Trismegistos id for an unrelated reason. Caught only by cross-checking one
   resolved inscription against a real nearby Vestigian site by hand — the
   API returned `[]` for a site 206 m from HD000001's true location, which is
   what actually surfaced the bug, not a query error or a test failure. Fixed
   with `HAVING count(DISTINCT geom) = 1`, dropping the resolved rate from a
   _wrong_ 64% to an _honest_ 17% — a smaller number that is actually true is
   the right outcome here, not a regression to explain away.

### Vocabulary normalisation is intentionally partial

`INSCRIPTION_TYPE_LABELS`/`OBJECT_TYPE_LABELS` in the import script translate
the German EAGLE-vocabulary terms the source XML carries into short English
slugs — but only the terms actually observed while building this import
(widened once already against a real 1,500-record sample), not the full
upstream EAGLE vocabulary, whose LOD endpoints were not confirmed live for
this pass. An unrecognised term is kept verbatim rather than guessed at —
the same restraint `.claude/rules/map-and-tiles.md` already documents for
AWMC's material/period codes. **EDH appends a trailing `?` to a term when
its own classification is uncertain** (`Grabinschrift?`) — stripped before
lookup, since carrying "uncertain" through as its own fact would need a
second column this pass doesn't add. Extend these tables as real imports
surface more terms; don't pre-populate coverage for terms nobody has seen.

## Cross-referencing, the browse/detail pages, and the map layer

`server/utils/inscriptions.ts` holds all of it: `findInscriptionsNearSite`/
`findInscriptionsNearTracing` (`ST_DWithin` joins surfaced as "Inscriptions
found nearby" on both the map panel and full-page views —
`EpigraphyNearbyInscriptions.vue`, wired into `SiteDetailPanel.vue`,
`TracingDetailPanel.vue`, `app/pages/site/[slug]/index.vue` and
`app/pages/tracing/[id]/index.vue` — all four, not just the map panel, since
the reading-mode pages render their own separate templates rather than
reusing the panel's), `loadInscriptionDetail` (the `/inscriptions/:edhId`
page), and `buildInscriptionTileSql`/`buildInscriptionCacheKey` (the map's
"Show inscriptions" overlay, `app/composables/map/useInscriptionsOverlay.ts`
— one plain symbol layer over the 13,388 geometry-bearing rows, the same
unclustered shape `server/utils/ports.ts` already uses for a comparable
count, not the sites-style clustering machinery `useViewportTiles.ts` needs
at 61k+). The overlay rides the shared `atlas-version` cache generation —
the same convention every other imported-reference layer here follows
(ports, battles, coin hoards): a moderator's approval bumps `data-version`
instead, and this table has nothing to do with that clock.

**A fourth cross-reference, added later: "the empire's extent when this was
carved."** `findEmpireStatesForDating` (`server/utils/atlas.ts`) reads an
inscription's own `notBefore`/`notAfter` against the same 52
`antiquity_empire_extents` slices the period scrubber stands on — the same
half-open-interval convention `buildEmpireExtentTileSql` already uses
(`start_year <= to AND end_year > from`), not a new time model. A dating
range spanning a slice boundary can genuinely overlap more than one state
(shown joined with `/`, the same treatment `/api/atlas/empire-periods`
already gives the Western/Eastern split after 395). Reuses the existing
machinery rather than building new time UI, per the plan: no map preview, no
deep link into the scrubber, just a text row (`epigraphy.detail.empireState`)
next to "Dated" on `/inscriptions/:edhId` — empty and hidden when the
dating range is undated or falls outside the scrubber's 509 BCE–476 CE
coverage. Not applied to Attic Inscriptions Online: AIO's Classical/
Hellenistic Athenian corpus mostly predates the scrubber's own Republic-era
slices, and the plan's cross-reference item names only the EDH corpus.

Two more real bugs, found only by actually clicking a marker on a running map:

6. **`USelect`'s "Any type"/"Any language" filter options crashed the whole
   `/inscriptions` page** — covered above as vocabulary/UI work, but the
   root cause belongs here too since it's a Reka UI constraint, not an
   epigraphy one: an item's `value` can never be `''`, that string is
   reserved internally for "nothing selected". Fixed by using the sentinel
   `'all'` throughout (`app/pages/inscriptions/index.vue`,
   `app/composables/epigraphy/useInscriptionBrowse.ts`).
7. **A fully undated inscription's map popup showed a bare "AD" with no
   year.** MVT has no null type — a NULL column is simply omitted from the
   decoded feature's properties, so `not_before`/`not_after` arrive as
   `undefined`, not `null`, once a real browser (not a raw tile fetch)
   decodes them. `formatPeriod`'s `from === to` branch matched on
   `undefined === undefined` before its own `=== null` checks got a chance
   to run, taking the "single exact year" path instead of "undated" and
   rendering `t('periodFormat.ad', { year: undefined })`. Fixed by
   normalising both fields with `?? null` in
   `buildInscriptionPopupHtml` before calling `formatPeriod` — not by
   loosening `formatPeriod` itself, since every other caller already passes
   real `number | null` values with no MVT round-trip in between. **Worth
   knowing for any future overlay that puts a nullable numeric column into
   an MVT tile and reads it back client-side** — the same gap would recur
   silently, since nothing here throws or types wrong, it just renders a
   plausible-looking wrong string.
8. **Tapping an abbreviation on a phone did nothing.** The transcription's
   `<abbr title="...">` reveal is a native browser tooltip, which only ever
   fires on `:hover` — there is no touch equivalent, so a phone reader had
   no way to see an expansion at all despite `epigraphy.detail.textHint`
   already promising "hover or tap". Fixed in
   `app/pages/inscriptions/[edhId].vue` by wrapping the `<abbr>` in a plain
   reset `<button>` inside a `UPopover` (`mode="click"`, Nuxt UI's default —
   fires on tap and click alike, no custom touch handling needed), with the
   expansion shown in the popover's `#content` slot. The `<abbr title>`
   itself stays, both for its native accessible fallback and as a free
   hover affordance on desktop; the popover is what makes tap actually work.
   Verified live with Playwright under an iPhone 13 viewport (`tap()` on the
   button opens the popover and renders the expansion), not just typechecked.

## Photograph metadata (Phase 2) — link-out only, checked exhaustively before writing a line of import code

`inscription_images` (`scripts/import/13-edh-inscription-images.ts`,
`pnpm import:edh-inscription-images`) mirrors EDH's `image_metadata/` tree —
the same tarball `12-edh-inscriptions.ts` already downloads, one CIDOC-CRM
RDF file per photograph. **No image bytes are ever mirrored.** Before writing
this script, every one of the 43,199 real records (one of 43,200 files is
empty) was checked — not sampled — for its rights `target`, by extracting
the whole `image_metadata/` subtree locally and grepping every file at once
rather than trusting a handful of spot checks: **100% carry the identical
Europeana rights code `rr-f`**. Fetched Europeana's own page for that code
directly rather than assuming what it means from the label: "Rights
Reserved – Free Access... This digital object is protected by copyright...
all other acts of reproduction and communication to the public are subject
to the licensing conditions attached to the digital object" — a statement
Europeana itself has since retired in favour of "In Copyright". Not CC
BY-SA like the text corpus. `isOpenRightsStatement` still runs a real check
against genuine open-licence markers (`creativecommons.org`, `cc0`, "public
domain") rather than a hardcoded `false`, so a future EDH addition under an
actual open licence is picked up automatically — the same discipline
`11-column-reliefs.ts` applies to Commons' `Copyrighted` field — but nothing
in the current corpus trips it, and 24,779 rows imported with `mirrored =
false` on every one confirms that live, not just in theory.

Surfaced on `/inscriptions/:edhId` as a "Photographs" section: capped at 8
link-out chips (one inscription — HD009430, a fragmentary honorific text
from Aventicum — carries 127 separate photograph records, an entire
excavation's worth of negatives, not something worth listing in full) with
a "+N more on EDH" line for the rest. Each chip credits its photographer/
rights holder rather than a generic "photo" label, since that is the one
piece of real information a rights-reserved record still offers a reader.

**One real bug, found by an import that ran cleanly to "0 imported" with no
error at all** — the kind of failure that looks like success:

8. **Every field lookup silently matched nothing on the first run**, because
   this document's elements carry an explicit `crm:` namespace prefix
   (`<crm:E30.Right>`) rather than the default, unprefixed namespace the
   inscription TEI files use (`<title>`, no prefix at all) — the two source
   trees in the very same tarball are written differently, and nothing
   about the RDF shape hints at this without comparing the two side by
   side. `getElementsByTagName('E30.Right')` (bare, copied from the pattern
   in `12-edh-inscriptions.ts`) matched zero elements, `directText` then
   received `null`, and `parseImageXml` returned `null` for every single
   file — read by the script's own tally as "carried no rights statement at
   all" for a 100-file dry run, a plausible-sounding outcome for a random
   sample, not an obvious bug. Fixed by qualifying every lookup with the
   `crm:` prefix (`getElementsByTagName('crm:E30.Right')`, etc.) — confirmed
   by rerunning the same dry run and watching the count move from 0 to 39.
   The inscription-link join key (`P128.carries > E34.Inscription >
P1.is_identified_by > E42.Identifier`, present on 61% of records) was
   also verified this way, not assumed from the RDF's apparent shape.

## I.Sicily — a third corpus, text only

5,136 Sicilian inscriptions (Greek, Latin, Elymian, Sikel, Punic), CC BY 4.0 with six
CC BY-NC 4.0 records, in `isicily_inscriptions`. **Its photographs are deliberately not
mirrored** — the captions grant a permission to the project, not a licence downstream.
Source, licence reading, the four files with a wrong `<idno>`, the layer and the detail
page (`/inscriptions/sicily/:id`) are all in `.claude/rules/reference-overlays.md`, which
loads when you touch those files; it is not repeated here.

## Attic Inscriptions Online (Phase 2) — a second, genuinely separate corpus

The plan's own open item was "confirm AIO's bulk-access mechanism before
committing to mirroring it" — checked live, not assumed, and what turned up
changed the shape of the import from what the plan sketched.

**AIO has a real REST API, but it is thin.** `atticinscriptions.com/api/` is
a genuine Swagger UI with its full spec embedded inline in the page
(`window.drsSpec`) — two endpoints, a paginated list
(`list_all_inscriptions.{json,xml}`, confirmed **3,412** records across 35
pages of 100, not the plan's estimated 2,727) and a per-record endpoint. The
per-record JSON carries exactly seven fields — `url`, `aio_key`,
`references`, `translation_title`, `translation_epidoc` (the English
translation as base64 EpiDoc), `translators`, and a generic
`"IPR": "Creative Commons"` string — checked across a dozen records
spanning four different translators and source volumes, always this same
shape, never a Greek edition despite the API description's own "Greek text
(where present)" claim. **The metadata this table actually needs — monument
type, inscription type, a real date, and a Pleiades URI per findspot —
exists only in each inscription's own rendered HTML page, never in the
API's JSON at all.** `20-attic-inscriptions.ts` fetches only the HTML per
record (one request, not two — the translation text is fully recoverable
from the rendered page, so the JSON endpoint is never called at all in the
final import, cutting the request count in half from an earlier version
that fetched both).

**Licence, checked properly rather than trusted from the vague `IPR`
field**: every inscription's HTML page carries a real
`<a rel="license" href="http://creativecommons.org/licenses/by-sa/3.0/…">`
— CC BY-SA 3.0, confirmed on records from four different translators and
source volumes (IG II³ 1, IG II², SEG, Raubitschek), not assumed from the
API's generic "Creative Commons" string, which names no version at all.

**Geometry resolves through the same identifier space the Barrington sheet's
own places already live in — no new join key.** A findspot is a Pleiades
URI (`https://pleiades.stoa.org/places/579920`); `pleiadesIdFromUri` is the
same trailing-numeric-id extraction `05-antiquity-atlas.ts`'s own
`pleiadesId` helper already applies to AWMC's data. Confirmed live before
writing the join: both a five-digit sample id and a newer nine-digit one
(`638356144`, "Acropolis of Athens" — Pleiades mints longer ids for more
recently added places) already resolve against `antiquityPlaces.pleiadesId`.
`resolveGeometry` denormalises the _first_ resolvable findspot's coordinate
into `geom` for the map, the same "resolve once at import, not per read"
call `12-edh-inscriptions.ts` makes for its own Trismegistos join — the
full findspot list, fragment labels included, is what the detail page shows.

**The translation body is parsed from the rendered HTML, not the raw EpiDoc
XML the API returns.** AIO's own markup — `.insline` (one real inscribed
line per span, occasionally labelled every fifth line by a nested
`.inslineno`), `.aio_place` (a linked place name carrying its own Pleiades
href), `.translit` (a transliterated Greek gloss in parens), and a bare
`<sup><a href="#note-N">` for a footnote reference — is simpler and more
reliable to read than re-deriving the same structure from nested XML, the
same "read what the site already renders safely" call already made for the
column-relief plate numbers and the AWMC minor-feature codes. Parsed into a
flat, typed segment list (`text | break | lineNumber | place | gloss |
note`) and rendered with explicit `v-if`/`v-else-if` branches per type on
the detail page — never `v-html`, the same discipline
`inscriptions.textEdition`'s abbreviation tokens already follow.

**Measured after the full import actually ran, not estimated beforehand**:
all 3,412 records imported cleanly, 0 skipped; **2,669 (78%) resolved a
findspot** via the Pleiades join above, denser than EDH's own 17% precisely
because AIO's corpus is geographically concentrated in Attica, a region
Pleiades covers thoroughly, rather than scattered across the whole former
empire. `attic_inscriptions` is **14 MB total** including its GiST and
btree indexes — well under the plan's "low tens of MB" estimate. Top
`monumentType` values across the full corpus: Stele 1,509, Base 769,
Plaque 203, Altar 163 — checked again after the full run, since an early
300-record sample had ranked 'Block' (33 records total) ahead of 'Altar'
(163) in what looked like a representative top four; the browse page's
facet dropdown was built from that early, wrong ranking and corrected once
the real distribution was in hand.

**Own table, own toggle, not folded into the EDH inscriptions layer or its
"Show inscriptions" switch.** `attic_inscriptions` has no foreign key to
`inscriptions` and no shared row identity — checked before assuming any
overlap: the sample records are 4th–1st century BC Athenian decrees, well
before EDH's own Roman-imperial scope even starts, so this is a second,
genuinely separate corpus rather than a richer translation of rows already
mirrored. Its own map overlay (`useAtticInscriptionsOverlay.ts`,
`vestigian-attic-inscriptions` layer, `Show Attic inscriptions` switch,
Lucide `scroll` glyph — deliberately not the EDH layer's `scroll-text`, so
the two can be switched on together near Athens without reading as the
same mark twice), its own browse/detail pages
(`/inscriptions/attic`, `/inscriptions/attic/:aioKey`, cross-linked from
`/inscriptions`), and its own nearby-site/tracing cross-reference endpoints
and panel section, mirroring the EDH corpus's shape throughout rather than
inventing a different one.

**Four real bugs, all found by running the import against real data, not
by review:**

10. **`notBefore`/`notAfter` were inverted for every BC record.** AIO's own
    dating is Athenian archon-year notation ('352/1 BC', a civil year
    spanning two modern ones); a smaller BC year number is chronologically
    _later_, and the first version negated the wrong half of the pair,
    storing `notBefore` as the later year and `notAfter` as the earlier one
    — backwards for every single BC-dated row, silently, since nothing
    types or throws on `notBefore > notAfter`. Caught by reading the actual
    imported values back for a known example (352/1 BC should read
    `notBefore: -352, notAfter: -351`) rather than trusting the logic by
    inspection.
11. **Every multi-fragment findspot read the identical, wrong text.** The
    findspot block reads "Fragment a - Findspot: Eleusis &lt;a&gt;…&lt;/a&gt;
    (EM 10052) Fragment b - Findspot: Eleusis &lt;a&gt;…&lt;/a&gt; (EM
    5136)" as one run of text with the place name a plain text node
    _before_ its link (the link's own content is only an icon span, never
    the name). A first version fell back to the link's parent's full text
    when the link itself had none, which is the _whole block_, not the one
    fragment's name — every fragment on a multi-findspot record ended up
    with byte-identical text. Fixed by walking the block's child nodes in
    document order, tracking the current "Fragment X" label and the pending
    place name as plain text, and pairing each with the `<a>` that follows
    it.
12. **`Findspot:` blocks were matched with `startsWith`, missing every
    multi-fragment record entirely.** The block's own text reads "Fragment
    a - Findspot: …", never "Findspot: …" first — `startsWith('Findspot:')`
    silently returned zero findspots for any record with more than one
    fragment. Fixed with `includes`.
13. **93 of a 300-record sample carry a genuinely blank `#ins_title`** — a
    real gap in AIO's own data (an untitled decree fragment still carrying
    real translation content and a source citation), not a scraping
    failure. Storing the empty string would have shipped unusable blank
    page titles; falls back to the citation, then the AIO key itself.
    Separately, `monumentType` fragmented into two facet values for the
    same classification ('Stele' vs. 'Stele?', AIO's own uncertainty
    marker) — stripped with the same restraint EDH's own
    `normaliseVocabTerm` already applies to its German vocabulary terms.

**Politeness**: one request every `AIO_REQUEST_DELAY_MS` (default 200ms) —
`robots.txt` only disallows `_preview/` paths, but ~3,400 requests to a
small academic site over a tight loop would still be inconsiderate. Each
page is cached to `.import/attic-inscriptions/` (resumable, same "scratch,
read once" shape every other import here uses), so a re-run after a bug fix
costs no further network traffic at all — every fix above 10–13 was
verified by re-running against the same cached HTML, not by re-fetching.

## EDH metadata is machine-translated on read; the carved text never is

`title`/`commentary` on `/inscriptions/:edhId` are EDH's own German
scholarly metadata (verified live, not assumed — every sampled record's
prose is German; `textLanguage` is a different field entirely, the
inscription's own carved language). `/api/inscriptions/[edhId].get.ts`
translates both through the same self-hosted LibreTranslate
`/api/sites/:id/enrichment` already uses (`translateText`,
`.claude/rules/enrichment-and-i18n.md`), when `?lang` names one of the six
interface languages and differs from German. Cached per (inscription,
language) in Redis at `inscription-translate:v1:{edhId}:{lang}` — a week for
an answer, a day for "nothing came back", the same lifetimes enrichment
uses. Fails open, same as enrichment: a timed-out or unreachable
LibreTranslate leaves the German original in place rather than blocking the
page. `app/pages/inscriptions/[edhId].vue` re-fetches on locale change
(`watch: [locale]` on its `useAsyncData`) and shows the same three-case
disclosure `SiteEnrichment.vue` already established (nothing said when
already in the interface language, "Machine-translated from German" when a
machine stepped in, "In German" when left untranslated) — reusing
`enrichment.machineTranslatedFrom`/`enrichment.inLanguage`/
`enrichment.languages.*` directly rather than duplicating them under
`epigraphy.*`.

**The transcription itself (`textEdition`/`textDiplomatic`) is never
translated, on purpose.** It is Latin or Greek, and the self-hosted
LibreTranslate instance here has only the app's six modern interface
languages loaded (`/languages` checked live: `en`, `nl`, `fr`, `de`, `it`,
`es` — no `la`, no `grc`) — there is no engine to even attempt it with. More
to the point, this is a primary source, not prose: a fluent-sounding but
wrong machine rendering of a carved abbreviation would be far worse than no
translation, the same caution that kept Iconclass tagging and photo-reading
out of this project's scope elsewhere. A genuine reading translation of the
Latin/Greek content is a scholarly problem Attic Inscriptions Online already
solves by hand for its own corpus (`translationEdition`) — not something to
approximate with a generic translation model.

**Scope is title + commentary only — not `material`, `originPlaceName`,
`findModernPlace` or `bibliography`.** Place names are proper nouns and
should never be machine-translated at all; `bibliography` is citation text,
also never translated. `material` is real German prose ("unbestimmt",
"Marmor") but stays untouched deliberately: it is a one- or two-word field
with no sentence context, exactly the shape `enrichment-and-i18n.md`'s own
audits found LibreTranslate gets wrong most often (`site`→`Website`,
`limes`→citrus fruit, `Key`→a door key) — a short label is safe to translate
inside a full sentence and unreliable standing alone. Not attempted here for
the same reason those audits exist.

**AIO's own `translationEdition` is untouched by any of this** — it is
already curated human English, a segmented structure (text/place/gloss/note
spans with embedded Pleiades links and footnote anchors), not a flat string
`translateText` could take as input without first flattening and then
reconstructing that structure. Translating it further into the other five
interface languages is a real, separate feature, not attempted in this pass.

## "Show on map" — both detail pages, the same URL-hash convention as `site/[slug]`

`/inscriptions/:edhId` and `/inscriptions/attic/:aioKey` each carry a
`mapLink` computed, identical in shape to `site/[slug]/index.vue`'s
original: `` `/#map=${zoom}/${lat}/${lon}` ``, read on mount by
`useCameraState`'s `restoreCamera()` (`useMapInstance.ts`) when the map page
next mounts. Not a live `flyTo` call — the reading layout's detail pages and
the map page's `default` layout are different page/layout pairs
(`app.vue`'s `<NuxtLayout><NuxtPage /></NuxtLayout>` swaps both together),
so following the link is a full navigation and remount of `MapCanvas`, not
an in-place camera move into an already-running map instance. Zoom **17**,
one step tighter than the site page's 16 — an inscription is a single
carved object, not a settlement-scale record, and warrants landing a bit
closer. Hidden (`v-if="mapLink"`) when the record's own findspot never
resolved a geometry (83% of the EDH corpus, 22% of AIO's).

## Not built, deliberately: a "read N inscriptions" milestone

The plan's own closing item was a `notebook/MilestoneStamps` entry for
reading N inscriptions. Not built, and not pending — every existing mark in
`shared/utils/milestones.ts` is derived from a count the database already
keeps for another reason (visits, approved contributions, countries), and
there is no tracking anywhere of which inscriptions a given user has opened:
inscriptions are pure imported reference data, no `siteId`, no per-user
row at all. Earning this mark would mean standing up a new table whose only
purpose is logging inscription views per user — a real per-user
behavioural log, not a derived count, and out of proportion to one badge.
Decided against when this came up as the plan's last open item; revisit
only if a genuine second reason to log per-user inscription reads ever
appears (a reading-history page, say) and the milestone rides along with it.
