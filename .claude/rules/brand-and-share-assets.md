---
paths:
  - 'shared/utils/brand-mark.ts'
  - 'app/components/ui/AppWordmark.vue'
  - 'scripts/brand/**'
  - 'scripts/generate-brand-assets.ts'
  - 'scripts/generate-og-placeholders.ts'
  - 'scripts/generate-app-icons.ts'
  - 'public/brand/**'
  - 'public/favicon.svg'
  - 'public/og/**'
  - 'public/icons/**'
  - 'public/partner-assets/badge/**'
---

## The Vestigian mark, and everything that carries it

A capital V whose **right arm is solid and whose left arm dissolves, slice by slice, towards
the top** — "vestigia" read literally: what is still there, and what the atlas is left to
infer. It is the same idea the map already draws as a dashed line wherever a course is
approximate. The slices are cut **horizontally**, to agree with the flat top and foot of the
Roman capital, and they narrow as they rise, so it is the letter that reads at 16 px and not a
stripe. Rejected on the way: a V with a white dashed centre line (a motorway lane marking — the
opposite of ancient) and a V whose dashes were cut square to the arm (an awkward vertex).

**Wine red `#7a1f2f`, not the interface's oxide `#9a3b22`.** The interface keeps its one
accent; this is the mark's own colour. On its plates — the favicon, the share cards, the badge — it
is always on paper. **In the header it sits on the page's own ground, so it has two colours:**
`WINE_RED` (9.5:1 on the light header) and `WINE_RED_ON_NIGHT` `#d4707f` (5.1:1 on `night-800`,
where the deep wine is 1.6:1). That is a decision, not an inversion, and it is made in the
component, not in a theme token: there is deliberately **no `--color-wine-*` token**, because
nothing but the wordmark uses the colour and an unused token reads as an invitation to.

### One definition, one command

**`shared/utils/brand-mark.ts`** holds the geometry (`buildMarkPaths`, `MARK_VIEWBOX`,
`MARK_LETTER_VIEWBOX`) and the two wines; it is in `shared/` because the app reads it as well as
the build scripts. `scripts/brand/vestigian-mark.ts` re-exports it and adds what only a plate
needs (`PAPER`, `INK`, `buildMarkGroup`, `buildMarkSvg`). Nothing else contains a path of the V.
**`pnpm brand:build`** runs, in order:

1. `scripts/generate-brand-assets.ts` — `public/brand/vestigian-mark.svg` (transparent),
   `public/favicon.svg` (on the paper plate), and the six `public/partner-assets/badge/*.svg`.
2. `icons:build` — rasterises the favicon into the three PWA icons (the maskable one at 80%
   on a full-bleed square, per the W3C safe zone).
3. `og:build` — the eleven share cards in `public/og/`.

Run it after any change to the mark, the paper colour, or the wordmark. The outputs are
committed, like the glyph PBFs.

### The header wordmark (`UiAppWordmark`)

The V of "Vestigian" **is** the mark, beside the burger menu on both layouts (`default.vue`,
`reading.vue`): `<UiAppWordmark />` inside the existing link, the letters after it set in
Fraunces by the caller. It is inline SVG from the same paths (no `v-html`, no image request), sized
in `em` — **0.7em tall, the cap height as Fraunces is set here, standing on the baseline** — so it
follows the font size of each layout (20 px and 18 px). `MARK_LETTER_VIEWBOX` crops the square's
empty margins so the next letter is not pushed away. **The name is said once, in words:** the
visible letters are `aria-hidden` and a `sr-only` span carries "Vestigian", so the link's name is
the whole word and `getByRole('link', { name: 'Vestigian' })` still matches. Checked by
screenshot at 1280 and 375 px, light and night. The mark is **not** drawn at the language-notice
or any other place the word appears in running text: there it is a word.

### The share cards (`public/og/*.png`, 1200×630)

The mark stands large on the right, where a feed thumbnail still reads it; the label and the
wordmark sit on the left. The default card says what the atlas is (the manifest's tagline); the
category cards say the category and, beneath it, `VESTIGIAN`. **Georgia, not Fraunces**: sharp's
SVG renderer has no web font, and a card carries no per-entity text to get wrong. After
deploying new cards, purge `/og/*` at Bunny (it ignores query strings, so `?v=` cannot bust it),
and expect WhatsApp and Facebook to keep their own copy per URL until re-scraped.

### The badge ("Seen on Vestigian")

A 220×40 plate of its own — paper, a hairline of ink, the mark, the line in a serif fallback
stack (a standalone SVG on someone else's page has no web font), and a short wine rule at the
right edge. One file per interface language; the text is `BADGE_TEXT` in the generator and
**must match `partnersPage.badgeAlt`** in the same locale. It is downloaded and hosted by the
partner, never hot-linked (`.claude/rules/partners.md`).

### Not done, deliberately

- **No wordmark lockup as an asset.** The header sets the name itself (below); there is no
  exported SVG of mark plus name, and the badge and cards still use Georgia.
- **No monochrome or reversed variants.** Nothing needs one yet.
