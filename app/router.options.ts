import type { RouterConfig } from 'nuxt/schema'

const elementHash = /^#[A-Za-z][\w-]*$/

/**
 * The reading layout's header is sticky and 3.5rem (56px) tall (`reading.vue`),
 * so an anchored heading scrolled to the very top would sit underneath it. 64px
 * leaves the heading clear with a little air. The map layout never scrolls and
 * is unaffected.
 */
const STICKY_HEADER_OFFSET_PIXELS = 64

/**
 * The camera lives in the hash — `#map=12.10/47.56319/10.73665` — so a view is
 * shareable without the coordinates ever reaching the server or the tile cache
 * key. Nuxt's default scroll behaviour assumes a hash names an element and
 * hands it to `document.querySelector`, where that string is not a valid
 * selector. Every load of the map with a camera in the URL logs
 * "[Vue Router warn]: The selector ... is invalid".
 *
 * A hash is therefore treated as an element id only when it is a plain
 * identifier (`#credit` on `/licence`); the camera hash contains `=` and `/`,
 * never matches, and is ignored rather than escaped into a selector that
 * would never match anything.
 *
 * The signature is vue-router's, which is why it takes three positional
 * parameters rather than a named options object.
 */
export default <RouterConfig>{
  scrollBehavior: (to, from, savedPosition) => {
    if (savedPosition) return savedPosition

    if (elementHash.test(to.hash)) return { el: to.hash, top: STICKY_HEADER_OFFSET_PIXELS }

    // Panning rewrites the hash many times a minute. The reader has not
    // changed page and must not be thrown back to the top of one.
    if (to.path === from.path) return false

    return { left: 0, top: 0 }
  },
}
