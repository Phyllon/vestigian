/**
 * What the server-rendering build sees when something imports `maplibre-gl`
 * (aliased by the `vite:extendConfig` hook in `nuxt.config.ts`).
 *
 * The map exists only in the browser, but several composables import
 * MapLibre's values at module scope — `Map`, `Popup`, `LngLat`, `addProtocol` —
 * and the SSR bundle follows every import of a component it renders. Left
 * alone, the server loaded ~1 MB of WebGL library on every start and shipped
 * it in `.output` to render none of it. Nothing here is ever called during
 * SSR (each use is inside `onMounted` or an event handler); if something is,
 * it fails by name rather than as a mystery `undefined`.
 *
 * Every runtime export the app imports must be listed. A missing one is a
 * build error ("is not exported by"), not a silent gap — so adding a new
 * `import { Something } from 'maplibre-gl'` tells you to come here.
 */
const browserOnly = (name: string): never => {
  throw new Error(
    `maplibre-gl's ${name} was called on the server; the map exists only in the browser.`,
  )
}

/** A constructor that exists to be imported, and refuses to be called. */
const browserOnlyClass = (name: string): ObjectConstructor =>
  new Proxy(Object, { construct: () => browserOnly(name) })

const BrowserOnlyMap = browserOnlyClass('Map')
export const Popup = browserOnlyClass('Popup')
export const LngLat = browserOnlyClass('LngLat')
export const addProtocol = (): never => browserOnly('addProtocol')
export const setWorkerUrl = (): never => browserOnly('setWorkerUrl')

// Named apart from the declaration: `Map` would shadow the global one in this file.
export { BrowserOnlyMap as Map }
