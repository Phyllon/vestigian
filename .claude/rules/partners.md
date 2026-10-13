---
paths:
  - 'app/pages/partners.vue'
  - 'shared/utils/partners.ts'
  - 'public/partner-assets/**'
  - 'documents/source-permissions/**'
---

## The partners page

`/partners`, in the burger menu's first group beside "About Vestigian". It is the page the
permission emails (`documents/source-permissions/`) offer: a source that has agreed terms
with us and asked to be named is presented in its own words. It is **not** the licence page —
every source we use is credited there because its licence asks; a partner is one that has
said yes and chosen to be seen.

**What the page promises is what the emails promised**, so a change to one is a change to
the other: credit wherever the data is shown; the data kept apart from ours and out of the
open export **only if the partner opts in** (optional, never the default); nothing altered silently; withdrawal by one email; **alphabetical order, no
ranking, no paid placement**. `listPartners` sorts by name whatever order the data file is
in (`partners.test.ts` pins it) — a list that followed the file, or the date of agreement,
would be a ranking by accident.

### Adding a real partner

1. A written yes, and their wording, in `documents/source-permissions/replies/`.
2. An entry in `PARTNERS` (`shared/utils/partners.ts`): `id` (a slug — the anchor and the
   i18n key), `name` (never translated), `url`, `kind`, `citation` (verbatim),
   `recordCount` only when it is a number worth stating, `mark` if they supplied one.
3. `partnersPage.entries.<id>.about` (**their** words) and `.drawn` (what Vestigian draws
   from them) in **all six locales**, hand-written, the wording approved by the partner.
4. The mark under `public/partner-assets/`. **Self-hosted, never a link to their server** — the
   CSP allows nothing else, and a request to someone else's origin for a logo is a
   visitor-data question we do not need to open.

### The invented examples

`EXAMPLE_PARTNERS` — three organisations on `example.org` (a reserved domain), each flagged
`isExample`, so the page can be seen before a real partner exists. **They are shown under
`nuxt dev` and wherever `NUXT_PUBLIC_SHOW_EXAMPLE_PARTNERS=true`** (the end-to-end build
sets it), and **never on a built deployment by default**: a page of made-up partners on a
public site reads as a claim about real ones. Wherever they appear a notice says they are
invented, and each card carries an "Example" tag, so one card in a screenshot cannot pass
for an organisation that agreed to anything. No real organisation is imitated; do not name
one in an example.

With no real partner the page shows an empty state and the principles — which is the honest
state of a new project, and still the page a source is pointed to.

### How a mark is drawn

- **In ink, by default.** A recolourable mark is a CSS mask over the SVG's own shape on a
  `bg-ink-700` / `dark:bg-paper-200` box (`[mask-image:var(--partner-mark)]`), so it follows
  light and dark mode and no partner colour competes with the one accent the design allows.
  The file's colours are irrelevant; only its alpha is read.
- **As supplied** when `isRecolourable: false`, for a partner whose guidelines forbid
  recolouring (the third example shows it).
- **Decorative** (`alt=""`): the name is the heading beside it, so a description would be read
  twice.
- Mask images obey `img-src`; `'self'` is all they need.

### The badge

`public/partner-assets/badge/seen-on-vestigian.<locale>.svg`, one per interface language (a plain
plate, a serif fallback stack — no web font is available on someone else's page). The page
shows the reader's language, offers all six as downloads, and a `<pre>` of markup that is
`select-all`. **It is downloaded and hosted by the partner, never hot-linked**: a hot-linked
badge would make every visitor to their site send a request to ours. **So the snippet's `src` is
the bare file name** (`seen-on-vestigian.de.svg`), which resolves only once the partner has saved
the file beside their page — and so it opens with an HTML comment saying exactly that
(`partnersPage.badgeSnippetNote`, six locales), which travels with the paste. Pasted unchanged
onto vestigian.org itself it 404s, by design; reported once as "different from the badge's URL". Add a language, and
a file, together. The files are **generated** (`pnpm brand:build`,
`.claude/rules/brand-and-share-assets.md`) — never edited by hand — and their text must match
`partnersPage.badgeAlt` in the same locale.

**The assets live in `public/partner-assets/`, not `public/partners/`.** A directory under the
page's own URL makes the server answer `/partners` with a 301 to `/partners/` (seen under
`nuxt dev`), which would also leave the canonical URL with a trailing slash.

`/partners` is in `sitemap-static.xml` (`SITEMAP_STATIC_PATHS`), with the other reading pages.

### Not built, on purpose

- **A live record count.** `recordCount` is a number typed into the data file. When the first
  real layer exists it should be a query over that layer's table; until then a static figure
  that is wrong is worse than none, so leave it out rather than estimate.
- **The named layer ("Courtesy of …") and the cartouche** from the proposal. The page is
  built; those wait for the first partner who asks for them.
- **A per-partner deep link back to its layer on the map.** There is no layer to link to yet.
