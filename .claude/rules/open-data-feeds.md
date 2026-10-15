---
paths:
  - 'server/api/data/**'
  - 'shared/utils/linkedPlaces.ts'
  - 'e2e/linked-places.spec.ts'
  - 'app/pages/licence.vue'
---

## What this atlas gives back

Vestigian consumes vici.org, EDH, AWMC, OpenHistoricalMap, CHRR and ORBIS. Two
feeds publish its own records back, both bounded, paged, CORS-open and listed on
`/licence` rather than buried in the API documentation — reuse terms and the
means of reuse belong together.

| Feed                      | Format                    | For                      |
| ------------------------- | ------------------------- | ------------------------ |
| `/api/data/sites.geojson` | plain GeoJSON             | maps, analysis           |
| `/api/data/sites.lp.json` | Linked Places Format v1.3 | gazetteer reconciliation |

**A third feed exists, apart: `/api/survey-sites/sites.geojson`** (15 Oct 2026) — the dated survey
sites (`antiquity_survey_sites`), GeoJSON only, `bbox`/`kind`/`source`/`limit`/`offset`, ordered by the
Survey's own `MS-…` id (the table's serial ids are reassigned by every import). It is **not under
`/api/data/` on purpose**: that path is the CC BY-SA / CC0 feed, and these rows reach us through an
ODbL 1.0 compilation from CC BY 4.0 and OGL sources. The collection says `licence: ODbL 1.0` and the
Survey's credit; **each feature names its upstream source and that source's licence**
(`SURVEY_SITE_SOURCE_META`). The Survey asks that an adapted database be shared under the same licence
(ODbL) — this feed is that sharing. **No Linked Places version:** LPF wants a dereferenceable URI for every
place and a survey site has no page of its own; inventing one would be a claim. No sitemap entry for
the same reason. Listed on `/licence` (`licence.reuseSurveyFeed`), documented in the OpenAPI route meta.

**Neither of those two feeds carries imported reference data.** Roads, mints, monuments, inscriptions and
the neighbouring realms live in their own tables under their own licences and are drawn
only as tiles; republishing them here would put third-party terms inside a feed that
promises CC BY-SA / CC0, and an I.Sicily record under CC BY-NC would break that promise
outright. `/licence` says so (`licence.reuseNotIncluded`). Nothing about the five new
sources therefore changes either endpoint, `bbox`/`category`/`limit`/`offset`/`dated`, or
the `closeMatch` links.

Both read the live `sites` table on every call, filtered to `status = 'approved'`;
the only staleness is the 5-minute `cache-control`. **Both page with `offset`**
(in `id` order, `limit` ≤ 1000) — they once documented themselves as "paged"
while ignoring every paging parameter, so 60,273 of 61,273 sites were
unreachable; walk them with `offset += limit` until a page comes back short.
Checked against the dev database on 3 Oct 2026: 61,273 approved rows, the last
page at `offset=61272` returns the final site, and `offset=61273` is empty.

The query schema (`bbox`, `category`, `limit`, `offset`, and `dated` on the LPF
feed only) is documented for reusers on `/licence`, under "Query parameters",
with two working example URLs — `licence.reuseParam*` in all six locales. Change
a parameter in either endpoint's `querySchema` and that list in the same change.
`category` is a `z.enum` over the DB enum: it used to be a free string cast in
SQL, so an unknown value answered 500 instead of 400.

## Credits owed, and where each is paid

`/licence` is where every upstream is credited in full; the map's own attribution
control carries the live credit for the layer that is switched on. Audited
against the code and, for each licence, a real request (3 Oct 2026):

| Source                                                                                                                                                           | Licence                                                             | Where credited                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| vici.org records (René Voorburg and contributors)                                                                                                                | CC BY-SA / CC0                                                      | `recordsBody` (named only since then)                            |
| OpenStreetMap via Protomaps basemap extract                                                                                                                      | ODbL 1.0 produced work                                              | `modernMapBody`, map attribution                                 |
| Mapterhorn elevation, 151 sources in `attribution.json`                                                                                                          | mostly CC BY 4.0 or open-government licences; 7 CC0; 41 PD or other | `elevationBody`, map attribution → mapterhorn.com/attribution    |
| AWMC, Pleiades, DARE, EOX Sentinel-2, OHM, Wikidata, ports, ORBIS, CHRR, GeoNames, Trajan/Marcus Aurelius plates                                                 | various                                                             | existing sections                                                |
| EDH inscriptions, Attic Inscriptions Online                                                                                                                      | CC BY-SA 4.0 / 3.0                                                  | `overlayInscriptions`, `overlayAtticInscriptions`                |
| Wikipedia extract (+ Wikidata, Pleiades only to match)                                                                                                           | CC BY-SA 4.0 / CC0 / CC BY 3.0                                      | `enrichmentBody`, under each extract                             |
| Tabula Peutingeriana network (René Voorburg; Talbert)                                                                                                            | none stated; reuse confirmed by the compiler                        | `overlayTabulaPeutingeriana`, map attribution                    |
| Itiner-e Roman roads (Brughmans, Pažout, de Soto, Bjerregaard Vahlstrup)                                                                                         | CC BY 4.0                                                           | `overlayRomanRoads`, map attribution                             |
| Nomisma.org mints                                                                                                                                                | CC BY 3.0                                                           | `overlayMints`, map attribution                                  |
| Wikidata Roman monuments                                                                                                                                         | CC0 1.0                                                             | `overlayMonuments`, map attribution                              |
| I.Sicily inscriptions (text only; photographs not mirrored)                                                                                                      | CC BY 4.0, 6 × CC BY-NC 4.0                                         | `overlayIsicily`, map attribution, per-record on the detail page |
| Cliopatria neighbouring realms (Seshat)                                                                                                                          | CC BY 4.0                                                           | `overlayPolities`, map attribution                               |
| Atlas of Hillforts of Britain and Ireland (Ralston & Lock)                                                                                                       | CC BY 4.0                                                           | `overlayHillforts`, map attribution                              |
| Dated survey sites: Villages to Empires, Gwiazda, Marmarica (CC BY 4.0), Cornwall and Scilly HER (OGL v3), via the Ancient Sites and Monuments Survey (ODbL 1.0) | per source, see `reference-overlays.md`                             | `overlaySurveySites`, map attribution                            |
| Natural Earth country boundaries                                                                                                                                 | public domain                                                       | `placeNamesBody`                                                 |
| game-icons.net (Delapouite, Lorc), Lucide, fonts                                                                                                                 | CC BY 3.0 / ISC / OFL                                               | `iconsBody`                                                      |

The game-icons credit was the one that was a genuine breach, not a gap in
courtesy: CC BY 3.0 requires naming the author, and nothing in the UI did until
`iconsBody`. game-icons.net's own About page asks for "Icons made by {author}.
Available on https://game-icons.net". Left out on purpose: EDH
inscription photographs (not imported for publication — see
`scripts/import/13-edh-inscription-images.ts`). The Tabula Peutingeriana network
has its own `overlayTabulaPeutingeriana` line: no stated licence, credited
as used with its compiler's permission. **Adding a data source, a basemap, an overlay or an
icon set means adding its line here and to `licence.*` in all six locales in
the same change.**

## Linked Places Format — why, and the parts that are easy to get wrong

LPF is what the Pelagios Network actually reads: Recogito, Peripleo and the
World Historical Gazetteer reconcile against it, and it supersedes the older
Pelagios Gazetteer Interconnection Format. A plain GeoJSON feed is usable as
data but invisible as a _gazetteer_ — the `closeMatch` links are the part that
does the work, because they are what lets an aggregator recognise that a record
here and a record in Pleiades are the same place. Emitting LPF is what puts this
atlas inside that graph rather than beside it.

It is deliberately also valid GeoJSON, so the same URL renders in an ordinary
map client.

**Built against the fetched specification, not from memory**
(https://github.com/LinkedPasts/linked-places-format, v1.3, 24 June 2024). That
mattered immediately: **v1.3 made `fclasses` required**, and a build from
recollection of the older shape would have omitted it silently and been refused
by an aggregator months later. The builder is
`shared/utils/linkedPlaces.ts` — pure, unit-tested, with the endpoint doing only
the query and URL resolution.

### Three judgement calls worth keeping

**`when` is omitted where dating is unknown, and that is a knowing gap.** LPF
requires a `when` on every Feature. Only 31,368 of 61,273 published sites carry
any dating; the rest never had one in the source. Those features are emitted
without it. The alternative was inventing a temporal scope — a blanket "Roman
period" span — for half the atlas, and a gazetteer that fabricates dating is
worse than one that admits what it does not know. `?dated=true` returns the
strictly conformant subset for a consumer that needs one.

**`exactMatch` is never emitted, at any strength of evidence.** The concordances
were parsed out of vici.org's free-text `pmeta_extids` or discovered by
`verify-concordances.ts` behind a distance-and-category gate. Both are good
evidence that two records describe _the same place_ — which is exactly what
`closeMatch` asserts — and neither establishes that they are the same resource.
Wikipedia is `primaryTopicOf`: an article is a document _about_ a place, not
another gazetteer's record of it.

**BC years carry the source's own numbering forward unchanged.** Strict ISO 8601
uses astronomical year numbering, where year 0 is 1 BC and 12 BC is therefore
`-0011`. Whether vici's `pmeta_startyr` is already astronomical or is plain
historical numbering is stated nowhere in that source, so `toIsoYear` pads and
signs without re-basing. Silently shifting 31,368 dated records by one year on a
guess is a far worse error than a one-year ambiguity on dates that are usually
round-century estimates anyway — and this one a consumer can correct if the
convention is ever established.

### Feature-class mapping

Only `settlement` is a populated place (`P`); everything else this project
records is a site in LPF's sense — archaeological site, building or complex —
which is what `S` means. `infrastructure` is the arguable one: it holds
milestones, mansiones, bridges and aqueducts, and `R` (roads, routes, rail)
fits the road furniture. It maps to `S` because this feed carries **point**
records only — the linear road geometries live in `tracings` and are not
published here — and a point is a structure rather than a route.

### The identifiers query

They are aggregated with `jsonb_agg … FILTER` in the same statement rather than
fetched per site: at up to 1000 records a request, a second round trip each
would be 1000 queries to build one response. `FILTER (WHERE e.id IS NOT NULL)`
is what keeps sites with no concordances in the result with an empty array
instead of dropping them. A scheme with no safe URL pattern is dropped rather
than linked to a guessed address — see `EXTERNAL_URL_PATTERNS`' own note on the
four deliberately unlinked schemes.

### Verified

Against the real built server on the full 61,273-site database, not the unit
tests alone: 1000 consecutive features checked for `@id`, `type`, `title`,
`fclasses` within LPF's seven-letter vocabulary, `names`, Point geometry with
coordinates in range and in longitude-first order, link relations within the
four LPF defines, and absolute link identifiers — zero problems, no `exactMatch`
anywhere, 368 of 400 sampled features carrying real Wikidata/Pleiades links.
`?dated=true` returned only features with a `when`; the bbox and category
filters held; a malformed bbox answered 400. `e2e/linked-places.spec.ts` keeps
all of that asserted against the production build.
