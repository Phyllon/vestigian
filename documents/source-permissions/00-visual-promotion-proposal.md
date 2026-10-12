# A visible place for a data source — proposal

Referred to by every request in this folder. It answers one question: what can
Vestigian offer a source beyond the credit it is owed anyway, so that saying yes is
worth something to them and not only to us?

**Status of this document:** a proposal, not a description. The baseline (§1) and the
partner page (§2 C, `/partners`, built 2026-10-11 and listed in the menu) exist. The rest of
§2 is built when the first source says yes to it, not before, and the emails word it as "we
would be glad to", never "we have". Until a real partner exists the page lists three
invented organisations under a notice, in development only — see `.claude/rules/partners.md`.

## 1. The baseline — every source, no approval needed, exists today

| Where                              | What a reader sees                                                | Built from                                               |
| ---------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Map credit line (the (i))          | The source's name, link and licence, **while its layer is shown** | `*_ATTRIBUTION` in `useBasemapStyle.ts`                  |
| The key                            | A named section for the layer, with its marks                     | `Legend.vue`                                             |
| Every info box ("About this spot") | "Source: name · licence", linked                                  | `REFERENCE_SOURCES`, `shared/utils/reference-sources.ts` |
| Data & licences page               | One entry per source, with the terms that apply                   | `/licence`, `licence.*` in the six locales               |

Two promises sit behind it, and the emails repeat both because they are what a
source is really asking for:

- **Their terms stay their terms.** A third-party layer lives in its own table and
  tile endpoint, never in `sites`, and never in our open data export unless the
  licence allows it (the isolation the ODbL and NC layers already get).
- **Nothing is altered silently.** A likely error goes back to the source.

## 2. Options for a partner — each one opt-in

A source that wants more picks from this list; none is required, and the
baseline stands either way.

### A. "Courtesy of …" — a named layer · _small_

The layer's switch and its section in the key carry the partner's name and, if they
want, their mark:

```
Overlays
  [x] Shipwrecks            Oxford Roman Economy Project
  [ ] Quarries and mines    Oxford Roman Economy Project
```

Where: `OverlaySwitcher.vue` (a second line under the label) and the layer's key
section header in `Legend.vue`. One optional `mark` field per entry in
`REFERENCE_SOURCES`.

### B. The cartouche — a plate on the map · _medium_

Old maps credit their surveyors in a framed plate in one corner, and the notebook
is the app's own metaphor, so this is the form we propose. The first time a reader
switches a partner's layer on in a visit, a small plate rests in the corner of the
map for a few seconds, then folds into a tab labelled "Data: OxREP" that opens it
again:

```
  ┌───────────────────────────────────┐
  │  [mark]  Shipwrecks               │
  │  Drawn from the database of the   │
  │  Oxford Roman Economy Project,    │
  │  Faculty of Classics, Oxford.     │
  │  Visit the database ↗      [Hide] │
  └───────────────────────────────────┘
```

- **One sentence, in the partner's own words**, written by them and translated by us
  into the six interface languages (they approve the wording).
- **Once per visit, no storage.** It is a session fact, not a preference; nothing is
  written to the device, so no new line in the privacy notice.
- Keyboard and screen reader: a labelled `region`, dismissible with Escape, never
  focus-stealing; hidden when a record panel is open (same rule as the featured list).
- Cost: one component, one per-source record (name, sentence per locale, mark, URL).

### C. A partner page · _medium_ · **built**

A page of its own (or a headed section on `/licence`) presents each partner in a short
paragraph of their own words, with their mark, what we draw from them (with a live
count), the citation form they asked for, and a link. It also carries a small "Seen on
Vestigian" badge they may put on their site, with a link back — which is the
back-link the emails ask for, made easy.

### D. A link to the record itself · _small per source_

Where the source has a stable page per record (EDH, PAS, AFE), the info box carries
"Open this record on …" as a button, not only a line of small print.

### E. A line in our release notes · _free_

"New layer: shipwrecks, with the kind permission of the Oxford Roman Economy
Project" — in the changeset, therefore in the changelog, therefore on GitHub.

### F. Their mark, where we put the source — and only there · _rule, not a feature_

Partner marks appear only in A–D. They are never used as decoration, in
social images, or elsewhere without a further yes.

## 3. How a mark is shown, so it fits the notebook

- **In ink.** A monochrome version of the mark on the paper ground (`ink-700`,
  `paper-200` in dark mode), so no partner colour competes with the one oxide-red
  accent the design allows per screen. If a partner's guidelines forbid a recoloured
  mark, we use the supplied one, unrecoloured, and say so on the page.
- **Self-hosted.** The file is supplied by the partner and served from our own
  origin, never hot-linked: the CSP allows nothing else, and a runtime request to
  someone else's server for a logo is a visitor-data question we do not need to open.
- **Decorative, because the name is beside it.** The mark carries `alt=""` and the
  partner's name is the heading next to it, so a screen reader hears the name once.
  The partner's words and what we draw from them are translated into the six languages.
- **Size.** A fixed small height; a mark that is unreadable at that size is shown as
  the name alone.

## 4. What is not on offer

- No paid placement, no ranking of partners, no exclusivity.
- No wording that suggests endorsement ("official partner", "supported by") unless
  the partner writes it.
- No use of a partner's mark outside A–D without asking again.
- Withdrawal is one email: their layer, their mark and their cartouche come off the
  map, and we say so on the page.

## 5. Order of work, if more than one says yes

1. The data and its baseline credit — always first; nothing visible is promised
   before the layer itself exists.
2. D (record links) and E (release note) — an hour each.
3. A (named layer) — shared by every partner, so it is built once.
4. B and C — built when the first partner asks for them; then every earlier partner
   is offered them too.
