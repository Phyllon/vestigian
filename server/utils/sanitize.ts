import sanitizeHtml from 'sanitize-html'
import he from 'he'

/**
 * Default import, then destructure — not `import { decode } from 'he'`.
 * `he` is CommonJS and Nitro leaves it external rather than bundling it, so
 * this runs through Node's own ESM loader in `.output`, which is stricter
 * about named exports from a CJS module than `tsc`/vitest are: it refused to
 * start with "Named export 'decode' not found", even though the named form
 * type-checked, passed every unit test, and looked identical in `nuxt dev`.
 * Only the production build exercises this path — exactly the class of bug
 * `e2e/README.md` already warns about.
 */
const { decode } = he

/**
 * Strips markup from free text a contributor typed into a description field.
 *
 * This is a different concern from the disabled `xssValidator` (see the
 * docstring on `security.xssValidator` in `nuxt.config.ts`): that middleware
 * rejected a whole request the moment *any* byte would have been rewritten,
 * which meant "the wall is <2m tall" was refused identically to a `<script>`
 * tag. This function never rejects — it removes every tag and hands back
 * plain text, so "<2m tall" survives (there is no tag named `2m`, so
 * `sanitize-html`'s parser never treats it as one) while `<script>`,
 * `<img onerror=…>` and a pasted `<b>bold</b>` all come out as the text they
 * contained, with no markup left for a template to misinterpret. Safe to
 * apply unconditionally: nothing in this app renders a description through
 * `v-html`, so stored markup could only ever have been dead weight — this
 * just stops it from being stored at all.
 *
 * Two things `sanitize-html` does not do on its own, both needed because the
 * result is stored and later interpolated as plain text, not re-rendered as
 * HTML:
 *
 * 1. It HTML-encodes whatever text survives (`&` becomes `&amp;`), since its
 *    normal job is producing safe markup, not plain text — stored verbatim,
 *    Vue's own `{{ }}` escaping would then double-encode it, so a description
 *    would show "Tom &amp; Jerry" instead of "Tom & Jerry". `he.decode`
 *    reverses that.
 * 2. Block-level tags simply vanish, running adjacent paragraphs together
 *    ("<p>one</p><p>two</p>" → "onetwo"). Block boundaries and `<br>` are
 *    turned into newlines first so paragraph breaks survive the strip.
 */
const BLOCK_BREAK_TAGS = /<\/(p|div|li|h[1-6]|tr)\s*>|<br\s*\/?>/gi

export const stripHtml = (text: string): string => {
  const withBreaksPreserved = text.replace(BLOCK_BREAK_TAGS, '\n')
  const stripped = sanitizeHtml(withBreaksPreserved, { allowedTags: [], allowedAttributes: {} })
  return decode(stripped)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
