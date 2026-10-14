---
paths:
  - 'app/app.config.ts'
  - 'app/components/ui/**'
  - 'app/layouts/**'
---

## Header menus and the Nuxt UI defaults behind them

**A menu taller than the screen could not be scrolled** (reported on a phone: the
burger menu's last entries were out of reach). Measured at 375×500: the menu was
588px tall, its parent `overflow-hidden`, and `max-height: none`. Nuxt UI v3.3.7's
`dropdownMenu` theme does the right thing one level down — a `viewport` slot that is
`overflow-y-auto flex-1` — but puts no height on the `content` slot, so the viewport
never has less room than its list and there is nothing to scroll. Reka UI does
measure the room left and exposes it as `--reka-dropdown-menu-content-available-height`
(440px in that case); nothing in the theme reads it.

`app.config.ts` therefore sets `ui.dropdownMenu.slots.content` to
`max-h-(--reka-dropdown-menu-content-available-height)` **once, for every
`UDropdownMenu`** (`AppMenu`, `AccountMenu`, `LanguageSwitcher`, `settings.vue`) rather
than per call site — the account menu grows an admin section and would have hit the same
wall. Verified with touch emulation: a swipe inside the menu scrolls it to its last entry
and leaves it open; at 1280×800 the cap is above the menu's own height and nothing changes.

If a Nuxt UI upgrade ships its own cap, this override becomes redundant but harmless
(`tailwind-merge` keeps one `max-h`).

## The reading layout's header is sticky

`reading.vue`'s header is `sticky top-0 z-40` and a fixed `h-14` (56px), opaque
(`bg-paper-100`/`dark:bg-night-900`) because prose scrolls under it. The map layout needs
nothing: its shell is `fixed inset-0` and never scrolls, so its header cannot leave the screen.
The 56px is a number three places depend on — **change them together**:

- the sticky bars inside reading pages (`AdminCommandBar`, `ReviewQueue`) are `top-16`, not
  `top-2`, or they stick _behind_ the header;
- `router.options.ts` scrolls an anchored heading to `top: 64` (vue-router's `top` is an offset
  from the element), or `/licence#credit` lands under the header;
- `scroll-mt-20` on the two pages with anchors (`licence`, `partners`), for the browser's own
  fragment navigation on a direct load, which does not go through the router.

Not checked on a phone with the on-screen keyboard open (a sticky header and `visualViewport`
shifts are a known pairing on iOS).

## The Features page

`/features` (`app/pages/features.vue`), in the menu's first group and in `SITEMAP_STATIC_PATHS`.
Entries are data (`shared/utils/features.ts`: id, icon, an `example` that is either a `site` (slug,
title, zoom) or a `sector` (slug, title, zoom), the ordered `steps` the button performs); the words are `featuresPage.features.<id>.*` in six
locales. Each card says what the feature is, **lists what the button will switch on before it is
pressed**, and has one button (`useFeatureExample`):

1. fetch the example record by slug (`/api/sites/slug/:slug` — ids are reassigned by a re-import,
   slugs never change) — **before changing anything**, so a record missing from this atlas
   (answer 404) leaves the reader's map untouched and says so;
2. `setSitesActive(true)`, `selectSite(id)`, `requestFocus(...)` (see `useMapFocus` in
   `map-and-tiles.md`);
3. `navigateTo('/#map=zoom/lat/lon')` — a client-side navigation, never a plain link: the switches
   are `useState` and a hard navigation drops them (`map-and-tiles.md`, "Show on the map").

The first entry is **what a watchtower could see**: `turm-3-25`, an Upper German Limes tower the
e2e suite already reads. The calculated view needs no further switch — `TerrainTowerSightlines`
draws it on the map by default once its panel is open. The second entry is **what a frontier's towers did together**: `limes-raeticus`, a `sector` example.
Its button looks the sector up in `/api/limes/sectors` first (absent → `missing`, nothing changed),
then `setLimesActive(true)`, `selectSector`, `requestSectorWatchOpen(slug)` and a camera request at
the sector's bounds centre. `TerrainSectorWatch` is a closed `<details>` on the map, so the request
(`useSectorWatchOpenRequest`, answered once and by slug) opens it; inside it the map switch is the
first control, above the lead paragraph. **Adding a feature** is a registry entry,
six catalogue entries, and a line in `useFeatureExample` if showing it needs a switch the example
does not already flip. Verified: unit tests for the padding helper; the e2e spec
(`e2e/features.spec.ts`) is written, not run. Not verified on a phone: that the icon lands in the
visible strip above the 76% sheet at 375×667.
