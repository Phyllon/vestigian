---
paths:
  - 'server/api/data/**'
  - 'server/api/odbl/**'
  - 'server/utils/odbl-feeds.ts'
  - 'server/utils/rdf.ts'
  - 'server/utils/site-feed.ts'
  - 'shared/utils/linkedPlaces.ts'
  - 'shared/utils/odbl-feeds.ts'
  - 'shared/utils/licence-uris.ts'
  - 'e2e/linked-places.spec.ts'
  - 'e2e/odbl-feeds.spec.ts'
  - 'app/pages/licence.vue'
---

## What this atlas gives back

Vestigian consumes vici.org, EDH, AWMC, OpenHistoricalMap, CHRR, ORBIS and more. It publishes back
**two groups of feeds, one per licence**, listed together on `/licence` ("Reusing this data", one
`.leaf` block per group) rather than buried in the API documentation — reuse terms and the means of
reuse belong together. All are bounded, paged, CORS-open and `private` cached, and each is offered as
GeoJSON and as RDF (Turtle).

### Group 1 — contributed records, CC BY-SA / CC0 (`/api/data/`)

| Feed                      | Format                    | For                                 |
| ------------------------- | ------------------------- | ----------------------------------- |
| `/api/data/sites.geojson` | plain GeoJSON             | maps, analysis                      |
| `/api/data/sites.lp.json` | Linked Places Format v1.3 | gazetteer reconciliation (Pelagios) |
| `/api/data/sites.ttl`     | RDF, Turtle               | a triple store / SPARQL endpoint    |

`sites.lp.json` and `sites.ttl` share one query (`server/utils/site-feed.ts`, the same schema and the
same page boundaries) so a reconciler walking one finds the other in step. **The Turtle uses standard
vocabularies only and mints no terms**: GeoSPARQL `geo:asWKT` for geometry (WKT without a CRS is CRS84,
longitude first), `skos:closeMatch` / `foaf:isPrimaryTopicOf` for the concordances, `gn:featureClass`
for the GeoNames class LPF already carries, `dcat:startDate` / `endDate` on a `dcterms:PeriodOfTime`,
and a schema.org `PropertyValue` for anything with no standard term. It is built with `n3` (the
rdf.js writer; MIT), not by string concatenation — quoting is the part hand-rolled serialisers get
subtly wrong, and the tests read the output back with n3's own parser.

**Neither group-1 feed carries imported reference data.** Roads, mints, monuments, inscriptions and
the neighbouring realms live in their own tables under their own licences; republishing them here
would put third-party terms inside a feed that promises CC BY-SA / CC0, and an I.Sicily record under
CC BY-NC would break that promise outright. `/licence` says so (`licence.reuseNotIncluded`).

### Group 2 — reference data, ODbL 1.0 (`/api/odbl/:layer.:format`)

**This group is a duty, not a courtesy (15 Oct 2026).** ODbL §4.6 (read from opendatacommons.org,
not recalled): whoever _publicly uses a derivative database or a produced work from one_ must offer
recipients the entire derivative database in a machine-readable form, or a file of the alterations
or the method. "Derivative Database" includes extracting a substantial part of the contents into a
new database; the tiles of these layers are the produced work. The earlier reading in
`antiquity-basemaps.md` — "rendered tiles are a Produced Work and need only attribution" — was only
the half of §4.5 and missed §4.6.

One handler (`server/api/odbl/[feed].get.ts`) for every layer, because they differ only in table and
columns; the list of what exists is `shared/utils/odbl-feeds.ts`, which `/licence` reads too.

| Layer           | Table                                   | Upstream, licence                                                                                                     |
| --------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `awmc-water`    | `antiquity_water` (13,907)              | AWMC, ODbL; sea polygons simplified ~20 m on import                                                                   |
| `awmc-lines`    | `antiquity_lines` (16,375)              | AWMC, ODbL (roads, aqueducts, canals, walls, shorelines, centuriation …)                                              |
| `awmc-areas`    | `antiquity_areas` (316)                 | AWMC, ODbL                                                                                                            |
| `awmc-regions`  | `antiquity_regions` (2,618)             | AWMC, ODbL (boundary linework; the derived label point is not exported)                                               |
| `awmc-features` | `antiquity_features` (525)              | AWMC, ODbL                                                                                                            |
| `coin-hoards`   | `antiquity_coin_hoards` (620)           | CHRR — **ODbL 1.0 and CC BY-NC 3.0** (below)                                                                          |
| `limes`         | `limes_segments` + `limes_sectors` (25) | OSM (ODbL), OHM (CC0), vici tracings (CC0 or CC BY-SA 3.0), AWMC (ODbL); **per-feature `source` and `sourceLicence`** |
| `survey-sites`  | `antiquity_survey_sites` (4,671)        | the Ancient Sites and Monuments Survey (ODbL) over four sources (per feature)                                         |

Rules that are not obvious:

- **Each collection says what it is.** `licence`, `licenceUrls`, `attribution` and `alterations` ride
  in the GeoJSON collection and as `dcterms:*` on the Turtle's `dcat:Dataset`; §4.6(b) accepts "the
  alterations made", so `alterations` is the offer's own record of what the import changed
  (`ODBL_FEED_META`). A `Link: <…>; rel="license"` header carries it for a consumer that never sees
  the page. Feature-level `source` / `sourceLicence` appear only where sources differ (limes, survey).
- **`limit` beyond a layer's `maxLimit` is a 400, never clamped.** A client pages until a page comes
  back shorter than the `limit` it asked for; a silently smaller page reads as the end. Water and
  limes carry heavy geometry: default 100, max 250.
- **`kind` / `source` are validated per layer** against the DB enums (`ALLOWED_FILTERS`) — an unknown
  kind used to be the one way to turn a reuse feed into a 500 (the enum cast). A filter a layer does
  not have is 400, not ignored.
- **No stable ids except the Survey's `MS-…`.** Serial ids are reassigned by every import, so
  GeoJSON features carry no `id`, the Turtle uses blank nodes, and only survey sites get an IRI
  (`…/api/odbl/survey-sites.ttl#MS-004712`). A walk straddling a re-import can repeat or skip a row.
- **CHRR is carried under both terms because its sources disagree** (fetched 15 Oct 2026): the site's
  footer says "made available under the Open Database License"; `pelagios.void.rdf` says
  `dcterms:license` CC BY-NC 3.0; the importer already treated the stricter as authoritative. `/licence`
  and the map credit had said **CC BY-NC-SA 4.0** — which matches neither (it is CHRE's licence) — and
  were corrected. Honouring both means share-alike _and_ non-commercial.
- **Not offered, on purpose:** the basemap mirrors (OpenStreetMap via Protomaps, DARE, EOX, Mapterhorn
  — tiles only); and every layer whose licence asks for credit alone (Itiner-e, Nomisma, Cliopatria,
  hillforts, ports, ORBIS, Pleiades, Wikidata, OHM extents) — no duty, and third-party terms do not
  belong in an ODbL feed. CC BY-SA layers (EDH, Attic Inscriptions, Wikipedia) ask that adaptations carry
  the same licence and credit, not that a bulk feed exist; their licences are on `/licence` and on each
  detail page.
- **Not exported, and arguably owed:** `limes_sector_sightlines` (derived from ODbL sector geometry
  and terrain; it is already served per sector at `/api/limes/sectors/:slug/sightlines.geojson`), and
  the OSM basemap mirror itself — whether mirrored vector tiles are a derivative database is
  contested and unresolved.
- **No Linked Places version of group 2.** LPF wants a dereferenceable URI for every place; a survey
  site has no page of its own and a water polygon is not a place. Inventing one would be a claim.
- **No sitemap entry** — there is no page per feature.

The group-2 feeds went in with the survey feed's URL moved (`/api/survey-sites/sites.geojson` →
`/api/odbl/survey-sites.geojson`; it had not been committed).

The group-1 feeds read the live `sites` table on every call, filtered to `status = 'approved'`;
the only staleness is the 5-minute `cache-control`. **They page with `offset`**
(in `id` order, `limit` ≤ 1000) — they once documented themselves as "paged"
while ignoring every paging parameter, so 60,273 of 61,273 sites were
unreachable; walk them with `offset += limit` until a page comes back short.
Checked against the dev database on 3 Oct 2026: 61,273 approved rows, the last
page at `offset=61272` returns the final site, and `offset=61273` is empty.

The query schema (`bbox`, `category`, `limit`, `offset`, `dated` on the LPF and Turtle
feeds, `kind` and `source` on the ODbL feeds) is documented for reusers on `/licence`, under
"Query parameters", with working example URLs — `licence.reuseParam*` in all six locales. Change
a parameter in an endpoint's `querySchema` and that list in the same change.
`category` is a `z.enum` over the DB enum: it used to be a free string cast in
SQL, so an unknown value answered 500 instead of 400.

## Credits owed, and where each is paid

`/licence` is where every upstream is credited in full; the map's own attribution
control carries the live credit for the layer that is switched on. Audited
against the code and, for each licence, a real request (3 Oct 2026):

| Source                                                                                                                                                           | Licence                                                                          | Where credited                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| vici.org records (René Voorburg and contributors)                                                                                                                | CC BY-SA / CC0                                                                   | `recordsBody` (named only since then)                            |
| OpenStreetMap via Protomaps basemap extract                                                                                                                      | ODbL 1.0 produced work                                                           | `modernMapBody`, map attribution                                 |
| Mapterhorn elevation, 151 sources in `attribution.json`                                                                                                          | mostly CC BY 4.0 or open-government licences; 7 CC0; 41 PD or other              | `elevationBody`, map attribution → mapterhorn.com/attribution    |
| AWMC, Pleiades, DARE, EOX Sentinel-2, OHM, Wikidata, ports, ORBIS, CHRR, GeoNames, Trajan/Marcus Aurelius plates                                                 | various                                                                          | existing sections                                                |
| EDH inscriptions, Attic Inscriptions Online                                                                                                                      | CC BY-SA 4.0 / 3.0                                                               | `overlayInscriptions`, `overlayAtticInscriptions`                |
| Wikipedia extract (+ Wikidata, Pleiades only to match)                                                                                                           | CC BY-SA 4.0 / CC0 / CC BY 3.0                                                   | `enrichmentBody`, under each extract                             |
| Tabula Peutingeriana network (René Voorburg; Talbert)                                                                                                            | none stated; reuse confirmed by the compiler                                     | `overlayTabulaPeutingeriana`, map attribution                    |
| Itiner-e Roman roads (Brughmans, Pažout, de Soto, Bjerregaard Vahlstrup)                                                                                         | CC BY 4.0                                                                        | `overlayRomanRoads`, map attribution                             |
| Coin Hoards of the Roman Republic (CHRR)                                                                                                                         | ODbL 1.0 on the site; CC BY-NC 3.0 in the VoID description (fetched 15 Oct 2026) | `overlayCoinHoards`, map attribution, `coin-hoards` feed         |
| Nomisma.org mints                                                                                                                                                | CC BY 3.0                                                                        | `overlayMints`, map attribution                                  |
| Wikidata Roman monuments                                                                                                                                         | CC0 1.0                                                                          | `overlayMonuments`, map attribution                              |
| I.Sicily inscriptions (text only; photographs not mirrored)                                                                                                      | CC BY 4.0, 6 × CC BY-NC 4.0                                                      | `overlayIsicily`, map attribution, per-record on the detail page |
| Cliopatria neighbouring realms (Seshat)                                                                                                                          | CC BY 4.0                                                                        | `overlayPolities`, map attribution                               |
| Atlas of Hillforts of Britain and Ireland (Ralston & Lock)                                                                                                       | CC BY 4.0                                                                        | `overlayHillforts`, map attribution                              |
| Dated survey sites: Villages to Empires, Gwiazda, Marmarica (CC BY 4.0), Cornwall and Scilly HER (OGL v3), via the Ancient Sites and Monuments Survey (ODbL 1.0) | per source, see `reference-overlays.md`                                          | `overlaySurveySites`, map attribution                            |
| Natural Earth country boundaries                                                                                                                                 | public domain                                                                    | `placeNamesBody`                                                 |
| game-icons.net (Delapouite, Lorc), Lucide, fonts                                                                                                                 | CC BY 3.0 / ISC / OFL                                                            | `iconsBody`                                                      |

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
