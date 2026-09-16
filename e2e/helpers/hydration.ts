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
 * the locale fetch included — has run. The app is reached through `#__nuxt`
 * (Nuxt's default `app.rootId`, not overridden here — see `nuxt.config.ts`),
 * whose `__vue_app__.$nuxt` Nuxt defines unconditionally.
 *
 * This used to select `[data-v-app]`, on the assumption that Vue always
 * stamps that attribute on the mounted root. Confirmed false in the built
 * output: Vue's `data-v-app`/`v-cloak` handling lives only in `createApp`'s
 * wrapped `mount`, and Nuxt hydrates through `createSSRApp`'s own wrapped
 * `mount`, which calls straight into the core mount and skips that attribute
 * entirely — checked by grepping the built client chunk for `data-v-app` and
 * finding it inside exactly one wrapper, not the one Nuxt calls. Every test
 * using the old selector timed out the full 10s on every run, silently, since
 * `waitForFunction`'s callback returning `undefined` forever looks identical
 * to one that is still waiting. `#__nuxt` is server-rendered and present
 * before any client JS runs, so it needs no such wrapper.
 *
 * This replaced `waitUntil: 'networkidle'`, which was right only because
 * neither auth page opens a persistent connection. The day one did — a
 * websocket, polling, an `EventSource` — that wait would time out, and it
 * never said which request it was waiting on.
 */
export const gotoAndHydrate = async (page: Page, path: string): Promise<void> => {
  await page.goto(path)
  await page.waitForFunction(() => {
    const container = document.getElementById('__nuxt') as
      (Element & { __vue_app__?: { $nuxt?: { isHydrating?: boolean } } }) | null
    return container?.__vue_app__?.$nuxt?.isHydrating === false
  })
}
