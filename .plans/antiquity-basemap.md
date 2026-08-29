# Antiquity basemaps — DARE as raster, Barrington built here

> **Superseded in part, and worth reading for why.** This plan proposed
> mirroring two raster tilesets. DARE was built as planned. The CAWM/AWMC sheet
> was not: inspecting the tiles showed it publishes _physical relief only_ — no
> roads, no names, no settlements — so mirroring it would have produced a
> beautiful empty map, which is exactly what shipping it revealed. The AWMC
> layers that make it an atlas are published separately as open data (AWMC
> geodata, ODbL 1.0; Pleiades, CC BY 3.0), so that view is now drawn by this
> project from its own PostGIS through `/api/tiles/antiquity` — the fourth
> option in the tile-source decision below, arrived at by evidence rather than
> by choosing it up front. See the **Antiquity basemaps** section of CLAUDE.md
> for what was actually built.

## Context

The basemap switcher currently offers three views (`vestigia`, `modern`, `terrain`), all of
them recolourings of one modern OpenMapTiles vector source. None of them show the ancient
world: the coastline is the modern coastline, the roads are motorways, and the place names
are today's. An atlas of antiquity that can only draw a 21st-century base is doing half the
job — the Rhine limes, a silted-up harbour or a Roman road's relationship to the terrain are
unreadable against modern infrastructure.

This adds two **antiquity** entries to the switcher, both raster, both from academic
tile servers whose licences permit reuse:

- **Antiquity (DARE)** — the Digital Atlas of the Roman Empire, Johan Åhlfeldt / Centre for
  Digital Humanities, Gothenburg. This is the map the request names.
- **Antiquity (AWMC)** — the CAWM tile server at the University of Iowa, successor to the
  Ancient World Mapping Center's dead Mapbox endpoints.

Both are mirrored into the project's own object storage before launch rather than hotlinked,
which is what vici.org did with the same two tilesets and is the same courtesy the image
pipeline already extends to René Voorburg.

## What was verified, and how

Probed directly with `curl` on 2026-08-29, not taken from documentation:

|           | DARE                                                        | CAWM (AWMC)                                        |
| --------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Template  | `https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png`           | `https://cawm.lib.uiowa.edu/tiles/{z}/{x}/{y}.png` |
| Scheme    | XYZ, EPSG:3857, 256px PNG                                   | XYZ, EPSG:3857, 256px PNG                          |
| Zoom      | z3–z11 → 200; **z12 → 404**                                 | z3–z11 → 200; above z11 a 116-byte blank PNG       |
| CORS      | `Access-Control-Allow-Origin: *`                            | `Access-Control-Allow-Origin: *`                   |
| Freshness | `Last-Modified: Tue, 15 Apr 2025`                           | maintained (Horne, Talbert, Becker et al. 2022)    |
| Mean tile | **39.6 KB** (10-tile sample, z6–z11)                        | **108.7 KB** (6-tile sample, z6–z11)               |
| Licence   | CC BY-SA 3.0, stated on `imperium.ahlfeldt.se/info_api.php` | CC BY 4.0, stated on `cawm.lib.uiowa.edu`          |

Also verified: `dare.ht.lu.se` (the URL in every blog post and in vici.org's own attribution)
**no longer resolves**; `tiles.vici.org/imperium/` serves a byte-identical copy of the same
DARE tile from a 2017 snapshot; `pelagios.org/tilesets/imperium/` is a 404 and
`commons.pelagios.org` is gone. `cawm.lib.uiowa.edu` failed certificate verification in this
sandbox but presents a complete chain under _InCommon RSA Server CA 2_ — a missing root in
the local CA bundle, not a server fault. Browsers are unaffected.

**One licence complication, and it must be recorded in the code rather than forgotten.**
DARE's own legend page credits its inputs as _"Roman roads (Barrington Atlas). Source:
Ancient World Mapping Center (AWMC), CC BY-NC 3.0"_ and _"The Secret History of the Roman
Roads of Britain, CC BY-NC-SA"_. Those contradict the blanket CC BY-SA 3.0 on the terms
page: the rendered PNGs bake in layers DARE itself describes as non-commercial. AWMC has
since relicensed its geodata to ODbL (github.com/AWMC/geodata, `LICENSE.txt`), which
probably resolves it in fact, but nobody has updated DARE's credits to say so. Acceptable
for a non-commercial atlas; the wrong dependency the day Vestigia earns money. CAWM carries
no such ambiguity, which is the argument for shipping both rather than only DARE.

## Approach

### 1. Types — `shared/types/map.ts`

Extend the view union and add a sheet tone. Keep the existing docstring's shape.

```ts
export type BasemapView = 'vestigia' | 'modern' | 'terrain' | 'antiquity-dare' | 'antiquity-awmc'

/**
 * Whether the sheet under the overlay is light or dark. Not the same as the
 * colour scheme: an antiquity raster is printed parchment in either theme, so
 * the site markers on top of it must stay dark ink regardless.
 */
export type BasemapSheetTone = 'light' | 'dark'
```

Add to `BasemapSource`: `antiquityDareUrl: string`, `antiquityAwmcUrl: string`.

### 2. Style building — `app/composables/map/useBasemapStyle.ts`

Add a tileset table beside `BASEMAP_VIEWS`, carrying the licence obligation with the URL so
the two cannot drift apart:

```ts
interface AntiquityTileset {
  url: string // from runtime config; falls back to the upstream server
  attribution: string // required by the licence — this is not decoration
  maxzoom: number // 10; MapLibre overzooms above rather than 404-ing
}
```

Attribution strings (anchor tags; MapLibre's attribution control renders them):

- DARE — `Antiquity base: © <a href="https://imperium.ahlfeldt.se">Digital Atlas of the Roman Empire</a>, Johan Åhlfeldt (CC BY-SA 3.0)`
- AWMC — `Antiquity base: © <a href="https://cawm.lib.uiowa.edu">Consortium of Ancient World Mappers</a> (CC BY 4.0)`

Then, in `buildBasemapStyle`, branch before the vector path:

- Antiquity views build `{ background, antiquity raster }` and **no vector source at all** —
  no OpenFreeMap request is made for these views.
- `glyphs` is still set — the overlay's `vestigia-site-labels` symbol layer needs it and
  dropping it empties the labels — but it now points at the self-hosted path from step 8,
  not at OpenFreeMap.
- Raster source: `{ type: 'raster', tiles: [url], tileSize: 256, minzoom: 3, maxzoom: 10, attribution }`.
  `maxzoom: 10` is deliberate — see the mirror scope below.
- Background colour stays `LIGHT_COLOURS.land` in both themes for these views, so the tile
  gaps at the edge of coverage read as paper rather than as a hole.

Export a new `sheetTone` computed and a small predicate:

```ts
export const isAntiquityView = (view: BasemapView): boolean => view.startsWith('antiquity-')
```

`sheetTone` = `'light'` for any antiquity view, otherwise `isDark ? 'dark' : 'light'`.

Extend `BASEMAP_VIEWS` with a `group: 'today' | 'antiquity'` field:

```ts
{ value: 'antiquity-dare', group: 'antiquity', label: 'Antiquity (DARE)',
  hint: 'Digital Atlas of the Roman Empire' },
{ value: 'antiquity-awmc', group: 'antiquity', label: 'Antiquity (AWMC)',
  hint: 'Barrington Atlas, via Iowa' },
```

### 3. The overlay must follow the sheet, not the theme — `app/composables/map/useViewportTiles.ts`

This is the one change that is easy to miss and impossible to un-see. The palette is
currently chosen by `isDark` (line ~58). In dark mode over an antiquity raster that draws
`DARK_OVERLAY` — pale ink, dark ground — on top of bright parchment, and every site marker
disappears. Swap the input:

```ts
const { sheetTone } = useBasemapStyle()
const palette = computed(() => (sheetTone.value === 'dark' ? DARK_OVERLAY : LIGHT_OVERLAY))
```

No other change; `registerSiteIcons` and the layer paint already read from `palette`.

### 4. The switcher — `app/components/map/BasemapSwitcher.vue`

Five items is where the current hand-rolled panel starts to hurt. Keep the component (it
carries the notebook design and Nuxt UI's `UDropdownMenu` would need every item slot
overridden to keep the label-plus-hint pair), but fix what five items expose:

- Render two `role="group"` sections with `aria-label="Today"` and `aria-label="Antiquity"`,
  each preceded by an `.eyebrow` heading, driven off the new `group` field.
- Add outside-click close with `onClickOutside` from `@vueuse/core` (already a dependency —
  do not hand-roll a document listener).
- Add `@keydown.esc` on the wrapper, closing and returning focus to the trigger. The panel
  is currently unescapable by keyboard, which five items makes worse rather than causes.
- Widen to `w-64` and cap with `max-h-[70vh] overflow-y-auto` so the panel cannot exceed a
  375px viewport.

Trigger, `aria-label` and `role="menuitemradio"` items stay exactly as they are.

### 5. Lamplight, not a lightbox — `app/components/map/MapCanvas.vue`

The chosen behaviour is _dim the sheet, not the map_: the tiles are shown untouched — they
are a facsimile of someone else's cartography and filtering them misrepresents it — but a
bright parchment rectangle inside a night-notebook shell needs an edge. Add a
`pointer-events-none absolute inset-0` div, present only when `isDark && isAntiquityView`,
carrying an inset `box-shadow` vignette in `--color-night-900`. Cheap, reversible, and it
touches no MapLibre paint property.

### 6. Config — `nuxt.config.ts` and `.env.example`

Append to `mapAssetOrigins` (feeds both `img-src` and `connect-src`; a tile origin missing
here is silently blocked, the same failure class as the missing CSP nonce):

```ts
'https://dh.gu.se',              // DARE — upstream fallback until the mirror is live
'https://cawm.lib.uiowa.edu',    // CAWM/AWMC — same
```

`https://*.b-cdn.net` is already listed, so the mirrored tiles need no further entry.

Under `runtimeConfig.public.basemap`, add two keys defaulting to the **upstream** URLs, so a
fresh clone works with no mirror at all and production points them at the CDN:

```ts
antiquityDareUrl: 'https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png',
antiquityAwmcUrl: 'https://cawm.lib.uiowa.edu/tiles/{z}/{x}/{y}.png',
```

`.env.example` gains `NUXT_PUBLIC_BASEMAP_ANTIQUITY_DARE_URL` and `..._AWMC_URL` with a
comment stating plainly that leaving them unset points every visitor at a university
research server, and that production must set them to the Bunny pull zone.

### 7. The mirror — `scripts/import/04-mirror-basemap-tiles.ts`

Modelled directly on `scripts/import/03-mirror-images.ts`: same `S3Client` construction with
the compose-matching fallbacks, same `REQUEST_INTERVAL` pause, same `MIRROR_LIMIT` escape
hatch for a five-tile proving run, same resumability (a `HeadObject` that already exists is
skipped with no request to the origin). Differences:

- Iterates a **zoom/bbox pyramid** rather than a database query. Bbox lon −12…45, lat 30…62
  — Europe, the Mediterranean and the North African coast, which is where the imported
  61,272 sites are.
- Storage keys `basemap/dare/{z}/{x}/{y}.png` and `basemap/awmc/{z}/{x}/{y}.png`.
- **No sharp re-encode.** These are already-optimised PNGs from a third party; re-encoding
  would alter someone else's cartography and buy nothing. Verify the magic bytes with the
  existing `detectImageFormat` from `server/utils/uploads.ts` and reject anything that is
  not a PNG — DARE's 404 is a real 404, but CAWM answers above z11 with a blank PNG, so a
  size floor is worth having too.
- Which tileset to mirror is a positional argument (`dare` | `awmc`); `MIRROR_MAX_ZOOM`
  defaults to 10.

Wire as `"import:basemap": "tsx --env-file-if-exists=.env scripts/import/04-mirror-basemap-tiles.ts"`.

**Scope, with real figures — quote these in the emails.** z3–z10 over that bbox is
**29,593 tiles per tileset**:

|      | requests | bytes at the measured mean |
| ---- | -------- | -------------------------- |
| DARE | 29,593   | **~1.2 GB**                |
| CAWM | 29,593   | **~3.2 GB**                |

At the existing 1.2 s pause that is roughly 10 hours per tileset — the same order as the
image mirror the project already accepted. Adding z11 would cost a further ~88,800 tiles per
set (~3.5 GB DARE, ~9.7 GB CAWM) for a single zoom level nobody needs the base at, which is
why the raster source declares `maxzoom: 10` and lets MapLibre overzoom by a factor of two.

**Contact both maintainers before the bulk run**, for the same reason and in the same terms
as René Voorburg: johan.ahlfeldt@lir.gu.se for DARE, the CAWM contact on the Iowa page. Ask
Åhlfeldt about the NC-credited inputs in the same message — he is the only person who can
resolve it, and the answer belongs in the code comment either way. Prove the pipeline with
`MIRROR_LIMIT=5 pnpm import:basemap dare` first.

### 8. Self-hosted glyphs — the last third-party request in an antiquity view

`glyphs` currently points at `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`,
and the overlay's label layers cannot render without it. Mirroring the tiles but leaving the
fonts on a third-party server would mean an antiquity view is first-party in every respect
except the one the design brief is loudest about — `@fontsource` is used precisely so no
webfont is fetched at runtime, and a font server in Zürich is the same objection as Google's.

**Generate once, commit, serve same-origin.** Not a build-time fetch: a `postinstall` that
downloads a TTF would put a network dependency into `pnpm install`, which is the opposite of
the goal.

- `scripts/build-glyphs.ts`, wired as `"glyphs:build"`. Takes a TTF path, shells out to
  **`font-maker`** (maplibre/font-maker, the maintained successor to fontnik's
  `build-glyphs`; add as a dev dependency) and writes `public/fonts/{fontstack}/{range}.pbf`.
  Run by hand when the font changes, which is approximately never — the script exists so the
  regeneration is reproducible, not because it runs often.
- **Font: Noto Sans Regular**, the same face the style already names, so the swap is
  invisible and this change stays about hosting rather than about type. Source the TTF from
  notofonts.github.io (OFL 1.1). Once the pipeline exists, moving map labels to IBM Plex
  Sans — which is what the notebook brief would actually argue for — is a one-line change to
  the fontstack plus a rerun; that is a design decision, not part of this.
- **Ship six ranges, not all 256.** MapLibre requests only the ranges it needs, and the
  atlas's labels are European: `0-255` (latin), `256-511` and `512-767` (latin-ext),
  `768-1023` (combining marks and Greek — DARE and the imported records both carry Greek
  toponyms), `1024-1279` (Cyrillic), `8192-8447` (general punctuation, which is where the
  en-dashes and curly quotes live). Roughly 300 KB committed. A range that is genuinely
  missing 404s and MapLibre drops those glyphs rather than failing — so if a script we do
  not ship starts appearing in titles, the symptom is missing characters, and the fix is one
  more range from the same script.
- Style: `glyphs: '/fonts/{fontstack}/{range}.pbf'` — same-origin, so it is already covered
  by `default-src 'self'` and needs **no** CSP entry. Overridable via
  `NUXT_PUBLIC_BASEMAP_GLYPHS_URL` for a future CDN offload, defaulting to the local path.
- While there: `'Noto Sans Regular'` is written out at three call sites
  (`useBasemapStyle.ts:158`, `useViewportTiles.ts:139` and `:193`). Export one
  `MAP_LABEL_FONT` constant from `useBasemapStyle.ts` and use it in all three, so the
  fontstack in the style and the directory name under `public/fonts/` cannot drift apart —
  a mismatch there renders every label blank with no error worth reading.
- The licence file ships beside the fonts (`public/fonts/OFL.txt`), as OFL 1.1 requires for
  redistribution.

`tiles.openfreemap.org` stays in `mapAssetOrigins` — the `modern`, `vestigia` and `terrain`
views still fetch vector tiles from it. Only the font request leaves.

### 9. Tests

**Unit — `app/composables/map/__test__/useBasemapStyle.test.ts`** (new file; the composable
has none today, and the directory is already collected by `vitest.config.ts`). Cover the
things that fail silently:

- an antiquity view yields a `raster` source and **no** vector `basemap` source;
- `glyphs` survives the antiquity branch (otherwise site labels vanish);
- the attribution string is non-empty and names the licence — this is a legal obligation, so
  it gets an assertion rather than a comment;
- `maxzoom` is 10, matching what the mirror actually holds;
- `sheetTone` is `'light'` for an antiquity view even when `isDark` is true;
- `glyphs` is the same-origin path and every label layer names `MAP_LABEL_FONT` — the
  fontstack/directory mismatch that renders labels blank is exactly the silent failure a
  test is for.

**End-to-end — `e2e/basemap.spec.ts`** (new; CLAUDE.md requires e2e for new critical
features, and there is no switcher test at all today). Against the production build, using
`waitForMapReady` and `watchForProblems` from `e2e/helpers/`:

1. open the switcher, choose _Antiquity (DARE)_, assert at least one raster tile request
   returned 200 and that `watchForProblems` saw no CSP violation — the CSP allowlist is
   exactly the kind of thing that only breaks in the built output;
2. assert the site overlay survives the style swap. `setStyle` wipes every custom source and
   only the `styledata` hook in `keepOverlayThroughStyleChanges` puts it back; this is the
   known trap in this area and the test that earns its place.

### 10. Documentation

- `CLAUDE.md`: a short **Antiquity basemaps** section under "How the map stays fast" —
  the two tilesets, both licences, the NC-inputs caveat, the z10 mirror ceiling and why,
  and the mirror command beside the other import steps. The stack table gains no row; this
  is not a new dependency.
- The mirror script's own docstring carries the bandwidth argument, as `03-mirror-images.ts`
  does. Per the project's working style, that explanation lives in the file and is not
  repeated anywhere else.

## Verification

```bash
pnpm check                                   # lint, typecheck, unit tests, formatting
pnpm glyphs:build ./NotoSans-Regular.ttf     # one-off; writes public/fonts/, then commit
MIRROR_LIMIT=5 pnpm import:basemap dare      # proves credentials, bucket, magic-byte check
pnpm dev                                     # switcher: five entries in two groups
pnpm build && pnpm test:e2e                  # production build — where CSP actually bites
```

By hand, on a 375px viewport and on desktop, in both themes:

1. Switch to _Antiquity (DARE)_ at z5 over the Rhine — the ancient coastline and the road
   network should replace the modern base, and the site markers must stay dark ink on
   parchment **in dark mode as well** (this is the `sheetTone` change; if the markers go
   pale, step 3 was missed).
2. Zoom past z10 and confirm the base overzooms softly rather than going blank.
3. Open MapLibre's compact attribution (i) and confirm both the antiquity attribution and
   the Vestigia site-data attribution are present, with working links.
4. Switch away and back — the site overlay must reappear each time.
5. In the network panel, confirm an antiquity view requests `/fonts/...` and nothing from
   `tiles.openfreemap.org`; confirm a Greek or accented site title still renders its
   characters rather than boxes.
6. Repeat 1–5 for _Antiquity (AWMC)_, expecting visibly thinner coverage north of the Alps;
   that is the tileset's own documented limitation, not a bug.

## What still leaves the origin after mirroring

Worth being exact, because "mirrored" is easy to over-read. Once the mirror is live and the
env points at the pull zone, an antiquity view makes **no** third-party request at all: the
raster tiles come from `*.b-cdn.net`, the site overlay from `/api/tiles/`, and the label
glyphs from `/fonts/` on the app's own origin. The upstream tile URLs survive only as the
unset-env fallback, and `tiles.openfreemap.org` is no longer touched in these views.

The `modern`, `vestigia` and `terrain` views still fetch vector tiles from OpenFreeMap and
hillshade from `elevation-tiles-prod`, as before and unchanged by this work — those are the
views whose whole content is a third-party basemap. Self-hosting them is the existing
PMTiles migration path in CLAUDE.md, not this plan.

## Open, deliberately

- The mirror is not run as part of this change. The code lands, the emails go out, and the
  bulk run happens once there is an answer. Until then the runtime config points upstream,
  which is fine for development traffic and is documented as not fine for production.
- Neither snapshot of the mirrored tiles leaves the machine, the same gap the database
  backups have.
