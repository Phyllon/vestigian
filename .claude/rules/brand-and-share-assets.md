---
paths:
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
accent; this is the mark's own colour. It always sits on a plate of its own — the favicon, the
share cards, the badge — so there is no dark-mode variant. If the mark is ever set straight onto
the night ground it wants a lighter wine, which is a design decision, not an inversion. There is
deliberately **no `--color-wine-*` theme token**: nothing in the interface uses it, and an unused
token reads as an invitation to.

### One definition, one command

`scripts/brand/vestigian-mark.ts` holds the geometry (`buildMarkPaths`, `buildMarkGroup`,
`buildMarkSvg`) and the three colours. Nothing else contains a path of the V. **`pnpm
brand:build`** runs, in order:

1. `scripts/generate-brand-assets.ts` — `public/brand/vestigian-mark.svg` (transparent),
   `public/favicon.svg` (on the paper plate), and the six `public/partner-assets/badge/*.svg`.
2. `icons:build` — rasterises the favicon into the three PWA icons (the maskable one at 80%
   on a full-bleed square, per the W3C safe zone).
3. `og:build` — the eleven share cards in `public/og/`.

Run it after any change to the mark, the paper colour, or the wordmark. The outputs are
committed, like the glyph PBFs.

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

- **The mark is not in the page header.** The header still reads "Vestigian" in Fraunces; the
  mark was asked for on the badge and the share images only. Putting it beside the wordmark is
  one `<img>`, but it changes every page, so it is a decision.
- **No wordmark lockup.** Mark and name are set separately wherever they meet.
- **No monochrome or reversed variants.** Nothing needs one yet.
