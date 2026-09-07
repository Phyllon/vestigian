---
paths:
  - 'app/pages/tabula-peutingeriana.vue'
  - 'app/components/tabula-peutingeriana/**'
  - 'scripts/import/10-tabula-peutingeriana.ts'
  - 'server/api/tabula-peutingeriana/**'
---

## The Tabula Peutingeriana — a viewer, not a sixth basemap

`/tabula-peutingeriana` is a standalone IIIF deep-zoom page (OpenSeadragon,
New BSD), reached from a link inside the basemap switcher's antiquity group —
deliberately not a fifth `BasemapView`. The manuscript is a schematic route
diagram, 113,664×6,144px at roughly 18.5:1, not a georeferenced map: draping
it as a MapLibre raster source the way DARE or the satellite view are would
misplace every road relative to the real coordinates it would sit beside. It
gets its own page and its own viewer instead, never a layer under site
markers.

The tile source is `iiif.omnesviae.org`, an IIIF Image API v3 service run by
René Voorburg — the same person this project already has a courtesy-contact
relationship with for image mirroring (see "Contact René Voorburg before
mirroring images at scale" in the import-pipeline section). His project moved
from GitHub to Codeberg "as a commitment to European software independence
and digital sovereignty," in his own words — Netherlands-based, matching this
project's EU-hosting preference the way EOX (Vienna) and Voorburg's own image
mirror already do. The scanned manuscript (Austrian National Library, Vienna,
Cod. 324, a ~12th–13th c. copy) is old enough to be unambiguously public
domain, and EU law additionally bars new rights on a faithful digitisation of
a public-domain work (Art. 14 DSM Directive, transposed in Austria) — but
neither the IIIF service nor its `info.json` states a licence explicitly, so
this is a courtesy-contact case like DARE and the site photographs, not a
confirmed-licence case like the satellite view: email Voorburg before
pointing real production traffic at it. Unlike DARE or the satellite pyramid,
this is one manuscript scan, not a continent's worth of tiles, so there is no
mirror-URL fallback pattern here — nothing at that scale to justify
pre-building one.

Two bugs found only by opening the page in a real browser and watching the
network tab — both were completely silent otherwise (no thrown error, no
failed request, `pnpm check` green throughout):

1. **A `useTemplateRef` binding and a same-named local variable collided.**
   `const viewerElement = useTemplateRef('viewer')` paired with a template
   `ref="viewer"` looks like it should work, but Vue's SFC compiler wires a
   template's `ref="X"` string to whichever **script-setup binding is
   literally named `X`** — not to whatever a `useTemplateRef` call happens to
   be assigned to. A second, unrelated `let viewer: Viewer | null = null` for
   the OpenSeadragon instance was the binding that actually matched, so the
   template's `ref` never touched the real DOM ref at all — confirmed by
   reading the compiled render function directly, where `ref="viewer"`
   compiled to the OpenSeadragon-instance variable, not the element ref.
   `viewerElement.value` was permanently `null`, `onMounted` returned early
   every time, and the container simply never grew any children. The fix
   is naming convention, not a workaround: the `useTemplateRef` variable is
   named `viewer` to match the template exactly (as `useTemplateRef('root')`
   assigned to `const root` already does in `BasemapSwitcher.vue`), and the
   OpenSeadragon instance is `osdViewer` instead.
2. **OpenSeadragon's control-button icons need to be self-hosted like
   everything else in this app.** Left at its default `prefixUrl`, the
   library requests `/images/zoomin_rest.png` and its 39 siblings against
   this app's own origin — a path this app has never served, so every
   navigation button rendered with no icon and the console logged 40 404s. A
   dynamic `import('openseadragon')` was tried first and ruled out for an
   unrelated reason (below); switching to a static import did not fix this
   one. The 40 PNGs are vendored from the installed package (same New BSD
   licence as the library) into `public/openseadragon/images/`, and
   `prefixUrl: '/openseadragon/images/'` points at them — the same
   self-hosting stance as `@fontsource` and the SDF label glyphs, applied to
   a UI-chrome asset this time rather than a font.

A third thing, found while diagnosing the first bug and worth keeping
separate because it is a Rollup/Vite defect, not an app bug: **a dynamic
`import('openseadragon')` inside `onMounted` silently resolved to
`undefined`.** OpenSeadragon's default export is itself a callable function
carrying static properties (`OpenSeadragon.Viewer`, …), not a plain object —
and Rollup's generated interop glue for a code-split dynamic import of a CJS
default export took `.default` a second time on that already-resolved
function, which has no `.default` property of its own. No error was thrown;
`OpenSeadragon` was just quietly `undefined` where the compiled code expected
a function. Confirmed by reading the compiled chunk directly, not by
elimination: `maplibre-gl` is already imported statically elsewhere in this
codebase (`useMapInstance.ts`) for what turns out to be the same reason —
switching to a static top-level `import OpenSeadragon from 'openseadragon'`
avoided the interop path entirely, and Rollup still code-splits the page's
own chunk normally. **Prefer a static import for a page-scoped third-party
default export in this codebase**; reach for a dynamic one only with a reason
to, and verify it actually ran rather than trusting a clean console.

**A fourth and fifth bug, found later, when the Column of Marcus Aurelius
viewer (below) reused this component's pattern and a full page reload
surfaced what client-side navigation never had:**

4. **A hard reload of `/tabula-peutingeriana` crashed with 500 — "document is
   not defined."** OpenSeadragon touches `document` at module import time,
   not only inside `onMounted`, and Nitro's SSR pass requires every module a
   page's template references before it renders anything — the static-import
   discussion above never came into play, because the crash happened before
   the component was ever instantiated. Client-side navigation from the map
   never hit this, since the module was already loaded in the browser by
   then, which is exactly why it went unnoticed until something actually
   requested this URL fresh. `definePageMeta({ ssr: false })` does **not**
   fix this on its own — that flag skips _rendering_ the page server-side,
   but Nitro's server bundle still resolves every component the template
   references regardless, which still executes the top-level `import`. The
   real fix is Nuxt's `.client.vue` filename suffix, which excludes a
   component's actual module from the server bundle entirely (Nuxt swaps in
   a stub) — so the OpenSeadragon logic was extracted out of the page and
   into `TabulaPeutingerianaViewer.client.vue`, and the page itself renders
   normally server-side (its heading, intro text, SEO meta) with only the
   viewer excluded.
5. **Even inside a `.client.vue` component, `viewer.value` was reliably
   `null` on the very first `onMounted` run.** A `.client.vue` component
   resolves as an async component (that's what lets Nuxt exclude it from the
   server bundle), and an async-resolved component's `onMounted` can fire
   before its own template ref has actually been attached to the committed
   DOM — unlike a normally-resolved component, where Vue guarantees a ref is
   set before `onMounted` runs. Confirmed by logging `viewer.value` directly
   in a real browser (`null`), not assumed from the symptom alone, which
   looked identical to bug 1 above (silent, no thrown error, container never
   grew children) but had a different cause and needed a different fix:
   `await nextTick()` as the first line of `onMounted`, after which
   `viewer.value` is reliably the real element. One tick is enough; nothing
   here needs a longer wait.

## The Tabula Peutingeriana network — an overlay, off by default

A second, unrelated use of the same manuscript: not the viewer above, but the
network it records — towns and the roads between them — reconstructed to real
coordinates and drawn as a toggleable overlay over _any_ basemap (`Overlays`
group in the switcher, below the antiquity group). Where the viewer shows the
schematic drawing, this shows what it depicts, at the coordinates it actually
depicts.

**The source is the same OmnesViae project, a different asset entirely**:
`omnesviae.org/data/omnesviae.json`, a 1.4 MB JSON-LD document undocumented
anywhere on the site itself — found only by fetching it directly and
inspecting the real structure, since the marketing page describes it as
nothing more than "a high resolution copy of the tabula peutingerina" and an
AI-summarized fetch of the file itself first reported, wrongly, that it held
no route data at all. The real shape: 3,323 `Place` entries (a classical
`label`, an optional `modern` name, and for 2,574 of them real `lat`/`lng` —
Richard Talbert's scholarly georeferencing, not this project's own inference)
and 3,523 `TravelAction` entries (a `from`/`to` place pair, a distance in
Roman miles, and three flags worth keeping: `isReconstructed` for a gap
filled from the Itinerarium Antonini rather than read off the manuscript,
`overWater` for a sea crossing, `crossesRiver` carrying the river's own name
rather than a boolean). 749 places carry no coordinate — unidentified names,
or rivers with no point to plot — and are dropped on import, the same way
this project already drops Pleiades' unlocated rows on the Barrington import;
2,397 of the 3,523 legs survive with both endpoints located.

**This dataset states no licence anywhere** — not in the JSON-LD's own
`@context`, not on omnesviae.org, not confirmed on its Codeberg repository.
That is a materially different position from every other borrowed source in
this project (AWMC is ODbL, Pleiades is CC BY, DARE is CC BY-SA, EOX is CC
BY-NC-SA): linking out to Voorburg's own IIIF viewer needed no licence claim,
since nothing left his server through this app; _importing his compiled data
into this project's own tables_ is a bigger ask, and this project has been
consistent about not doing that on an unconfirmed licence. The resolution:
**import freely, serve nothing until told to.** `pnpm import:tabula-peutingeriana`
populates `tabula_peutingeriana_places`/`_roads` regardless — the import
touches nothing a visitor ever sees — but
`server/api/tabula-peutingeriana/network.geojson.get.ts` 404s and the
overlay switcher's toggle is hidden outright unless
`NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED=true` is set, which an operator
should do only after confirming reuse is fine with Voorburg — the same
courtesy this project already extends to Åhlfeldt (DARE) and EOX, applied
here to data rather than bandwidth.

Kept in its own tables, never joined to `sites` or `antiquity_places`, for a
stronger version of the reason the AWMC/Pleiades tables already are: an
unconfirmed licence is a harder line than a known share-alike one.

Three things not obvious from the schema:

1. **A straight line, not a traced road.** The source data is an endpoint
   pair and a distance, nothing else — `ST_MakeLine(fp.geom, tp.geom)` at
   import time is honest about that. Drawing anything more detailed would
   invent a road alignment the data does not contain, the same restraint
   that keeps the Tabula Peutingeriana viewer from being draped over the map
   as a georeferenced sheet in the first place.
2. **A plain `geojson` source, not a tile route**, and lazily loaded only on
   first activation — the same "small enough for one response" reasoning
   that keeps the field notebook off the MVT pipeline (see
   `server/api/me/map.geojson.get.ts`), except this response is identical
   for every visitor and safe to cache at the HTTP layer
   (`cache-control: public, max-age=86400`) rather than per-request. Not
   under `/api/data/` and not CORS-open, unlike `sites.geojson`: that path is
   this project's documented CC BY-SA/CC0 reuse feed, and putting an
   unlicensed dataset next to it would blur the exact distinction the gate
   above exists to protect.
3. **`postgres.js` needs `sql.array()` for a boolean array, not plain
   interpolation.** `${rows.map(r => r.flag)}::boolean[]` compiled and ran
   without a type error but silently collapsed to a scalar — confirmed by a
   standalone repro, not assumed: `SELECT ${[true,false]}::boolean[]`
   returns a _scalar_ `false`, and only `SELECT ${sql.array([true,false])}::boolean[]`
   returns the array `[true, false]`. Text, integer and double-precision
   arrays (used elsewhere in this same import, and in `09-cities.ts`) do not
   need this — it is specifically booleans. `10-tabula-peutingeriana.ts`
   wraps `isReconstructed`/`overWater`/`crossesMountains` in `sql.array()`
   for this reason.

A fourth, smaller thing found by actually running the import against the real
data rather than assuming it was clean: **6 of 3,523 `TravelAction` entries
share an `@id`** — two distance readings filed under the same generated
from/to id, since the id carries no reading-variant suffix. `source_id` is
this table's own unique key, so `parseRoads` deduplicates, keeping whichever
reading actually carries a distance.
