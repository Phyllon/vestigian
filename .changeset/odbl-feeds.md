---
'vestigian': minor
---

`/licence` now groups the reuse feeds by licence and offers the ODbL reference layers back, as ODbL §4.6 asks: `/api/odbl/<layer>.geojson` and `.ttl` for the Ancient World Mapping Center's water, lines, areas, regions and minor features, the coin hoards, the frontier segments and the dated survey sites. Each collection states its licence, credit and what was altered; the frontier and survey features name their own source and licence. RDF in Turtle is added for the site records too (`/api/data/sites.ttl`). The survey feed moved from `/api/survey-sites/sites.geojson` to `/api/odbl/survey-sites.geojson`. The coin hoards' licence was corrected from CC BY-NC-SA 4.0 to what CHRR states: ODbL 1.0 on its site and CC BY-NC 3.0 in its machine-readable description, so share-alike and non-commercial.

Photograph credits now link the licence to its text (`rel="license"`) and show its conventional name instead of the database code.
