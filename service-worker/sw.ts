/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { isTileRequestPath } from '../shared/utils/offline-cache'

/**
 * The offline field notebook's service worker.
 *
 * Two jobs, and nothing else:
 *
 * 1. Precache the built app shell (Workbox's job, via `injectManifest` — see
 *    the docstring on `pwa` in `nuxt.config.ts` for why `generateSW` was not
 *    enough), so the interface itself loads with no network.
 * 2. For the four tile-route families, answer from Cache Storage when a
 *    previously downloaded area already has the tile, otherwise let the
 *    request go to the network exactly as if this worker did not exist.
 *
 * Deliberately does **not** write anything into a cache itself. The one and
 * only writer of an offline area's cache is the page-side download flow in
 * `app/composables/map/useOfflineAreas.ts` — casual browsing never grows an
 * offline cache, so "I downloaded this area" stays a precise, bounded,
 * user-initiated fact rather than something that silently accretes.
 *
 * `caches.match()` here is the **global** `CacheStorage.match`, not a single
 * cache's `match` — called with no `cacheName` option, it searches every
 * cache this origin owns, including every area a reader has downloaded, in
 * one call. That is what makes this worker indifferent to how many areas
 * exist or what they are named: it never needs to enumerate `caches.keys()`.
 */
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string }> }

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

/**
 * Without this, a newly activated worker does not control any page that was
 * already open when it activated — standard Service Worker behaviour, not a
 * bug in the platform. That page's requests keep going straight to the
 * network until its next full navigation, so a reader who downloads an area
 * and loses signal in the *same* session, without reloading, would get no
 * offline serving at all — exactly the case this feature exists for. Calling
 * it unconditionally at startup is safe: it only takes effect once this
 * worker is actually active.
 */
clientsClaim()

/**
 * `registerType: 'autoUpdate'` relies on the client posting this message the
 * moment a new worker is installed and waiting — without listening for it, a
 * new version sits in `waiting` forever and nobody ever runs it. `@vite-pwa`'s
 * client plugin sends this automatically for `injectManifest`; a hand-authored
 * worker still has to act on it itself.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || !isTileRequestPath(url.pathname)) return

  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)))
})
