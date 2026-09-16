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
 * The wait is on Nuxt's own signal rather than a proxy for it:
 * `nuxtApp.isHydrating` turns `false` when the last deferred hydration resolves
 * (`deferHydration`, `nuxt/dist/app/nuxt.js`), which is after every plugin —
 * the locale fetch included — has run. The app is reached through the element
 * Vue marks `data-v-app` on mount, whose `__vue_app__.$nuxt` Nuxt defines
 * unconditionally; both were checked in the installed production builds (Vue
 * 3.5, Nuxt 4.5), not only in development.
 *
 * This replaced `waitUntil: 'networkidle'`, which was right only because
 * neither auth page opens a persistent connection. The day one did — a
 * websocket, polling, an `EventSource` — that wait would time out, and it
 * never said which request it was waiting on.
 */
export const gotoAndHydrate = async (page: Page, path: string): Promise<void> => {
  await page.goto(path)
  await page.waitForFunction(() => {
    const container = document.querySelector('[data-v-app]') as
      (Element & { __vue_app__?: { $nuxt?: { isHydrating?: boolean } } }) | null
    return container?.__vue_app__?.$nuxt?.isHydrating === false
  })
}
