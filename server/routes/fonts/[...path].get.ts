/**
 * Catches requests for glyph ranges this atlas never rendered — see the
 * `RANGES` comment in `scripts/build-glyphs.ts` for which ones and why (Latin,
 * Greek, Cyrillic and their extensions only; Arabic and everything else is
 * deliberately absent rather than shipped empty). MapLibre asks for a range
 * the moment a label needs a codepoint in it, gets this 404, and falls back to
 * rendering that codepoint locally — that fallback is the intended behaviour,
 * not a bug.
 *
 * Without this route the request still 404s, but only after falling all the
 * way through to Nuxt's page renderer, which tries to match `/fonts/...` as a
 * page route, fails, and logs a `[Vue Router warn]` for every missing range on
 * every affected tile. Existing ranges never reach this handler at all —
 * Nitro's static-asset serving answers those first and this route only sees
 * what that already couldn't find.
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message: 'No SDF glyphs are shipped for this range.',
  })
})
