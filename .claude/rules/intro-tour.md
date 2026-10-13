---
paths:
  - 'app/components/onboarding/**'
  - 'app/composables/onboarding/**'
  - 'app/pages/index.vue'
  - 'app/components/ui/AppMenu.vue'
  - 'e2e/intro-tour.spec.ts'
---

## First-visit introduction

A dimmed screen, one lit-up control, a card pointing at it with Next / Previous /
Skip. Opens on `/` for a browser that has not answered it; replayable from the
menu ("Show the introduction"). Seen working on the production build at 1280px and
375px, light and dark (2026-10-08).

**"New user" is a browser, never a person.** `useIntroTour.ts` documents the
reasoning; the short form: the only thing stored is `localStorage`
`vestigian-intro-tour = 'done'`, written when the visitor presses Skip, Done or
Escape — their own explicit act, nothing identifying, never a cookie, never sent
to us, not tied to the account. Same class as `vestigian-language-notice-dismissed`,
so no consent banner (§25(2) no. 2 TDDDG; see `gdpr-legal.md`). Disclosed in
`privacy.cookiesBody` in all six locales and in the storage table in
`gdpr-legal.md` — **if the key changes, change both.** Blocked storage degrades
to once per page load. A shared link to a record (panel open) never triggers it.

**Mechanics, each of which was a real bug or a deliberate choice:**

- **The spotlight is a transparent box with a 9999px box-shadow**; the shadow is the
  dark sheet, the box the hole. The same box is the `UPopover` anchor, so Reka UI's
  floating-ui does placement, flipping and the arrow. No new dependency. A tour
  library (driver.js etc.) was not adopted: it ships its own DOM and CSS outside
  the Tailwind tokens and Nuxt UI, against the no-`<style>` rule.
- **Targets are `data-tour="…"` attributes** on the controls in `pages/index.vue` and
  `AppMenu.vue`. A step whose target is not on screen ("Add to the atlas" while
  signed out) is dropped, not shown pointing at
  nothing (`resolveIntroSteps`). Adding a control to the tour = a `data-tour`
  attribute, an entry in `INTRO_STEPS`, and `introTour.steps.<id>.*` in six locales.
- **Opening the tour closes everything that can sit over a target**, so no step
  points at a hidden control, on a phone included. `pages/index.vue` has a pre-flush
  watcher on `isOpen` that clears the record, tracing and overlap picker
  (`clearSelection`), closes the contribution form and **switches the frontier
  (limes) overlay off** — on a phone its sheet covers the legend, the control
  column and the credits. `Legend.vue` shuts its own key panel on the same signal.
  `IntroTour.vue` collapses MapLibre's credits (on a phone it starts expanded; the
  class removed is the one its own drag-to-minimise removes). **Given up, and not
  restored when the tour ends:** a contribution draft in progress, and the frontier
  overlay the reader had chosen. The container's `transition-[padding]` eases back
  after a panel goes, so `IntroTour.vue` re-measures on `transitionend`.
- **Two targets belong to code this feature does not own.** The compass is a
  `data-tour="compass"` on `CompassButton`'s button — present only on a touch device
  that reports orientation, so the step is dropped elsewhere like any absent control.
  The credits are MapLibre's `.maplibregl-ctrl-attrib`, tagged
  `data-tour="attribution"` from `IntroTour.vue`'s `onMounted` (before the steps are
  resolved), since the control is created by the library, not by a template.
- **`#__nuxt` is made `inert` while open**, which is why the component teleports to
  `body`. Pointer, keyboard and screen reader are all contained with one attribute.
- **Reka overrides `aria-labelledby` on its popover content** (pointing at a trigger
  that does not exist here, rendering `""`), so the dialog is named with `aria-label`.
- **Focus is found by `[data-intro-primary]`, not through a component ref.** A
  `UButton` ref's `$el` is not reliably the `<button>`; `.focus` on it threw
  (`$el.focus is not a function`) on every step — caught only by running it.
- Phones: a step meant to open beside a control (`side: 'left'`, the right-hand
  column) opens above it below 640px (`resolveIntroSide`).
- E2E: every Playwright context starts already answered (`answerIntroTour` in
  `e2e/helpers/fixtures.ts`, also `openSessionAs`); a new first-visit-style spec
  opts out with `test.use({ isFirstVisit: true })`.

**Observed and not caused by this feature:** `nuxt dev` answers 500 here because a
`*.test.ts` under `server/api` is bundled by Nitro and calls vitest's `beforeAll`.
