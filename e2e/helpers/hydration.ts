import type { Page } from '@playwright/test'

/**
 * Navigates to a page and waits until it is genuinely interactive, not merely
 * loaded — the fix for a hydration race that made `auth.spec.ts` flaky: two
 * different tests, on different runs, timed out clicking a submit button that
 * stayed `disabled` forever despite every field having been filled correctly
 * moments before.
 *
 * The mechanism: Playwright's default `goto()` resolves on the `load` event,
 * which a deferred module script satisfies once it has started executing —
 * not once Vue has mounted and attached its `v-model` listeners.
 * `@nuxtjs/i18n` fetches its locale file as a separate request, awaited inside
 * a Nuxt plugin before the app finishes mounting, so on a slow or cold run
 * there is a real window after `goto()` returns where the DOM is
 * server-rendered but nothing is listening yet. `fill()` writes the input's
 * DOM value directly and dispatches one native `input` event; if that fires
 * before hydration attaches, the event is lost forever — the field visibly
 * shows the typed text, but the component's own `state` never sees it, so a
 * submit button gated on `:disabled="!isComplete"` never becomes enabled and
 * the click that follows can only time out.
 *
 * `networkidle` is the fix precisely because it is a real, observable signal
 * rather than a guessed duration: the login and register pages open no
 * persistent connection (no websocket, no polling, no `EventSource`; the map
 * is the only part of this app that keeps traffic flowing, and it is not on
 * either page), so "no network activity for 500ms" reliably means the locale
 * fetch — and anything else hydration was waiting on — has resolved.
 */
export const gotoAndHydrate = async (page: Page, path: string): Promise<void> => {
  await page.goto(path, { waitUntil: 'networkidle' })
}
