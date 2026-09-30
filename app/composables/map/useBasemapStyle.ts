import { Protocol } from 'pmtiles'
import { addProtocol } from 'maplibre-gl'
import type { FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
// Imported explicitly rather than through Nuxt's auto-imports: this is called
// while the style is built, so the unit tests — which import this module
// directly — would otherwise fail on an undefined reference that the running
// application never sees.
import { buildAtlasIconExpression, buildLimesReferenceIconExpression } from './useSiteIcons'
import type {
  BasemapGroup,
  BasemapOption,
  BasemapSheetTone,
  BasemapSource,
  BasemapView,
  LimesSegmentKind,
} from '#shared/types'

let protocolRegistered = false

/**
 * PMTiles is read straight from object storage over HTTP range requests, so no
 * tile server process exists to run, scale or pay for. The protocol handler has
 * to be registered on MapLibre once per page, before any style referencing it.
 */
const registerPmtilesProtocol = (): void => {
  if (protocolRegistered) return
  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

/**
 * The one fontstack every label layer asks for. Written out in three places
 * before this constant existed, and the glyphs are now served from this repo:
 * a name that disagrees with the directory under `public/fonts/` renders every
 * label blank and logs nothing worth reading, so the two are tied together
 * here rather than restated per layer.
 */
export const MAP_LABEL_FONT = 'Noto Sans Regular'

/**
 * The zoom the mirrored DARE pyramid actually holds. The upstream server stops
 * at 11, and z11 alone would be three quarters of the tiles for a level nobody
 * reads the base at, so the mirror stops at 10 and MapLibre overzooms above —
 * softer, but present. Declaring it on the source is what makes that happen;
 * without it MapLibre requests z11+ and gets a 404, and the map goes empty
 * exactly where sites become individual markers.
 */
const DARE_MAX_ZOOM = 10

/**
 * The Digital Atlas of the Roman Empire, as raster tiles.
 *
 * Johan Åhlfeldt's terms page grants reuse under CC BY-SA 3.0 with attribution
 * and a link. Its own legend, however, credits two inputs as CC BY-NC 3.0
 * (AWMC's Barrington roads) and CC BY-NC-SA (the Roman roads of Britain), which
 * the blanket BY-SA cannot cover: the rendered tiles bake in layers DARE itself
 * calls non-commercial. AWMC has since relicensed its geodata to ODbL, which
 * probably settles it, but nobody has updated DARE's credits to say so. Fine
 * for an atlas that earns nothing; the wrong dependency the day it does.
 */
const DARE_TILES = 'https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png'

const DARE_ATTRIBUTION =
  'Antiquity base © <a href="https://imperium.ahlfeldt.se" target="_blank" rel="noopener">Digital Atlas of the Roman Empire</a>, Johan Åhlfeldt (CC BY-SA 3.0)'

/**
 * Sentinel-2 cloudless, EOX IT Services GmbH (Vienna, Austria) — a global,
 * cloud-free mosaic built from ESA Copernicus Sentinel-2 open data. This is
 * the 2025 vintage, CC BY-NC-SA 4.0: acceptable while nothing in this atlas
 * is sold, the same "wrong dependency the day it does" trade-off DARE's own
 * attribution above already documents, not a coincidence — EOX's own older
 * (2016/2017) vintage is CC BY 4.0 with no such condition, at the cost of
 * imagery that is now years further from current.
 *
 * The path segments are `{TileMatrix}/{TileRow}/{TileCol}` in EOX's own WMTS
 * capabilities document — **`z/y/x`, not the `z/x/y` every other tile source
 * in this file uses.** Confirmed by fetching the same coordinate both ways
 * and looking at the actual imagery: `z/x/y` landed on generic forest,
 * `z/y/x` clearly showed the Danube through Vienna, exactly where it should
 * be. Written into the template with `{y}` before `{x}` here, once, so
 * nothing downstream has to know the axes are unusual for this one source.
 */
const SATELLITE_TILES =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'

const SATELLITE_ATTRIBUTION =
  'Satellite: <a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2025, CC BY-NC-SA 4.0)'

/**
 * Sentinel-2's real ground resolution is ~10 m/pixel, which lands at almost
 * exactly this zoom for 256px tiles — `pnpm import:satellite-tiles` mirrors
 * no deeper than this on purpose (see that script's own docstring for the
 * measured tile counts), since anything past it is EOX's server upsampling,
 * not more real detail. Declared here for the same reason as
 * `DARE_MAX_ZOOM`: without a ceiling MapLibre requests zooms the mirror does
 * not hold and gets a 404, and the base goes blank right where it matters
 * most. The live EOX fallback (used until a mirror is configured) actually
 * serves up to z21, so this ceiling costs nothing today — overzoom looks
 * identical to native tiles at this resolution — and means the sheet will
 * not visibly change the day someone does configure the mirror.
 */
const SATELLITE_MAX_ZOOM = 13

/**
 * The AWMC sheet is ours to draw, not someone else's to borrow.
 *
 * The CAWM tile server publishes only physical relief — no roads, no names, no
 * settlements — so mirroring it would have produced a beautiful empty map. The
 * information that makes it an atlas is published separately as open data, and
 * `/api/tiles/antiquity` now serves it from this project's own PostGIS: AWMC's
 * Barrington-derived geodata under ODbL 1.0 and Pleiades places under CC BY 3.0.
 */
const ATLAS_ATTRIBUTION =
  'Antiquity data © <a href="https://github.com/AWMC/geodata" target="_blank" rel="noopener">Ancient World Mapping Center</a> (ODbL 1.0) and <a href="https://pleiades.stoa.org" target="_blank" rel="noopener">Pleiades</a> (CC BY 3.0)'

/**
 * What the frontier actually is, credited on the frontier's own source.
 *
 * "Derived from" rather than a bare credit, because the line is not a dataset
 * anyone published: it is the boundary of AWMC's extent of the empire with the
 * coast taken out of it. A reader is owed that before they cite it.
 *
 * Self-contained rather than appended to `ATLAS_ATTRIBUTION` the way it used
 * to be: the frontier is drawn over any basemap now, including ones where the
 * `atlas` source — and so AWMC's own credit — is not in the style at all.
 */
export const LIMES_ATTRIBUTION =
  'Frontier derived from <a href="https://github.com/AWMC/geodata" target="_blank" rel="noopener">Ancient World Mapping Center</a>\'s extent of the empire at 200 CE (ODbL 1.0)'

/**
 * The period scrubber's own source, credited separately because it is the one
 * layer on this sheet that is neither AWMC's nor Pleiades'.
 *
 * CC0 obliges nobody to credit anything. OHM asks anyway ("we greatly
 * appreciate any credit"), the data is contributor-drawn rather than
 * institutional, and a reader deciding how far to trust a frontier line is
 * owed the knowledge that this one came from a volunteer project — so it is
 * credited on the same terms as the sources that do require it.
 */
export const EMPIRE_EXTENT_ATTRIBUTION =
  'Extent over time © <a href="https://www.openhistoricalmap.org" target="_blank" rel="noopener">OpenHistoricalMap</a> contributors (CC0 1.0)'

/**
 * One credit per overlay, set on the overlay's own MapLibre source so it
 * appears with the layer and leaves with it — MapLibre's `AttributionControl`
 * collects attribution from the sources currently in the style, which is
 * exactly the right granularity for switchable layers.
 *
 * **These were missing entirely, and for four of these sources attribution is
 * the licence condition itself** — de Graauw's ports and ORBIS are CC BY,
 * CHRR is CC BY-NC-SA, AWMC's minor antiquities are ODbL, all four requiring
 * credit on any produced work. The gap only became visible once the
 * vici-sourced site overlay was switched off by default (see
 * `.claude/rules/map-and-tiles.md`): that source carried the one credit line
 * every other overlay was silently leaning on, and with it off a reader who
 * turned on ports and routes saw nothing but "© OpenStreetMap contributors".
 * Wikidata's battles are CC0 and compel nothing; they are credited on the
 * same terms as `EMPIRE_EXTENT_ATTRIBUTION`, for the reason given there.
 *
 * The Tabula Peutingeriana network states no licence at all (see
 * `.claude/rules/tabula-peutingeriana.md`, which is why the whole layer is
 * behind an operator flag) — naming its compiler is the least this can do
 * while it is switched on.
 */
export const BATTLE_ATTRIBUTION =
  'Battles: <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> (CC0 1.0)'

export const PORT_ATTRIBUTION =
  'Ports: <a href="https://www.ancientportsantiques.com/the-catalogue/" target="_blank" rel="noopener">Catalogue of Ancient Ports</a>, Arthur de Graauw (CC BY 4.0), also published as the DARMC Scholarly Data Series (Harvard)'

export const ROUTE_ATTRIBUTION =
  'Routes: <a href="https://purl.stanford.edu/mn425tz9757" target="_blank" rel="noopener">ORBIS v2</a>, Meeks, Scheidel, Weiland & Arcenas, Stanford University (CC BY 3.0)'

export const MINOR_FEATURE_ATTRIBUTION =
  'Minor antiquities: <a href="https://github.com/AWMC/geodata" target="_blank" rel="noopener">Ancient World Mapping Center</a> (ODbL 1.0)'

export const COIN_HOARD_ATTRIBUTION =
  'Coin hoards: <a href="http://numismatics.org/chrr/" target="_blank" rel="noopener">Coin Hoards of the Roman Republic</a>, American Numismatic Society (CC BY-NC-SA 4.0)'

export const INSCRIPTION_ATTRIBUTION =
  'Inscriptions: <a href="https://edh.ub.uni-heidelberg.de/" target="_blank" rel="noopener">Epigraphic Database Heidelberg</a> (CC BY-SA 4.0)'

export const ATTIC_INSCRIPTION_ATTRIBUTION =
  'Attic inscriptions: <a href="https://www.atticinscriptions.com/" target="_blank" rel="noopener">Attic Inscriptions Online</a> (CC BY-SA 3.0)'

export const TABULA_PEUTINGERIANA_ATTRIBUTION =
  'Tabula Peutingeriana network compiled by René Voorburg, <a href="https://omnesviae.org" target="_blank" rel="noopener">omnesviae.org</a>'

/** Neither antiquity view is a recolouring of the modern vector source. */
export type AntiquityView = Extract<BasemapView, 'antiquity-dare' | 'antiquity-awmc'>

export const isAntiquityView = (view: BasemapView): view is AntiquityView =>
  view === 'antiquity-dare' || view === 'antiquity-awmc'

/**
 * What the overlay is drawn on, which is not the same question as which theme
 * the reader chose. An antiquity raster is parchment at midnight too, so the
 * night palette — pale ink on a dark disc — would put invisible markers on a
 * bright sheet. Satellite imagery is the same problem from the other
 * direction: real photography has no "dark mode" to switch to, so it gets the
 * same fixed treatment as the antiquity rasters rather than following
 * `isDark`. Everything drawing over the basemap reads this, not `isDark`.
 */
export const resolveSheetTone = (view: BasemapView, isDark: boolean): BasemapSheetTone => {
  if (isAntiquityView(view) || view === 'satellite') return 'light'
  return isDark ? 'dark' : 'light'
}

interface StyleColours {
  land: string
  water: string
  landuse: string
  road: string
  roadMajor: string
  building: string
  label: string
  labelHalo: string
  boundary: string
}

/**
 * The notebook palette translated into map terms. Land is paper, water is a
 * wash of dilute ink, and modern roads are drawn as faint pencil so the
 * archaeological overlay is always the darkest thing on the map.
 */
const LIGHT_COLOURS: StyleColours = {
  land: '#f2ede1',
  water: '#cfd7d3',
  landuse: '#e7dfcd',
  road: '#dcd3bf',
  roadMajor: '#cfc3a8',
  building: '#e2d9c6',
  label: '#000000',
  labelHalo: '#fefefe',
  boundary: '#b9ab8d',
}

const DARK_COLOURS: StyleColours = {
  land: '#17140f',
  water: '#10161a',
  landuse: '#211d17',
  road: '#332c22',
  roadMajor: '#443b2d',
  building: '#241f19',
  label: '#e7dfcd',
  labelHalo: '#17140f',
  boundary: '#3d362c',
}

/** The only remaining vector view: modern infrastructure present but pushed to the background. */
const QUIET_ROAD_OPACITY = 0.35

interface StyleRequest {
  view: BasemapView
  isDark: boolean
  source: BasemapSource
  /** Only the Barrington sheet reads this; every other view ignores it. */
  isFollowingLimes?: boolean
}

const buildVectorSource = (source: BasemapSource) =>
  source.provider === 'pmtiles'
    ? {
        type: 'vector' as const,
        url: `pmtiles://${source.pmtilesUrl}`,
        attribution: '© OpenStreetMap contributors',
      }
    : {
        type: 'vector' as const,
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '© OpenStreetMap contributors',
      }

interface ModernSchema {
  building: string
  transportation: string
  boundary: string
  place: string
  majorRoadFilter: FilterSpecification
  minorRoadFilter: FilterSpecification
  boundaryFilter: FilterSpecification
}

/**
 * Two vector tile schemas answer to `basemap`/`source-layer`, not one, and
 * they name layers differently. `landuse` and `water` happen to agree; the
 * rest don't, which is why city names, roads, buildings and boundaries all
 * went quietly empty in production while dev (`openfreemap`, OpenMapTiles/
 * Tilezen-derived) kept looking correct — this file was written against dev's
 * schema only and never revisited once `NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles`
 * pointed production at a Protomaps `build.protomaps.com` extract instead,
 * whose own "basemaps" schema (confirmed against
 * https://docs.protomaps.com/basemaps/layers, v4) uses different layer names
 * and tag shapes: `places`/`roads`/`buildings`/`boundaries` (plural) rather
 * than OpenMapTiles' `place`/`transportation`/`building`/`boundary`
 * (singular), a two-tier `kind`/`kind_detail` road classification rather than
 * a single `class` string, and a `kind: 'country'` boundary tag rather than a
 * numeric `admin_level`. MapLibre drops a symbol/line/fill layer's features
 * silently when its `source-layer` or filter matches nothing — no error, no
 * warning — so this broke with no signal anywhere except a map that looked
 * thinner than it should.
 */
const OPENMAPTILES_SCHEMA: ModernSchema = {
  building: 'building',
  transportation: 'transportation',
  boundary: 'boundary',
  place: 'place',
  majorRoadFilter: ['in', 'class', 'motorway', 'trunk', 'primary'],
  minorRoadFilter: ['!in', 'class', 'motorway', 'trunk', 'primary'],
  boundaryFilter: ['<=', 'admin_level', 2],
}

const PROTOMAPS_SCHEMA: ModernSchema = {
  building: 'buildings',
  transportation: 'roads',
  boundary: 'boundaries',
  place: 'places',
  majorRoadFilter: ['in', 'kind_detail', 'motorway', 'trunk', 'primary'],
  minorRoadFilter: ['!in', 'kind_detail', 'motorway', 'trunk', 'primary'],
  boundaryFilter: ['==', 'kind', 'country'],
}

const resolveModernSchema = (source: BasemapSource): ModernSchema =>
  source.provider === 'pmtiles' ? PROTOMAPS_SCHEMA : OPENMAPTILES_SCHEMA

/**
 * The one symbol layer both the `vestigian` and `satellite` views draw —
 * pulled out so satellite (photography with nothing of its own to name a
 * place) can put it straight over the imagery instead of duplicating it.
 * `opacity` is the "slightly transparent" reported missing: full strength
 * would compete with whatever the sheet underneath is doing, so both callers
 * pass the same quiet 0.7 a busy sheet already used before this was a
 * function of its own.
 */
const buildPlaceLabelsLayer = (
  colours: Pick<StyleColours, 'label' | 'labelHalo'>,
  schema: ModernSchema,
  opacity: number,
): LayerSpecification => ({
  id: 'place-labels',
  type: 'symbol',
  source: 'basemap',
  'source-layer': schema.place,
  layout: {
    'text-field': ['get', 'name'],
    'text-font': [MAP_LABEL_FONT],
    'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 14, 15],
    'text-max-width': 8,
  },
  paint: {
    'text-color': colours.label,
    'text-halo-color': colours.labelHalo,
    'text-halo-width': 1.2,
    'text-opacity': opacity,
  },
})

const buildBasemapLayers = (
  colours: StyleColours,
  roadOpacity: number,
  schema: ModernSchema,
): LayerSpecification[] => [
  {
    id: 'background',
    type: 'background',
    paint: { 'background-color': colours.land },
  },
  {
    id: 'landuse',
    type: 'fill',
    source: 'basemap',
    'source-layer': 'landuse',
    paint: { 'fill-color': colours.landuse, 'fill-opacity': 0.5 },
  },
  {
    id: 'water',
    type: 'fill',
    source: 'basemap',
    'source-layer': 'water',
    paint: { 'fill-color': colours.water },
  },
  {
    id: 'buildings',
    type: 'fill',
    source: 'basemap',
    'source-layer': schema.building,
    minzoom: 14,
    paint: { 'fill-color': colours.building, 'fill-opacity': roadOpacity * 0.8 },
  },
  {
    id: 'roads-minor',
    type: 'line',
    source: 'basemap',
    'source-layer': schema.transportation,
    filter: schema.minorRoadFilter,
    minzoom: 11,
    paint: {
      'line-color': colours.road,
      'line-opacity': roadOpacity,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 18, 3],
    },
  },
  {
    id: 'roads-major',
    type: 'line',
    source: 'basemap',
    'source-layer': schema.transportation,
    filter: schema.majorRoadFilter,
    paint: {
      'line-color': colours.roadMajor,
      'line-opacity': roadOpacity,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 18, 6],
    },
  },
  {
    id: 'boundaries',
    type: 'line',
    source: 'basemap',
    'source-layer': schema.boundary,
    filter: schema.boundaryFilter,
    paint: {
      'line-color': colours.boundary,
      'line-dasharray': [3, 2],
      'line-width': 0.8,
      'line-opacity': 0.6,
    },
  },
  buildPlaceLabelsLayer(colours, schema, roadOpacity < 1 ? 0.7 : 1),
]

/**
 * The mirror in object storage if one is configured, Gothenburg's own server
 * otherwise. The fallback is what lets a fresh clone show the map with no
 * import run at all; it is also a research server being asked to serve a
 * development session, which is why `.env.example` says to set this in
 * production and the mirror script exists.
 */
/**
 * Mapterhorn's terrarium tiles, Copernicus GLO-30 based, replacing Mapzen's on
 * AWS Open Data. Same encoding, same maths — the only things that moved are the
 * host and the container format (WebP, 512px, where the AWS mirror served PNG
 * at 256px; see `tileSize` below).
 *
 * Kept here rather than in `nuxt.config.ts` for the same reason as the DARE
 * fallback below: a deployment whose env file sets the variable to nothing
 * then gets a working sheet instead of a flat one, and the failure mode of a
 * missing hillshade is that nobody notices.
 *
 * A different host has to be added to `mapAssetOrigins` in `nuxt.config.ts` or
 * the production build's CSP refuses it silently.
 */
const TERRAIN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'

const resolveTerrainUrl = (source: BasemapSource): string =>
  source.terrainUrl.length > 0 ? source.terrainUrl : TERRAIN_TILES

const resolveDareUrl = (source: BasemapSource): string =>
  source.antiquityDareUrl.length > 0 ? source.antiquityDareUrl : DARE_TILES

const resolveSatelliteUrl = (source: BasemapSource): string =>
  source.satelliteUrl.length > 0 ? source.satelliteUrl : SATELLITE_TILES

/**
 * DARE, as printed. Raster tiles carry their own cartography, so there is
 * nothing to style: the sheet is the map.
 *
 * The background stays paper in both themes. These tiles are opaque parchment
 * and only the edge of coverage shows through, so a night-coloured backdrop
 * would read as a hole in the sheet rather than as the dark it is elsewhere.
 */
const buildDareStyle = (source: BasemapSource): StyleSpecification => ({
  version: 8,
  glyphs: source.glyphsUrl,
  sources: {
    antiquity: {
      type: 'raster',
      tiles: [resolveDareUrl(source)],
      tileSize: 256,
      minzoom: 3,
      maxzoom: DARE_MAX_ZOOM,
      attribution: DARE_ATTRIBUTION,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': LIGHT_COLOURS.land } },
    { id: 'antiquity', type: 'raster', source: 'antiquity' },
  ],
})

/**
 * Satellite imagery, as photographed. Like DARE, raster tiles carry their own
 * content and there is nothing to recolour — the sheet stays paper-toned in
 * both themes for the same reason: these tiles are opaque, and only the
 * uncovered edges show the background through, so a night backdrop would read
 * as a hole rather than as the dark it is elsewhere.
 */
const buildSatelliteStyle = (source: BasemapSource): StyleSpecification => {
  if (source.provider === 'pmtiles') registerPmtilesProtocol()

  return {
    version: 8,
    glyphs: source.glyphsUrl,
    sources: {
      satellite: {
        type: 'raster',
        tiles: [resolveSatelliteUrl(source)],
        tileSize: 256,
        minzoom: 0,
        maxzoom: SATELLITE_MAX_ZOOM,
        attribution: SATELLITE_ATTRIBUTION,
      },
      basemap: buildVectorSource(source),
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': LIGHT_COLOURS.land } },
      { id: 'satellite', type: 'raster', source: 'satellite' },
      // City names only — the imagery already shows roads and buildings.
      // Same quiet 0.7 opacity the vestigian view uses, which is what was
      // reported missing here; satellite never drew this layer at all
      // before (see BasemapView history), so this is new rather than a
      // regression fix for this one view specifically.
      buildPlaceLabelsLayer(LIGHT_COLOURS, resolveModernSchema(source), 1),
    ],
  }
}

interface AtlasColours {
  land: string
  sea: string
  inland: string
  coast: string
  road: string
  roadMajor: string
  infrastructure: string
  urban: string
  label: string
  labelHalo: string
  regionLabel: string
}

/**
 * The atlas in notebook terms. Sea is a dilute ink wash, land is the paper
 * itself, and the Roman roads are the darkest thing on the sheet because they
 * are what the map is for. Drawn from the same tokens as the rest of the
 * interface, as hex literals — see the note on the modern palettes above.
 */
const ATLAS_COLOURS: AtlasColours = {
  land: '#f2ede1',
  sea: '#c8d3d0',
  inland: '#bccbc8',
  coast: '#8c8271',
  road: '#7d6a4a',
  roadMajor: '#5c4b33',
  infrastructure: '#9a3b22',
  urban: '#ded2b8',
  label: '#3d362e',
  labelHalo: '#faf7ef',
  regionLabel: '#6b6154',
}

export interface PeriodExtentColours {
  fill: string
  line: string
}

/**
 * The period scrubber's own palette — a wash distinct from `ATLAS_COLOURS.urban`'s
 * tan and `.infrastructure`'s oxide, so it reads as "territory at this date"
 * without being mistaken for a city or a built structure. This is the default,
 * used on the Barrington sheet and the modern (Vestigian) view; DARE and
 * satellite get their own palettes below, for the same reason a reference
 * mark does (see `resolvePeriodExtentColours`).
 */
export const PERIOD_EXTENT_COLOURS: PeriodExtentColours = {
  fill: '#c99b52',
  line: '#8a6a2f',
}

/**
 * DARE's own raster cartography is pale parchment — the default amber wash
 * reads as barely-there on top of it, the same low-contrast problem
 * `referenceInk` already documents for point marks over a raster basemap
 * (`.claude/rules/map-and-tiles.md`, "Reference marks over raster basemaps
 * get a halo"). A dark, near-black ink reads clearly against DARE's pale
 * colouring without fighting its own printed linework.
 */
const DARE_PERIOD_EXTENT_COLOURS: PeriodExtentColours = {
  fill: '#241f19',
  line: '#120f0c',
}

/**
 * Satellite imagery carries no single background tone the way DARE or
 * Barrington's flat fills do, so the amber wash reads poorly against both a
 * dark forest and pale sand in the same view. Oxide red — this app's one
 * accent — is spent here for the same reason `SATELLITE_REFERENCE_INK`
 * fixes a high-visibility yellow for reference marks over the same imagery:
 * legibility over unpredictable photography, not decoration.
 */
const SATELLITE_PERIOD_EXTENT_COLOURS: PeriodExtentColours = {
  fill: '#9a3b22',
  line: '#5c2013',
}

/**
 * Which wash the extent fill draws in, keyed to the basemap it sits over —
 * not the reader's theme, the same "follows the sheet" reasoning
 * `resolveSheetTone` already documents. `usePeriodOverlay` calls this fresh
 * on every attach, so switching basemaps while the scrubber is on (which
 * tears down and rebuilds every overlay via `styledata`, same as every
 * other overlay in this file) picks up the right palette automatically.
 */
export const resolvePeriodExtentColours = (view: BasemapView): PeriodExtentColours => {
  if (view === 'antiquity-dare') return DARE_PERIOD_EXTENT_COLOURS
  if (view === 'satellite') return SATELLITE_PERIOD_EXTENT_COLOURS
  return PERIOD_EXTENT_COLOURS
}

/**
 * The frontier's own palette. Only two colours, and one of them is the accent
 * the rest of the interface spends once per screen.
 */
/**
 * One line layer per kind, because `line-dasharray` is not data-driven.
 *
 * A `match` on the feature's kind is the obvious way to write this and MapLibre
 * accepts the style without complaint — `line-dasharray` is a cross-faded
 * property, so a data expression is simply ignored and every stretch comes out
 * solid. Three layers is the supported form, and it also makes the ordering
 * explicit: the built barriers draw last and win where a wall meets a river.
 */
const LIMES_LINE_KINDS: { kind: LimesSegmentKind; dashes: [number, number] | null }[] = [
  /** A line the sources agree on with no structure to point at. */
  { kind: 'notional', dashes: [1.6, 1.4] },
  /** Held from the bank, not built across: a long dash reads as a patrol, not a wall. */
  { kind: 'river', dashes: [4, 1.6] },
  /** A rampart, a palisade, a ditch. The only one drawn solid. */
  { kind: 'barrier', dashes: null },
]

const LIMES_COLOURS = {
  /** Oxide red. The frontier, and on this view the only thing wearing it. */
  line: '#9a3b22',
  /**
   * The casing under it. Paper rather than white: the line crosses sea, land,
   * hillshade and urban fill along its length, and a casing that matches the
   * sheet reads as the line being lifted off the page rather than as a second
   * line drawn beside it.
   */
  casing: '#faf7ef',
  label: '#7a2d19',
  labelHalo: '#faf7ef',
}

/**
 * The frontier, drawn over the atlas sheet.
 *
 * ## Three kinds, three treatments
 *
 * The map would be lying if it drew a river the way it draws a wall. A
 * `barrier` is a built work and gets the solid line; a `river` frontier was a
 * watercourse patrolled from its bank, so it gets a long dash that reads as
 * "held, not built"; a `notional` frontier is a line the sources agree on with
 * no structure to point at, and gets a short dash that reads as an assertion
 * rather than a thing. All three are the same colour and weight, because they
 * are the same frontier.
 *
 * ## Why a casing
 *
 * Without one the line disappears wherever it crosses a road of similar weight
 * — which, on the Rhine and the Danube, is most of its length, since the road
 * that supplied a frontier runs along it. The casing is what makes it
 * followable at a glance instead of traceable with effort.
 *
 * Exported for `useLimesOverlay`, which is what actually adds these layers to
 * the map now — the frontier is drawn as a generic overlay above whichever
 * basemap is showing, not baked into the Barrington style. `limes-installations`
 * reads the `atlas` source and is only meaningful there; `useLimesOverlay`
 * skips it when that source is not present.
 */
export const buildLimesLayers = (): LayerSpecification[] => [
  {
    id: 'limes-frontier-casing',
    type: 'line',
    source: 'limes',
    'source-layer': 'frontier',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': LIMES_COLOURS.casing,
      'line-opacity': 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4.5, 8, 7, 14, 11],
    },
  },
  ...LIMES_LINE_KINDS.map(({ kind, dashes }): LayerSpecification => ({
    id: `limes-frontier-${kind}`,
    type: 'line',
    source: 'limes',
    'source-layer': 'frontier',
    filter: ['==', ['get', 'kind'], kind],
    layout: { 'line-cap': dashes ? 'butt' : 'round', 'line-join': 'round' },
    paint: {
      'line-color': LIMES_COLOURS.line,
      /**
       * A built work outweighs a line inferred from the edge of a province, and
       * the two run side by side for most of Britain and the Rhine — the wall,
       * and the boundary a few kilometres behind it. Given equal weight they
       * read as two frontiers, which is one more than there was.
       */
      'line-opacity': kind === 'barrier' ? 1 : 0.62,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        kind === 'barrier' ? 2.2 : 1.6,
        8,
        kind === 'barrier' ? 3.4 : 2.4,
        14,
        kind === 'barrier' ? 6 : 4,
      ],
      ...(dashes ? { 'line-dasharray': dashes } : {}),
    },
  })),
  /**
   * The name, written along the line rather than beside it.
   *
   * `symbol-placement: 'line'` is the whole reason a reader can tell which
   * frontier they are following without opening anything: the label bends with
   * the Danube, so it belongs to the river visibly rather than by proximity.
   */
  {
    id: 'limes-frontier-labels',
    type: 'symbol',
    source: 'limes',
    'source-layer': 'frontier',
    minzoom: 5,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 320,
      'text-field': ['get', 'sector_name'],
      'text-font': [MAP_LABEL_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 12, 13],
      'text-letter-spacing': 0.08,
      'text-max-angle': 35,
      'text-padding': 6,
    },
    paint: {
      'text-color': LIMES_COLOURS.label,
      'text-halo-color': LIMES_COLOURS.labelHalo,
      'text-halo-width': 1.6,
    },
  },
  /**
   * Borrowed military places, promoted out of the sheet's general annotation.
   *
   * Still drawn as annotation — thin line, no disc — because they are still
   * Pleiades and not contributions. What changes is that they get the frontier's
   * own plan marks instead of the generic crenellation, and they stop competing
   * with the two thousand villas and sanctuaries around them: this layer is
   * above the frontier line, so a tower on the wall wins the collision against
   * a name in the hinterland.
   */
  {
    id: 'limes-installations',
    type: 'symbol',
    source: 'atlas',
    'source-layer': 'places',
    minzoom: 7,
    filter: ['all', ['get', 'military'], ['has', 'mark']],
    layout: {
      'icon-image': buildLimesReferenceIconExpression(),
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 11, 1, 14, 1.2],
      'icon-optional': true,
      'text-field': ['get', 'title'],
      'text-font': [MAP_LABEL_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 7, 9, 14, 12],
      'text-anchor': 'top',
      'text-offset': [0, 0.6],
      'text-max-width': 8,
      'text-padding': 4,
    },
    paint: {
      'text-color': ATLAS_COLOURS.label,
      'text-halo-color': ATLAS_COLOURS.labelHalo,
      'text-halo-width': 1.2,
    },
  },
]

/**
 * How far back the sheet steps when the frontier is switched on.
 *
 * The house rule is one accent per screen and never decoratively. On this view
 * the frontier is the one thing being asserted, so it takes the oxide red and
 * everything else has to make room: the roads, the places and the urban fills
 * are still there to be read, at the weight of context rather than of subject.
 */
const LIMES_RECESSION = 0.42

/**
 * The antiquity atlas, drawn from this project's own vector tiles.
 *
 * Order is the whole trick with a sheet assembled from separate sources: sea
 * over the paper background, then the coastline drawn as a line on top of it so
 * the edge stays crisp where the simplified polygons and the shoreline linework
 * disagree, then the built things, then the names.
 *
 * A road whose course Barrington records as inferred rather than established is
 * dashed. That distinction is in the data and the map has no business flattening
 * it — a solid line here would be the atlas asserting more than its source does.
 *
 * ## The frontier
 *
 * The frontier line itself is no longer drawn here — see `useLimesOverlay` —
 * because it now has to be drawable over any basemap, not only this one. What
 * stays is what this sheet does to make room for it: the rest of the atlas
 * recedes (`LIMES_RECESSION`) and the general place layer stops drawing the
 * military places the frontier's own layer draws instead, so `options.limes`
 * survives as a flag this style still reads, just no longer one that adds a
 * source or layers of its own. The layers a reader sees with the switch off
 * must be exactly the layers they saw before it existed — which is a thing a
 * test can assert only while there is one function.
 *
 * ## The period scrubber
 *
 * Like the frontier, the extent-over-time fill is no longer baked into this
 * style either — see `buildPeriodExtentLayers` and `usePeriodOverlay`. It
 * used to be a `null`-gated field on this style's own options, shown only
 * while the Barrington sheet was the active view; now it draws over any
 * basemap, the same generalisation the frontier went through first.
 */
interface AtlasStyleOptions {
  limes: boolean
}

const buildAtlasStyle = (
  source: BasemapSource,
  options: AtlasStyleOptions,
): StyleSpecification => ({
  version: 8,
  glyphs: source.glyphsUrl,
  sources: {
    atlas: {
      type: 'vector',
      tiles: [`${source.atlasTilesUrl}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: ATLAS_ATTRIBUTION,
    },
    /**
     * Relief, from the elevation tiles the terrain view already uses.
     *
     * The obvious source would have been CAWM's raster sheet, which is exactly
     * this and nothing else — but that is 3.2 GB and thirty thousand requests
     * to a university server for imagery carrying no information we do not
     * already draw. A modern DEM answers the same question: the Apennines have
     * not moved, and where the ground has changed — a silted harbour, a shifted
     * delta — it is the coastline that records it, and that comes from AWMC.
     */
    terrain: {
      type: 'raster-dem',
      tiles: [resolveTerrainUrl(source)],
      encoding: 'terrarium',
      // Mapterhorn's tiles are 512px, not the 256px the AWS mirror served.
      // Wrong here and the hillshade decodes at half resolution silently —
      // MapLibre does not error on a size mismatch, it just samples wrong.
      tileSize: 512,
      maxzoom: 13,
      attribution: 'Elevation: Mapterhorn (Copernicus GLO-30)',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': ATLAS_COLOURS.land } },
    // Under the water, so the sea reads as a flat wash rather than a shaded
    // seabed, and well under the linework.
    {
      id: 'atlas-hillshade',
      type: 'hillshade',
      source: 'terrain',
      paint: {
        'hillshade-exaggeration': 0.32,
        'hillshade-shadow-color': '#9c9179',
        'hillshade-highlight-color': '#faf7ef',
      },
    },
    {
      id: 'atlas-sea',
      type: 'fill',
      source: 'atlas',
      'source-layer': 'water',
      filter: ['==', ['get', 'kind'], 'sea'],
      paint: { 'fill-color': ATLAS_COLOURS.sea },
    },
    {
      id: 'atlas-inland-water',
      type: 'fill',
      source: 'atlas',
      'source-layer': 'water',
      filter: ['==', ['get', 'kind'], 'inland'],
      paint: { 'fill-color': ATLAS_COLOURS.inland },
    },
    {
      id: 'atlas-urban',
      type: 'fill',
      source: 'atlas',
      'source-layer': 'areas',
      filter: ['==', ['get', 'kind'], 'urban'],
      paint: {
        'fill-color': ATLAS_COLOURS.urban,
        'fill-opacity': options.limes ? 0.85 * LIMES_RECESSION : 0.85,
      },
    },
    /**
     * Centuriation blocks — a much fainter fill than urban areas, and its
     * own outline: these are field grids, not settlements, and the fill
     * above only reads as a city because `atlas-urban` was, until this
     * layer's own `kind` filter was added, drawing every polygon in the
     * `areas` layer regardless of what it actually was.
     */
    {
      id: 'atlas-centuriation-blocks',
      type: 'fill',
      source: 'atlas',
      'source-layer': 'areas',
      filter: ['==', ['get', 'kind'], 'centuriation'],
      paint: { 'fill-color': ATLAS_COLOURS.infrastructure, 'fill-opacity': 0.06 },
    },
    {
      id: 'atlas-centuriation-lines',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: ['==', ['get', 'kind'], 'centuriation'],
      paint: {
        'line-color': ATLAS_COLOURS.infrastructure,
        'line-opacity': 0.5,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.3, 14, 0.8],
      },
    },
    {
      id: 'atlas-coast',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: ['==', ['get', 'kind'], 'shoreline'],
      paint: {
        'line-color': ATLAS_COLOURS.coast,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 12, 1.2],
      },
    },
    {
      id: 'atlas-infrastructure',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: [
        'in',
        ['get', 'kind'],
        ['literal', ['aqueduct', 'canal', 'wall', 'causeway', 'dike_levee']],
      ],
      paint: {
        'line-color': ATLAS_COLOURS.infrastructure,
        'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 14, 2.4],
      },
    },
    {
      id: 'atlas-roads-inferred',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: ['all', ['==', ['get', 'kind'], 'road'], ['!', ['get', 'certain']]],
      paint: {
        'line-color': ATLAS_COLOURS.road,
        'line-dasharray': [2, 2],
        'line-opacity': options.limes ? LIMES_RECESSION : 1,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 14, 2],
      },
    },
    {
      id: 'atlas-roads',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: ['all', ['==', ['get', 'kind'], 'road'], ['get', 'certain']],
      paint: {
        'line-color': ['case', ['get', 'major'], ATLAS_COLOURS.roadMajor, ATLAS_COLOURS.road],
        'line-opacity': options.limes ? LIMES_RECESSION : 1,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          ['case', ['get', 'major'], 0.9, 0.5],
          14,
          ['case', ['get', 'major'], 3.2, 1.8],
        ],
      },
    },
    /**
     * A mark for every place the source classifies, and a name for the rest.
     *
     * One symbol layer rather than a mark layer plus a label layer: MapLibre
     * lays out the icon and its text as a single collision unit that way, so a
     * label can never be separated from the mark it belongs to — which is what
     * happens when a place is crowded out at the edge of a tile.
     *
     * `icon-optional` is what lets the landscape features through. Their icon
     * expression yields an empty string, and without this MapLibre treats a
     * symbol with no icon as unplaceable and drops the name with it.
     */
    {
      id: 'atlas-places',
      type: 'symbol',
      source: 'atlas',
      'source-layer': 'places',
      minzoom: 6,
      /**
       * While the frontier is showing, the military places are drawn by
       * `limes-installations` with their own plan marks. Without this filter
       * they are drawn by both layers and every tower on the wall carries a
       * crenellation and a plan stacked on the same point.
       */
      ...(options.limes
        ? {
            filter: ['!', ['all', ['get', 'military'], ['has', 'mark']]] as FilterSpecification,
          }
        : {}),
      layout: {
        'icon-image': buildAtlasIconExpression(),
        'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.45, 9, 0.75, 13, 1],
        'icon-optional': true,
        'text-field': ['get', 'title'],
        'text-font': [MAP_LABEL_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 9, 14, 13],
        'text-anchor': 'top',
        'text-offset': [0, 0.6],
        'text-max-width': 8,
        'text-padding': 4,
      },
      paint: {
        'text-color': ATLAS_COLOURS.label,
        'text-halo-color': ATLAS_COLOURS.labelHalo,
        'text-halo-width': 1.2,
        'text-opacity': options.limes ? 0.55 : 1,
        'icon-opacity': options.limes ? 0.5 : 1,
      },
    },
    {
      id: 'atlas-region-labels',
      type: 'symbol',
      source: 'atlas',
      'source-layer': 'regions',
      layout: {
        'text-field': ['get', 'title'],
        'text-font': [MAP_LABEL_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 9, 15],
        'text-letter-spacing': 0.18,
        'text-transform': 'uppercase',
        'text-max-width': 9,
      },
      paint: {
        'text-color': ATLAS_COLOURS.regionLabel,
        'text-halo-color': ATLAS_COLOURS.labelHalo,
        'text-halo-width': 1.4,
      },
    },
  ],
})

/**
 * The empire's extent at a given date, drawn as an overlay above whichever
 * basemap is showing — no longer a reading of the Barrington sheet in
 * particular. It used to live inside `buildAtlasStyle`, gated to
 * `antiquity-awmc`, on the reasoning that the three dates AWMC once published
 * were "a property of that sheet's own data". The scrubber's source is now
 * OpenHistoricalMap's own dated series (`useEmpirePeriods`), which carries its
 * own coordinates and licence independent of the Barrington import — a fill
 * that makes just as much sense over DARE, satellite or the modern sheet, the
 * same generalisation `buildLimesLayers`/`useLimesOverlay` went through first.
 *
 * Drawn under the urban/road linework of whichever sheet is showing, same
 * ordering intent as before: a city or a route should still read as itself
 * rather than being tinted by the wash under it. `usePeriodOverlay` adds
 * these two layers on top of the rendered map, after everything the basemap
 * style itself already drew.
 *
 * `colours` defaults to the standard wash; `usePeriodOverlay` resolves it
 * per basemap via `resolvePeriodExtentColours` before calling this, so DARE
 * and satellite get their own higher-contrast palette instead.
 */
export const buildPeriodExtentLayers = (
  colours: PeriodExtentColours = PERIOD_EXTENT_COLOURS,
): LayerSpecification[] => [
  {
    id: 'atlas-period-extent',
    type: 'fill',
    source: 'atlas-period',
    'source-layer': 'extent',
    paint: { 'fill-color': colours.fill, 'fill-opacity': 0.22 },
  },
  {
    id: 'atlas-period-extent-outline',
    type: 'line',
    source: 'atlas-period',
    'source-layer': 'extent',
    paint: {
      'line-color': colours.line,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 1.4],
    },
  },
]

export const buildBasemapStyle = (request: StyleRequest): StyleSpecification => {
  if (request.view === 'antiquity-dare') return buildDareStyle(request.source)
  if (request.view === 'antiquity-awmc') {
    return buildAtlasStyle(request.source, { limes: request.isFollowingLimes === true })
  }
  if (request.view === 'satellite') return buildSatelliteStyle(request.source)

  const colours = request.isDark ? DARK_COLOURS : LIGHT_COLOURS

  if (request.source.provider === 'pmtiles') registerPmtilesProtocol()

  return {
    version: 8,
    glyphs: request.source.glyphsUrl,
    sources: { basemap: buildVectorSource(request.source) },
    layers: buildBasemapLayers(colours, QUIET_ROAD_OPACITY, resolveModernSchema(request.source)),
  }
}

export const BASEMAP_VIEWS: BasemapOption[] = [
  { value: 'vestigian', group: 'today', label: 'Vestigian', hint: 'Antiquity foregrounded' },
  { value: 'satellite', group: 'today', label: 'Satellite', hint: 'Sentinel-2 imagery' },
  {
    value: 'antiquity-dare',
    group: 'antiquity',
    label: 'Antiquity (DARE)',
    hint: 'Digital Atlas of the Roman Empire',
  },
  {
    value: 'antiquity-awmc',
    group: 'antiquity',
    label: 'Antiquity (Barrington)',
    hint: 'Roads, peoples and places, drawn here',
  },
]

export const BASEMAP_GROUP_LABELS: Record<BasemapGroup, string> = {
  today: 'Today',
  antiquity: 'Antiquity',
}

/**
 * The scrubber's stops are no longer a constant — there are 51 of them, they
 * come from the imported series, and they change when OpenHistoricalMap's
 * contributors refine a boundary. `useEmpirePeriods()` fetches them; the
 * index-domain reasoning that governed the old three-date constant still
 * holds and now matters far more, since the gaps run from one year (116→117)
 * to 171 (-509→-338). A slider tracking the year itself would give the
 * Republic's first two centuries a single pixel.
 */

/**
 * Switching a MapLibre style replaces every source and layer, which would take
 * the site overlay with it. The overlay is therefore re-attached on the
 * styledata event that follows each swap, and the camera is left untouched so
 * the switch is visually a recolour rather than a reload.
 */
export const useBasemapStyle = () => {
  const config = useRuntimeConfig()
  const colorMode = useColorMode()
  const view = useState<BasemapView>('basemap-view', () => 'vestigian')

  /**
   * Tile URLs have to be absolute.
   *
   * MapLibre builds its tile requests inside a web worker, where a root-relative
   * path has no document to resolve against — `new Request('/api/tiles/...')`
   * throws "Failed to parse URL" and the source silently loads nothing while
   * the rest of the style renders normally. `useViewportTiles` already carries
   * the same workaround for the site overlay.
   *
   * `window` is not available while the style is first evaluated during SSR, so
   * the configured public site URL stands in; the value is only ever used by
   * the client, which re-evaluates with the real origin.
   */
  const origin = import.meta.client ? window.location.origin : config.public.siteUrl

  const absolute = (value: string): string =>
    value.startsWith('http') ? value : `${origin}${value}`

  const source = computed<BasemapSource>(() => ({
    provider: config.public.basemap.provider as BasemapSource['provider'],
    pmtilesUrl: config.public.basemap.pmtilesUrl,
    terrainUrl: config.public.basemap.terrainUrl,
    antiquityDareUrl: config.public.basemap.antiquityDareUrl,
    satelliteUrl: config.public.basemap.satelliteUrl,
    atlasTilesUrl: absolute(config.public.basemap.atlasTilesUrl),
    limesTilesUrl: absolute(config.public.basemap.limesTilesUrl),
    empireExtentTilesUrl: absolute(config.public.basemap.empireExtentTilesUrl),
    battleTilesUrl: absolute(config.public.basemap.battleTilesUrl),
    portTilesUrl: absolute(config.public.basemap.portTilesUrl),
    routeTilesUrl: absolute(config.public.basemap.routeTilesUrl),
    featureTilesUrl: absolute(config.public.basemap.featureTilesUrl),
    coinHoardTilesUrl: absolute(config.public.basemap.coinHoardTilesUrl),
    inscriptionTilesUrl: absolute(config.public.basemap.inscriptionTilesUrl),
    atticInscriptionTilesUrl: absolute(config.public.basemap.atticInscriptionTilesUrl),
    glyphsUrl: config.public.basemap.glyphsUrl,
  }))

  const isDark = computed(() => colorMode.value === 'dark')

  const sheetTone = computed(() => resolveSheetTone(view.value, isDark.value))

  /**
   * An overlay, not a reading of one particular sheet.
   *
   * Originally constrained to the Barrington view, on the reasoning that a
   * frontier drawn against present-day motorways would assert a continuity
   * that is not there — but the frontier line itself carries its own dates
   * and reads as an assertion on any sheet, exactly the way the Tabula
   * Peutingeriana overlay or a contributed tracing does, and `useLimesOverlay`
   * now draws it the same way that overlay is drawn: above whichever basemap
   * is showing, not baked into one vector style. `canFollowLimes` is kept as a
   * named export, always true, so callers do not have to know that history.
   *
   * Not persisted, like `view`. The camera hash stays the only durable map
   * state, so a shared link opens on the reader's own choice of sheet.
   */
  const isLimesActive = useState<boolean>('limes-active', () => false)

  const canFollowLimes = computed(() => true)

  const isFollowingLimes = computed(() => isLimesActive.value)

  /**
   * The period scrubber — like the frontier, an overlay drawn on any basemap
   * now (see `buildPeriodExtentLayers`/`usePeriodOverlay`), not a reading of
   * the Barrington sheet specifically. Unlike the other overlays here, there
   * is no `canShow*`/`isShowing*` pair: `PeriodSwitcher` is a slider, not a
   * toggle gated on a boolean, and nothing constrains it to one basemap any
   * more for a `canShow*` flag to carry. `null` is the scrubber's default
   * "off" position — no extent source is added anywhere until a reader
   * actually moves it. Not persisted, same reasoning as `isLimesActive`.
   */
  const periodYear = useState<number | null>('atlas-period-year', () => null)

  /**
   * The Tabula Peutingeriana network — unlike the limes, an overlay drawn on
   * top of *any* basemap rather than baked into one vector style, since it is
   * a plain `geojson` source layered above whatever sheet is showing (see
   * `useTabulaPeutingerianaOverlay`), not a reading of one antiquity sheet in
   * particular.
   *
   * `canShow` reflects the server-side gate — the source data states no
   * licence, so `NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED` must be turned on
   * deliberately (see `nuxt.config.ts`) before the toggle is even offered.
   * Not persisted, for the same reason `isLimesActive` is not.
   */
  const isTabulaPeutingerianaOverlayActive = useState<boolean>(
    'tabula-peutingeriana-overlay-active',
    () => false,
  )

  const canShowTabulaPeutingerianaOverlay = computed(
    () => config.public.tabulaPeutingerianaEnabled === true,
  )

  const isShowingTabulaPeutingerianaOverlay = computed(
    () => canShowTabulaPeutingerianaOverlay.value && isTabulaPeutingerianaOverlayActive.value,
  )

  const setTabulaPeutingerianaOverlayActive = (next: boolean): void => {
    isTabulaPeutingerianaOverlayActive.value = next
  }

  /**
   * An overlay on any basemap, like the frontier — a battle's date and
   * location are facts about the world, not a reading of one particular
   * sheet. `canShowBattles` is kept as a named export, always true, for the
   * same reason `canFollowLimes` is: so `BasemapSwitcher` does not need to
   * know that either overlay could in principle have been sheet-specific.
   * Not persisted, same reasoning as `isLimesActive`.
   */
  const isBattlesActive = useState<boolean>('battles-active', () => false)

  const canShowBattles = computed(() => true)

  const isShowingBattles = computed(() => isBattlesActive.value)

  const setBattlesActive = (next: boolean): void => {
    isBattlesActive.value = next
  }

  /**
   * Off by default: the vici-sourced site/tracing overlay is the one layer
   * that was still requesting tiles on every first visit regardless of what
   * the reader actually wanted to look at. `canShowSites` mirrors
   * `canFollowLimes`'s shape (always true) for the same reason. Not
   * persisted, same reasoning as `isLimesActive` — a shared link should not
   * silently carry a previous visitor's choice to hide the atlas's own data.
   */
  const isSitesActive = useState<boolean>('sites-active', () => false)

  const canShowSites = computed(() => true)

  const isShowingSites = computed(() => isSitesActive.value)

  const setSitesActive = (next: boolean): void => {
    isSitesActive.value = next
  }

  /**
   * An overlay on any basemap, like the frontier and battles above — a
   * port's location is a fact about the world, not a reading of one
   * particular sheet. `canShowPorts` mirrors `canShowBattles`'s shape
   * (always true) for the same reason. Not persisted, same reasoning as
   * `isLimesActive`.
   */
  const isPortsActive = useState<boolean>('ports-active', () => false)

  const canShowPorts = computed(() => true)

  const isShowingPorts = computed(() => isPortsActive.value)

  const setPortsActive = (next: boolean): void => {
    isPortsActive.value = next
  }

  /**
   * Same shape again, for the ORBIS route network.
   */
  const isRoutesActive = useState<boolean>('routes-active', () => false)

  const canShowRoutes = computed(() => true)

  const isShowingRoutes = computed(() => isRoutesActive.value)

  const setRoutesActive = (next: boolean): void => {
    isRoutesActive.value = next
  }

  /**
   * Same shape again, for AWMC's minor point features.
   */
  const isFeaturesActive = useState<boolean>('features-active', () => false)

  const canShowFeatures = computed(() => true)

  const isShowingFeatures = computed(() => isFeaturesActive.value)

  const setFeaturesActive = (next: boolean): void => {
    isFeaturesActive.value = next
  }

  /**
   * Same shape again, for CHRR coin-hoard findspots.
   */
  const isCoinHoardsActive = useState<boolean>('coin-hoards-active', () => false)

  const canShowCoinHoards = computed(() => true)

  const isShowingCoinHoards = computed(() => isCoinHoardsActive.value)

  const setCoinHoardsActive = (next: boolean): void => {
    isCoinHoardsActive.value = next
  }

  /**
   * Same shape again, for mirrored EDH inscriptions. Off by default like
   * every reference overlay here — `.claude/rules/epigraphy.md` puts the
   * geometry-bearing subset at 13,388 rows, the same order of magnitude as
   * ports (6,007, drawn unclustered), so a plain symbol layer is enough.
   */
  const isInscriptionsActive = useState<boolean>('inscriptions-active', () => false)

  const canShowInscriptions = computed(() => true)

  const isShowingInscriptions = computed(() => isInscriptionsActive.value)

  const setInscriptionsActive = (next: boolean): void => {
    isInscriptionsActive.value = next
  }

  /**
   * Same shape again, for Attic Inscriptions Online — a second, smaller
   * corpus (`.claude/rules/epigraphy.md`), its own toggle rather than
   * folded into "Show inscriptions" since the two draw from separate
   * tables with no shared row identity.
   */
  const isAtticInscriptionsActive = useState<boolean>('attic-inscriptions-active', () => false)

  const canShowAtticInscriptions = computed(() => true)

  const isShowingAtticInscriptions = computed(() => isAtticInscriptionsActive.value)

  const setAtticInscriptionsActive = (next: boolean): void => {
    isAtticInscriptionsActive.value = next
  }

  const currentStyle = computed(() =>
    buildBasemapStyle({
      view: view.value,
      isDark: isDark.value,
      source: source.value,
      isFollowingLimes: isFollowingLimes.value,
    }),
  )

  const setView = (next: BasemapView): void => {
    view.value = next
  }

  const setLimesActive = (next: boolean): void => {
    isLimesActive.value = next
  }

  const setPeriodYear = (next: number | null): void => {
    periodYear.value = next
  }

  return {
    view,
    setView,
    currentStyle,
    isDark,
    sheetTone,
    availableViews: BASEMAP_VIEWS,
    canFollowLimes,
    isFollowingLimes,
    setLimesActive,
    limesTilesUrl: computed(() => source.value.limesTilesUrl),
    periodYear,
    setPeriodYear,
    empireExtentTilesUrl: computed(() => source.value.empireExtentTilesUrl),
    canShowTabulaPeutingerianaOverlay,
    isShowingTabulaPeutingerianaOverlay,
    setTabulaPeutingerianaOverlayActive,
    canShowBattles,
    isShowingBattles,
    setBattlesActive,
    battleTilesUrl: computed(() => source.value.battleTilesUrl),
    canShowSites,
    isShowingSites,
    setSitesActive,
    canShowPorts,
    isShowingPorts,
    setPortsActive,
    portTilesUrl: computed(() => source.value.portTilesUrl),
    canShowRoutes,
    isShowingRoutes,
    setRoutesActive,
    routeTilesUrl: computed(() => source.value.routeTilesUrl),
    canShowFeatures,
    isShowingFeatures,
    setFeaturesActive,
    featureTilesUrl: computed(() => source.value.featureTilesUrl),
    canShowCoinHoards,
    isShowingCoinHoards,
    setCoinHoardsActive,
    coinHoardTilesUrl: computed(() => source.value.coinHoardTilesUrl),
    canShowInscriptions,
    isShowingInscriptions,
    setInscriptionsActive,
    inscriptionTilesUrl: computed(() => source.value.inscriptionTilesUrl),
    canShowAtticInscriptions,
    isShowingAtticInscriptions,
    setAtticInscriptionsActive,
    atticInscriptionTilesUrl: computed(() => source.value.atticInscriptionTilesUrl),
  }
}
