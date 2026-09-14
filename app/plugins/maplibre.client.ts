import { setWorkerUrl } from 'maplibre-gl'
// `?worker&url` rather than plain `?url`, and that distinction is load-bearing:
// the dist worker imports its sibling `maplibre-gl-shared.mjs`, and `?url`
// emits the worker file verbatim in a production build *without* that sibling,
// so the worker dies on its first import and no vector tile ever loads. Dev
// mode works either way, which is exactly how this would have shipped broken.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

/**
 * Points MapLibre at its own worker bundle, once, before any map exists.
 *
 * v6 is ESM-only and resolves its worker from `import.meta.url`, which does not
 * survive a bundler's module graph — so for Vite, webpack and friends the
 * upstream guidance is that every consumer must make this one call or the map
 * silently renders nothing. v5 needed no such call, which is why this file has
 * no pre-v6 equivalent to have grown out of.
 *
 * A client plugin rather than module scope in `useMapInstance`/`useBasemapStyle`
 * for two reasons at once: `?worker&url` is a Vite transform that would fail
 * under vitest's plain-node environment, where both of those modules are
 * imported directly by their unit tests, and the call has no meaning during
 * SSR, where there is no worker to point anywhere.
 */
export default defineNuxtPlugin(() => {
  setWorkerUrl(workerUrl)
})
