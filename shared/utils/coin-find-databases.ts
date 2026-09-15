/**
 * Single coin-find databases this atlas **points to** rather than mirrors.
 *
 * Every candidate was checked for a mirrorable licence first, and none
 * passed (September 2026, each by a real request):
 *
 *   AFE (afe.dainst.org and its sister instances)
 *            Coin, findspot and place pages carry coordinates and a CSV
 *            export, but no licence; the Impressum says content is
 *            copyrighted "wenn nicht explizite Lizenzierungen erwähnt".
 *   PAS      finds.org.uk answers every scripted request with a Cloudflare
 *            challenge (403), so neither its stated CC BY nor its API could
 *            be confirmed. Public findspots are parish-level by design.
 *   SICF     muenzfunde.ch embeds 382 single-find points in its map page,
 *            but states only "© Swiss Inventory of Coin Finds"; the Open
 *            Data pages it links to return 404, and fundmuenzen.ch is behind
 *            a Cloudflare challenge.
 *   Nomisma  The SPARQL endpoint returned 400 for a trivial query, and
 *            OCRE's `findspots.geojson` an empty FeatureCollection.
 *   CoinSampo CC BY 4.0, verified — but 5 Roman-period coins in 18,342.
 *   MEDEA    vondsten.be fails TLS from here; left out until reachable.
 *
 * Asking AFE and PAS for an explicit licence is deferred to go-live
 * (`documents/runbook_prod.deployment.md`, "Offen"). A licence granted then
 * turns the matching entry here into an import, the way CHRR's findspots are.
 *
 * `name` is each project's own proper name and is not translated; the
 * coverage line is, under `siteCoinFinds.coverage.<id>`. Matching is by the
 * site's country only — a country code cannot tell England from Scotland,
 * which is why PAS's coverage line says "England and Wales" explicitly.
 *
 * ## Linking closer than the homepage — checked per source, not assumed
 *
 * A reader asked for this to link to the actual finds near a site, not just
 * the database's front page. Every source was driven with a real headless
 * browser (Playwright, `chromium.launch()`) to see whether it accepts a
 * findspot or free-text query in the URL, September 2026:
 *
 *   DIME     Yes. `/ny/soeg/?fritekst=<term>` is a real, bookmarkable search —
 *            typing "Jelling" into the site's own search box produced exactly
 *            this URL, and loading it directly returned 98 real results. Wired
 *            up below via `buildSearchUrl`, using the site's own title as the
 *            term. This is a text search of DIME's own place/object fields,
 *            not a radius search — "Vindelev" (a real, named hoard find)
 *            returned zero results even though Jelling, a few kilometres
 *            away, returns many, so a result of "nothing found" only means
 *            this exact word doesn't appear in DIME's records, not that
 *            nothing was ever found nearby. Left as an easy first edit for
 *            the reader rather than hidden behind a caveat.
 *   AFE-RGK  No. `/search-container/map-search` is a Next.js app with no
 *            query-string API at all — confirmed by loading it with
 *            `?lat=`/`?lon=`/`?center=` params (ignored, URL unchanged) and by
 *            panning/zooming the map directly (no hash or query update
 *            either). Finding a place means manually drawing a shape on the
 *            map; there is nothing to link to.
 *   AFE-HD   No findspot field at all. Its "Detailed search" page has ~15
 *            coin-attribute filters (denomination, issuer, mint, weight…) and
 *            nothing for where a coin was found.
 *   AFE-PL,
 *   AFE-HU   Not independently driven — both state they are built on the same
 *            AFE codebase AFE-HD uses ("Barbaricoin ... alapja a ... Antike
 *            Fundmünzen in Europa adatbázis"), and both expose the identical
 *            "Detailed search" / "Browse Items" pair AFE-HD does. Treated as
 *            sharing AFE-HD's limitation, not tested by name.
 *   PAS      Still fully blocked — even a real headless Chromium gets the
 *            Cloudflare interstitial ("Just a moment...", HTTP 403), so
 *            whether it has a findspot URL parameter could not be checked
 *            either.
 *   SICF     muenzfunde.ch's coins page did not finish loading at all in two
 *            attempts (25s timeout each) — can't be checked from here right
 *            now, not only "no licence" as recorded above.
 *   PAN      No. `#/publicshop/kaart` is a hash-routed SPA with a reference-
 *            number search box and province checkboxes, no free-text place
 *            search and no query parameter observed to change on interaction.
 *
 * AFE4HD's own footer states "Published content ... is under: GFDL Licence" —
 * worth another look before the go-live licence request, since the shared
 * "no licence" framing above was written against afe.dainst.org's own
 * Impressum and may not hold for every sister instance.
 */
export type CoinFindDatabaseId =
  'afe-rgk' | 'afe-hd' | 'afe-pl' | 'afe-hu' | 'pas' | 'sicf' | 'pan' | 'dime'

export interface CoinFindDatabase {
  id: CoinFindDatabaseId
  name: string
  url: string
  countryCodes: readonly string[]
  /**
   * Only set where a real request confirmed the source accepts a free-text
   * or findspot query in the URL — see the docstring above for what was
   * actually tried on each of the eight. Absent everywhere else on purpose:
   * a link that looks specific but silently lands on the homepage is worse
   * than one that says plainly it is general.
   */
  buildSearchUrl?: (query: string) => string
}

export const COIN_FIND_DATABASES: readonly CoinFindDatabase[] = [
  {
    id: 'afe-rgk',
    name: 'AFE-RGK',
    url: 'https://afe.dainst.org/search-container/map-search',
    countryCodes: ['DE'],
  },
  {
    id: 'afe-hd',
    name: 'AFE4HD',
    url: 'https://pecunia2.zaw.uni-heidelberg.de/AFE_HD/',
    countryCodes: ['DE'],
  },
  {
    id: 'afe-pl',
    name: 'AFE-PL',
    url: 'https://coindb-prod.ocean.icm.edu.pl/AFE_PL/',
    countryCodes: ['PL'],
  },
  {
    // Plain http: the https variant of this host refuses the connection. An
    // outbound link to a public search page — nothing of the reader's is sent.
    id: 'afe-hu',
    name: 'AFE-HU',
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    url: 'http://barbaricoin.elte.hu/AFE_HU/',
    countryCodes: ['HU'],
  },
  {
    id: 'pas',
    name: 'Portable Antiquities Scheme',
    url: 'https://finds.org.uk/database',
    countryCodes: ['GB'],
  },
  {
    id: 'sicf',
    name: 'SICF — Swiss Inventory of Coin Finds',
    url: 'https://www.muenzfunde.ch/services/databases/coins.php',
    countryCodes: ['CH', 'LI'],
  },
  {
    id: 'pan',
    name: 'PAN — Portable Antiquities of the Netherlands',
    url: 'https://portable-antiquities.nl/pan/',
    countryCodes: ['NL'],
  },
  {
    id: 'dime',
    name: 'DIME — Digitale Metaldetektorfund',
    url: 'https://www.metaldetektorfund.dk/ny/',
    countryCodes: ['DK'],
    buildSearchUrl: (query) =>
      `https://www.metaldetektorfund.dk/ny/soeg/?fritekst=${encodeURIComponent(query)}`,
  },
]

/**
 * The link to actually send a reader to: a findspot-scoped search where one
 * is known to work (`buildSearchUrl`), the database's own homepage
 * otherwise. `query` is typically the site's own title — see the module
 * docstring for why that is a starting point to refine, not a guarantee of
 * a match.
 */
export const coinFindDatabaseLink = (
  database: CoinFindDatabase,
  query: string | null,
): { url: string; isSearch: boolean } => {
  const trimmed = query?.trim()
  if (database.buildSearchUrl && trimmed) {
    return { url: database.buildSearchUrl(trimmed), isSearch: true }
  }
  return { url: database.url, isSearch: false }
}

export const coinFindDatabasesForCountry = (countryCode: string | null): CoinFindDatabase[] => {
  if (!countryCode) return []
  const normalised = countryCode.toUpperCase()
  return COIN_FIND_DATABASES.filter((database) => database.countryCodes.includes(normalised))
}
