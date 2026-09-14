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
