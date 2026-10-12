import { Protocol } from 'pmtiles'
import { addProtocol } from 'maplibre-gl'
import type {
  FilterSpecification,
  LayerSpecification,
  LineLayerSpecification,
  RasterDEMSourceSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl'
// Imported explicitly rather than through Nuxt's auto-imports: this is called
// while the style is built, so the unit tests — which import this module
// directly — would otherwise fail on an undefined reference that the running
// application never sees.
import {
  MARKER_ICON_SIZE,
  buildAtlasIconExpression,
  buildLimesReferenceIconExpression,
} from './useSiteIcons'
import type {
  BasemapGroup,
  BasemapOption,
  BasemapSheetTone,
  BasemapSource,
  BasemapView,
  LimesSegmentKind,
} from '#shared/types'
import type { ReferenceOverlayId } from '#shared/utils/reference-overlays'

let protocolRegistered = false

/**
 * PMTiles is read straight from object storage over HTTP range requests, so no
 * tile server process exists to run, scale or pay for. The protocol handler has
 * to be registered on MapLibre once per page, before any style referencing it.
 *
 * Exported so `useModernLabelsOverlay.ts` can register it too — that overlay
 * adds a `pmtiles://` vector source of its own, imperatively, outside
 * `buildBasemapStyle`.
 */
export const registerPmtilesProtocol = (): void => {
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
 * The shallowest zoom either raster mirror holds — `MIN_ZOOM` in
 * `scripts/import/04-mirror-basemap-tiles.ts` must agree. The satellite source
 * used to declare `minzoom: 0`, which was harmless against EOX's live server
 * (it serves z0) and a 404 for z0–2 the moment a mirror is configured. The map
 * itself goes down to z2, so those two levels now show the paper ground rather
 * than a request for tiles that do not exist.
 */
const RASTER_MIRROR_MIN_ZOOM = 3

/**
 * The AWMC sheet is ours to draw, not someone else's to borrow.
 *
 * The CAWM tile server publishes only physical relief — no roads, no names, no
 * settlements — so mirroring it would have produced a beautiful empty map. The
 * information that makes it an atlas is published separately as open data, and
 * `/api/tiles/antiquity` now serves it from this project's own PostGIS: AWMC's
 * Barrington-derived geodata under ODbL 1.0 and Pleiades places under CC BY 3.0.
 */
export const ATLAS_ATTRIBUTION =
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
  'Frontier: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL), <a href="https://www.openhistoricalmap.org/copyright" target="_blank" rel="noopener">OpenHistoricalMap</a>, <a href="https://vici.org" target="_blank" rel="noopener">vici.org</a>; dashed: derived from <a href="https://github.com/AWMC/geodata" target="_blank" rel="noopener">Ancient World Mapping Center</a>'

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
  'Coin hoards: <a href="https://numismatics.org/chrr/" target="_blank" rel="noopener">Coin Hoards of the Roman Republic</a>, American Numismatic Society (CC BY-NC-SA 4.0)'

export const INSCRIPTION_ATTRIBUTION =
  'Inscriptions: <a href="https://edh.ub.uni-heidelberg.de/" target="_blank" rel="noopener">Epigraphic Database Heidelberg</a> (CC BY-SA 4.0)'

export const ATTIC_INSCRIPTION_ATTRIBUTION =
  'Attic inscriptions: <a href="https://www.atticinscriptions.com/" target="_blank" rel="noopener">Attic Inscriptions Online</a> (CC BY-SA 3.0)'

export const TABULA_PEUTINGERIANA_ATTRIBUTION =
  'Tabula Peutingeriana network compiled by René Voorburg, <a href="https://omnesviae.org" target="_blank" rel="noopener">omnesviae.org</a>'

export const ROMAN_ROAD_ATTRIBUTION =
  'Roman roads: <a href="https://itiner-e.org" target="_blank" rel="noopener">Itiner-e</a>, Brughmans, Pažout, de Soto &amp; Bjerregaard Vahlstrup (CC BY 4.0)'

export const MINT_ATTRIBUTION =
  'Mints: <a href="https://nomisma.org" target="_blank" rel="noopener">Nomisma.org</a> (CC BY 3.0)'

export const MONUMENT_ATTRIBUTION =
  'Monuments: <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> (CC0 1.0)'

export const ISICILY_ATTRIBUTION =
  'Sicilian inscriptions: <a href="https://isicily.org" target="_blank" rel="noopener">I.Sicily</a> (CC BY 4.0)'

export const HILLFORT_ATTRIBUTION =
  'Hillforts: <a href="https://doi.org/10.5284/1118744" target="_blank" rel="noopener">Atlas of Hillforts</a>, Ralston &amp; Lock, via the Archaeology Data Service (CC BY 4.0)'

export const POLITY_ATTRIBUTION =
  'Neighbouring realms: <a href="https://seshat-db.com" target="_blank" rel="noopener">Seshat Cliopatria</a> (CC BY 4.0)'

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
  if (isAntiquityView(view) || view === 'satellite' || view === 'osm-standard') return 'light'
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
 *
 * Exported so `useModernLabelsOverlay.ts` can draw its labels in the same
 * ink — DARE and Barrington are both forced to the light tone by
 * `resolveSheetTone`, same reasoning as satellite below.
 */
export const LIGHT_COLOURS: StyleColours = {
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

/** Exported so `useModernLabelsOverlay.ts` can add the same source imperatively. */
export const buildVectorSource = (source: BasemapSource) =>
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

export interface ModernSchema {
  building: string
  transportation: string
  boundary: string
  place: string
  majorRoadFilter: FilterSpecification
  minorRoadFilter: FilterSpecification
  boundaryFilter: FilterSpecification
  /**
   * Vegetation fields, read by `buildOsmStandardStyle` only — `vestigian`/
   * `satellite` have no use for a forest/grass distinction and keep reading
   * the single generic `landuse` wash. `landcover` is a *different source-
   * layer per provider*, not just a differently-named one: OpenMapTiles
   * carries a dedicated `landcover` layer at every zoom, but Protomaps'
   * own `landcover` layer only goes to z7 (continental scale, per
   * docs.protomaps.com/basemaps/layers) — its `landuse` layer is what
   * actually carries `kind: 'forest'`/`'wood'`/`'grass'`/etc. at the zooms
   * this atlas is read at, so Protomaps reads vegetation from `landuse`
   * instead, same source-layer the generic wash already reads.
   */
  landcover: string
  forestFilter: FilterSpecification
  vegetationFilter: FilterSpecification
  motorwayFilter: FilterSpecification
  primaryFilter: FilterSpecification
  secondaryFilter: FilterSpecification
  localRoadFilter: FilterSpecification
  /**
   * Rivers and streams narrow enough that OSM carries them as a line, not a
   * polygon — without this a river reads as a visible gap in `osm-standard`
   * exactly where the real OSM-Carto render (what `vici.org` itself mirrors)
   * draws its most recognisable blue thread. **A different source-layer per
   * provider, not a filter difference**: OpenMapTiles keeps these in their
   * own `waterway` layer, nothing to filter out. Protomaps' own docs
   * (docs.protomaps.com/basemaps/layers) say its `water` layer carries
   * "polygons, lines and point labels" together in one layer, so
   * `waterwayFilter` has to pick the lines out by geometry. It cannot go by
   * `kind_detail` alone: measured against the production archive, the
   * LineString features carry `kind: river|canal|stream` and **no**
   * `kind_detail`, while the river *polygons* carry `kind: water` plus
   * `kind_detail: river` — a `kind_detail` filter selected exactly the
   * polygons, drew their outlines, and missed the lines.
   */
  waterwayLayer: string
  waterwayFilter?: FilterSpecification
  /**
   * Named-feature labels, read by `buildOsmStandardStyle`'s label layers
   * only. Checked against each provider's real schema before relying on it
   * (`openmaptiles/openmaptiles`'s own `layers/*.yaml`,
   * docs.protomaps.com/basemaps/layers) rather than assumed from the layers
   * already drawn:
   *
   * - **Peaks carry no elevation in Protomaps at all** — its `pois` layer
   *   has a `kind: 'peak'` and a name, nothing else; OpenMapTiles'
   *   `mountain_peak` layer does carry `ele`/`ele_ft`. On request, this
   *   view shows a name only, in both providers, specifically so the two
   *   don't visibly disagree — not a schema limitation forcing the choice,
   *   a deliberate one once the limitation was found.
   * - **`transportation`/`roads` (the line geometry layers already drawn)
   *   carry no `name` field in OpenMapTiles** — confirmed directly against
   *   the real OpenFreeMap TileJSON, not assumed from Protomaps agreeing —
   *   road names live in OpenMapTiles' separate `transportation_name`
   *   layer. Protomaps has no equivalent second layer; `name` sits
   *   directly on `roads` via its common-tag schema, so `roadNameLayer` is
   *   the same source-layer `transportation`/`roads` already reads for
   *   geometry, not a second one.
   * - **Lake/sea names are a separate `water_name` layer in OpenMapTiles**,
   *   but Protomaps' own docs state its `water` layer already carries
   *   "polygons, lines and point labels" together — the same layer the
   *   fill and the river lines already read.
   *
   * Caves were investigated and left out entirely: neither schema's POI
   * layer carries a `natural=cave_entrance` equivalent at all (confirmed
   * against OpenMapTiles' actual `poi.yaml` source, not just its docs) —
   * getting them onto the map would mean a new OSM import, not a style
   * change, and was explicitly descoped on request.
   */
  peakLayer: string
  peakFilter?: FilterSpecification
  roadNameLayer: string
  waterNameLayer: string
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
  // OpenMapTiles' `landcover` class enum is only wood/grass/farmland/rock/
  // ice/wetland/sand (confirmed against openmaptiles.org/docs/schema) — no
  // separate scrub/park/meadow values to fold in, unlike Protomaps below.
  landcover: 'landcover',
  forestFilter: ['in', 'class', 'wood'],
  vegetationFilter: ['in', 'class', 'grass'],
  motorwayFilter: ['in', 'class', 'motorway', 'trunk'],
  primaryFilter: ['==', 'class', 'primary'],
  secondaryFilter: ['==', 'class', 'secondary'],
  localRoadFilter: ['!in', 'class', 'motorway', 'trunk', 'primary', 'secondary'],
  waterwayLayer: 'waterway',
  peakLayer: 'mountain_peak',
  roadNameLayer: 'transportation_name',
  waterNameLayer: 'water_name',
}

const PROTOMAPS_SCHEMA: ModernSchema = {
  building: 'buildings',
  transportation: 'roads',
  boundary: 'boundaries',
  place: 'places',
  majorRoadFilter: ['in', 'kind_detail', 'motorway', 'trunk', 'primary'],
  minorRoadFilter: ['!in', 'kind_detail', 'motorway', 'trunk', 'primary'],
  boundaryFilter: ['==', 'kind', 'country'],
  // `landuse`, not `landcover` — see the field's own docstring for why.
  // `kind` values confirmed against docs.protomaps.com/basemaps/layers'
  // `landuse` enum.
  landcover: 'landuse',
  forestFilter: ['in', 'kind', 'forest', 'wood'],
  vegetationFilter: [
    'in',
    'kind',
    'grass',
    'meadow',
    'scrub',
    'park',
    'garden',
    'nature_reserve',
    'national_park',
    'golf_course',
    'orchard',
  ],
  motorwayFilter: ['in', 'kind_detail', 'motorway', 'trunk'],
  primaryFilter: ['==', 'kind_detail', 'primary'],
  secondaryFilter: ['==', 'kind_detail', 'secondary'],
  localRoadFilter: ['!in', 'kind_detail', 'motorway', 'trunk', 'primary', 'secondary'],
  waterwayLayer: 'water',
  waterwayFilter: [
    'all',
    ['==', ['geometry-type'], 'LineString'],
    ['in', ['get', 'kind'], ['literal', ['river', 'canal', 'stream', 'ditch', 'drain']]],
  ],
  peakLayer: 'pois',
  peakFilter: ['==', 'kind', 'peak'],
  roadNameLayer: 'roads',
  waterNameLayer: 'water',
}

/** Exported so `useModernLabelsOverlay.ts` can pick the right schema for its own `addSource` call. */
export const resolveModernSchema = (source: BasemapSource): ModernSchema =>
  source.provider === 'pmtiles' ? PROTOMAPS_SCHEMA : OPENMAPTILES_SCHEMA

/**
 * `vestigian`, `satellite` and (behind a toggle, `useModernLabelsOverlay.ts`)
 * the antiquity views all draw this same symbol layer — pulled out so each
 * caller supplies only what actually differs between them: `vestigian` keeps
 * it quiet (0.7) since the antiquity data is that view's own foreground;
 * satellite draws it at full strength, since a photograph has nothing of its
 * own competing with a name; the antiquity overlay matches satellite's
 * choice — a reader who explicitly switches it on wants to read it, not
 * squint at it.
 */
export const MODERN_LABELS_SOURCE_ID = 'basemap'

export const buildPlaceLabelsLayer = (
  colours: Pick<StyleColours, 'label' | 'labelHalo'>,
  schema: ModernSchema,
  opacity: number,
): SymbolLayerSpecification => ({
  id: 'place-labels',
  type: 'symbol',
  source: MODERN_LABELS_SOURCE_ID,
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

/**
 * What a `fill` layer reading `water` has to be restricted to.
 *
 * MapLibre does not skip a feature whose geometry the layer type cannot draw:
 * a `fill` layer handed a LineString closes it into a ring and fills the area
 * between the line and its own chord. OpenMapTiles' `water` is polygons only,
 * which is why dev never showed it; Protomaps' `water` also carries the river,
 * canal and stream centrelines from zoom 9 up. Unfiltered, each one came out
 * as a long blue wedge across dry land, worst where a river runs long and
 * straight through a tile — the Thur at Frauenfeld was the report — and fading
 * only once the zoom is high enough that no line is long any more.
 *
 * Harmless on OpenMapTiles, so it is applied to both providers rather than
 * branched on the schema.
 */
const POLYGONS_ONLY: FilterSpecification = ['==', ['geometry-type'], 'Polygon']

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
    filter: POLYGONS_ONLY,
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

/**
 * A single PMTiles archive (the mirror `scripts/ops/mirror-terrain.sh` makes on
 * the CDN) rather than a `{z}/{x}/{y}` template. Either `pmtiles://https://…`
 * or the bare `https://….pmtiles` URL is accepted, because the second is what
 * a person copies out of the Bunny dashboard.
 */
const isPmtilesTerrainUrl = (url: string): boolean =>
  url.startsWith('pmtiles://') || /\.pmtiles(?:\?|$)/.test(url)

export const ELEVATION_ATTRIBUTION =
  'Elevation: <a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">Mapterhorn</a> and the open elevation sources it lists'

/**
 * The elevation source. A PMTiles archive is addressed by `url` (the protocol
 * reads its header for zoom range and tile type, so no `maxzoom` is stated here
 * — the mirror's own cut-off is the truth); a template is addressed by `tiles`
 * with the upstream's zoom limit.
 */
const buildTerrainSource = (source: BasemapSource): RasterDEMSourceSpecification => {
  const terrainUrl = resolveTerrainUrl(source)

  if (isPmtilesTerrainUrl(terrainUrl)) {
    registerPmtilesProtocol()
    return {
      type: 'raster-dem',
      url: terrainUrl.startsWith('pmtiles://') ? terrainUrl : `pmtiles://${terrainUrl}`,
      encoding: 'terrarium',
      tileSize: 512,
      attribution: ELEVATION_ATTRIBUTION,
    }
  }

  return {
    type: 'raster-dem',
    tiles: [terrainUrl],
    encoding: 'terrarium',
    // Mapterhorn's tiles are 512px, not the 256px the AWS mirror served.
    // Wrong here and the hillshade decodes at half resolution silently —
    // MapLibre does not error on a size mismatch, it just samples wrong.
    tileSize: 512,
    maxzoom: 13,
    attribution: ELEVATION_ATTRIBUTION,
  }
}

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
      minzoom: RASTER_MIRROR_MIN_ZOOM,
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
        minzoom: RASTER_MIRROR_MIN_ZOOM,
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

interface OsmStandardColours {
  land: string
  water: string
  forest: string
  vegetation: string
  landuse: string
  building: string
  motorwayFill: string
  motorwayCasing: string
  primaryFill: string
  primaryCasing: string
  secondaryFill: string
  secondaryCasing: string
  localFill: string
  localCasing: string
  boundary: string
  label: string
  labelHalo: string
  waterLabel: string
}

/**
 * Not "inspired by" OSM-Carto from memory — read directly out of the actual
 * stylesheet (`gravitystorm/openstreetmap-carto`, CC0, the CartoCSS project
 * that renders the tiles at `tile.openstreetmap.org` and the ones `vici.org`
 * itself mirrors at `tiles.vici.org/osm`) after a first attempt at this view
 * used a muted, invented approximation and was reported as not matching:
 * `style/style.mss` for land/water, `style/landcover.mss` for forest/grass,
 * `style/road-colors-generated.mss` for the road hierarchy, `style/
 * buildings.mss` for the building fill, `style/admin.mss` for the boundary
 * line. Every value below is one of theirs, not a guess at one.
 */
const OSM_STANDARD_COLOURS: OsmStandardColours = {
  land: '#f2efe9',
  water: '#aad3df',
  forest: '#add19e',
  vegetation: '#cdebb0',
  landuse: '#e0dfdf',
  building: '#d9d0c9',
  motorwayFill: '#e892a2',
  motorwayCasing: '#dc2a67',
  primaryFill: '#fcd6a4',
  primaryCasing: '#a06b00',
  secondaryFill: '#f7fabf',
  secondaryCasing: '#707d05',
  localFill: '#ffffff',
  localCasing: '#8f8f8f',
  boundary: '#8d618b',
  label: '#000000',
  labelHalo: '#ffffff',
  // style/water.mss's own `@water-text` — a river or lake name reads as
  // water, the same distinction OSM-Carto's own render makes.
  waterLabel: '#4d80b3',
}

/**
 * A road drawn as two stacked line layers — a wider "casing" under a
 * narrower "fill" — which is the one technique that actually makes the
 * classic OSM look recognisable: a flat single-colour line (this view's
 * first attempt) reads as a generic vector map regardless of which colours
 * it uses, where the casing is what gives a motorway its edge against a
 * residential street's thin white thread. One call builds both layers for
 * one road tier, in CSS-background-and-foreground order (push the casing
 * first, the fill second, and both sit above whatever this tier's own
 * z-order position needs).
 */
/** Zoom-interpolated width, the same shape `buildBasemapLayers`'s own road layers already use. */
type LineWidth = NonNullable<LineLayerSpecification['paint']>['line-width']

interface RoadTierSpecification {
  idPrefix: string
  filter: FilterSpecification
  fillColour: string
  casingColour: string
  fillWidth: LineWidth
  casingWidth: LineWidth
  minzoom?: number
}

const buildRoadTierLayers = (
  tier: RoadTierSpecification,
  transportationLayer: string,
): LayerSpecification[] => [
  {
    id: `${tier.idPrefix}-casing`,
    type: 'line',
    source: 'basemap',
    'source-layer': transportationLayer,
    filter: tier.filter,
    minzoom: tier.minzoom,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': tier.casingColour, 'line-width': tier.casingWidth },
  },
  {
    id: `${tier.idPrefix}-fill`,
    type: 'line',
    source: 'basemap',
    'source-layer': transportationLayer,
    filter: tier.filter,
    minzoom: tier.minzoom,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': tier.fillColour, 'line-width': tier.fillWidth },
  },
]

/**
 * Merges an optional per-provider filter with a `['has', 'name']` guard,
 * always returning a real array — never the bare optional filter itself.
 * Writing `filter: schema.someFilter` straight into a layer literal is
 * exactly the bug `buildOsmStandardStyle`'s `waterway` layer shipped with
 * once already: when the optional filter is `undefined` for one provider,
 * the key ends up present-and-`undefined` on the layer object, which
 * MapLibre's style validator rejects outright rather than treating as
 * absent (`"filter: array expected, undefined found"`) — a `tsc`-invisible
 * runtime failure that broke the whole view. Centralised here once so every
 * named-feature label layer below goes through the same safe merge.
 */
const buildNamedFeatureFilter = (extra?: FilterSpecification): FilterSpecification =>
  extra ? (['all', extra, ['has', 'name']] as FilterSpecification) : ['has', 'name']

/**
 * The same vector source `vestigian` already mirrors (OpenFreeMap in dev, a
 * self-hosted Protomaps PMTiles extract in production — see
 * `.claude/rules/map-and-tiles.md`), styled to look like the ordinary
 * reference map underneath it rather than recoloured into this atlas's own
 * ink. Requested as "an OSM-style map, mirrorable, open source, EU-based",
 * then requested again, more specifically, against a `vici.org` URL — which
 * turned out to be real evidence for the question asked, not just a
 * preference: `vici.org`'s own "OSM" layer is `tiles.vici.org/osm/{z}/{x}/
 * {y}.png`, a *self-hosted mirror* of the classic OSM-Carto raster render
 * (confirmed by watching the actual tile requests a real page load makes),
 * not a hotlink to `tile.openstreetmap.org` — so a mirrorable, open-source
 * OSM-Carto-alike was never in question, only which route to it to take.
 *
 * The literal route — running `gravitystorm/openstreetmap-carto` itself —
 * was not taken: it is a Mapnik/CartoCSS *raster* stylesheet, which means
 * its own `osm2pgsql` import into PostGIS plus a `renderd`/`mod_tile`
 * process actually rendering tiles, i.e. exactly the tile-server process
 * this project's PMTiles architecture exists to not need (see the stack
 * table in `CLAUDE.md`). What's built here instead reads the same
 * already-mirrored vector source every other view draws and recolours it
 * with OSM-Carto's own published colour values (see `OSM_STANDARD_COLOURS`)
 * — mirrorable in the sense that matters for this app (no new provider, no
 * new hosting commitment), open source (the colours are read from a CC0
 * stylesheet), EU-based (OpenFreeMap's own instance runs on two Hetzner
 * machines).
 *
 * Why this needed its own layer builder rather than reusing
 * `buildBasemapLayers` the way the first attempt did: that function draws
 * one undifferentiated `landuse` wash and one two-tier road split, which is
 * right for `vestigian`'s quiet, deliberately low-detail sheet but was the
 * actual gap in the first attempt at this view — OSM-Carto's own look is
 * dominated by a forest/grass fill `buildBasemapLayers` has no layer for at
 * all, and a four-tier coloured-and-cased road hierarchy a single flat line
 * per tier cannot approximate. Rather than bend the shared function to a
 * second, incompatible shape, this view draws its own layer list, reusing
 * only `buildVectorSource`/`resolveModernSchema`/`buildPlaceLabelsLayer` —
 * the parts that really are shared facts about the source, not opinions
 * about how to draw it.
 */
const buildOsmStandardStyle = (source: BasemapSource): StyleSpecification => {
  if (source.provider === 'pmtiles') registerPmtilesProtocol()

  const schema = resolveModernSchema(source)
  const colours = OSM_STANDARD_COLOURS

  const roadTiers: RoadTierSpecification[] = [
    {
      idPrefix: 'roads-local',
      filter: schema.localRoadFilter,
      fillColour: colours.localFill,
      casingColour: colours.localCasing,
      minzoom: 11,
      fillWidth: ['interpolate', ['linear'], ['zoom'], 11, 0.4, 18, 3],
      casingWidth: ['interpolate', ['linear'], ['zoom'], 11, 0.7, 18, 4.6],
    },
    {
      idPrefix: 'roads-secondary',
      filter: schema.secondaryFilter,
      fillColour: colours.secondaryFill,
      casingColour: colours.secondaryCasing,
      minzoom: 8,
      fillWidth: ['interpolate', ['linear'], ['zoom'], 8, 0.5, 18, 4],
      casingWidth: ['interpolate', ['linear'], ['zoom'], 8, 0.9, 18, 6],
    },
    {
      idPrefix: 'roads-primary',
      filter: schema.primaryFilter,
      fillColour: colours.primaryFill,
      casingColour: colours.primaryCasing,
      fillWidth: ['interpolate', ['linear'], ['zoom'], 6, 0.5, 18, 5],
      casingWidth: ['interpolate', ['linear'], ['zoom'], 6, 0.9, 18, 7.5],
    },
    {
      idPrefix: 'roads-motorway',
      filter: schema.motorwayFilter,
      fillColour: colours.motorwayFill,
      casingColour: colours.motorwayCasing,
      fillWidth: ['interpolate', ['linear'], ['zoom'], 4, 0.5, 18, 6],
      casingWidth: ['interpolate', ['linear'], ['zoom'], 4, 0.9, 18, 9],
    },
  ]

  return {
    version: 8,
    glyphs: source.glyphsUrl,
    sources: { basemap: buildVectorSource(source) },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': colours.land } },
      {
        id: 'landuse',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landuse',
        paint: { 'fill-color': colours.landuse, 'fill-opacity': 0.6 },
      },
      {
        id: 'vegetation',
        type: 'fill',
        source: 'basemap',
        'source-layer': schema.landcover,
        filter: schema.vegetationFilter,
        paint: { 'fill-color': colours.vegetation },
      },
      {
        id: 'forest',
        type: 'fill',
        source: 'basemap',
        'source-layer': schema.landcover,
        filter: schema.forestFilter,
        paint: { 'fill-color': colours.forest },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        filter: POLYGONS_ONLY,
        paint: { 'fill-color': colours.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'basemap',
        'source-layer': schema.waterwayLayer,
        // MapLibre's style validator rejects an explicit `filter: undefined`
        // outright ("array expected, undefined found") — it is not treated
        // as equivalent to the key being absent, so the key has to not
        // exist at all for OpenMapTiles, where the whole `waterway` layer is
        // already nothing but river/stream lines.
        ...(schema.waterwayFilter ? { filter: schema.waterwayFilter } : {}),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': colours.water,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 18, 4],
        },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'basemap',
        'source-layer': schema.building,
        minzoom: 14,
        paint: { 'fill-color': colours.building },
      },
      ...roadTiers.flatMap((tier) => buildRoadTierLayers(tier, schema.transportation)),
      {
        id: 'boundaries',
        type: 'line',
        source: 'basemap',
        'source-layer': schema.boundary,
        filter: schema.boundaryFilter,
        paint: {
          'line-color': colours.boundary,
          'line-dasharray': [3, 2],
          'line-width': 1,
          'line-opacity': 0.7,
        },
      },
      buildPlaceLabelsLayer({ label: colours.label, labelHalo: colours.labelHalo }, schema, 1),
      // Added after `place-labels`, not before: MapLibre places symbols in
      // layer order and, with the default `text-allow-overlap: false`,
      // whichever claims a spot first wins a collision — so town names stay
      // the highest-priority label on this view, the way they are on any
      // reference map, and a crowded peak/river/road name yields to them
      // rather than the other way round.
      {
        id: 'peak-labels',
        type: 'symbol',
        source: 'basemap',
        'source-layer': schema.peakLayer,
        filter: buildNamedFeatureFilter(schema.peakFilter),
        minzoom: 8,
        layout: {
          'text-field': ['concat', '▲ ', ['get', 'name']],
          'text-font': [MAP_LABEL_FONT],
          'text-size': 11,
          'text-max-width': 8,
        },
        paint: {
          'text-color': colours.label,
          'text-halo-color': colours.labelHalo,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'water-name-labels',
        type: 'symbol',
        source: 'basemap',
        'source-layer': schema.waterNameLayer,
        filter: buildNamedFeatureFilter(),
        minzoom: 4,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': [MAP_LABEL_FONT],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 13],
          'text-max-width': 8,
        },
        paint: {
          'text-color': colours.waterLabel,
          'text-halo-color': colours.labelHalo,
          'text-halo-width': 1,
        },
      },
      {
        id: 'waterway-name-labels',
        type: 'symbol',
        source: 'basemap',
        'source-layer': schema.waterwayLayer,
        filter: buildNamedFeatureFilter(schema.waterwayFilter),
        minzoom: 10,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': [MAP_LABEL_FONT],
          'text-size': 11,
          'text-letter-spacing': 0.05,
        },
        paint: {
          'text-color': colours.waterLabel,
          'text-halo-color': colours.labelHalo,
          'text-halo-width': 1,
        },
      },
      {
        id: 'road-name-labels',
        type: 'symbol',
        source: 'basemap',
        'source-layer': schema.roadNameLayer,
        filter: buildNamedFeatureFilter(),
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': [MAP_LABEL_FONT],
          'text-size': 10,
        },
        paint: {
          'text-color': colours.label,
          'text-halo-color': colours.labelHalo,
          'text-halo-width': 1,
        },
      },
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
  /** A solid under-stroke beneath the dashed outline, so the dashes survive any ground. */
  casing: string
  /** The state's name over its own territory — a darker tone of the same hue as `line`. */
  label: string
  /** Pale on a light sheet, dark on photography, as `PolityColours.halo`. */
  halo: string
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
  line: '#6b4d17',
  casing: '#faf7ef',
  label: '#5a4216',
  halo: '#faf7ef',
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
  casing: '#fffdf4',
  label: '#120f0c',
  halo: '#faf7ef',
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
  line: '#ffd9c9',
  casing: '#3d1509',
  label: '#ffd9c9',
  halo: '#3d1509',
}

/**
 * The night notebook keeps the amber wash — it reads well on warm charcoal — but
 * the name it carries has to be pale with a dark halo, or it is a bright blot
 * on a dark sheet.
 */
const DARK_PERIOD_EXTENT_COLOURS: PeriodExtentColours = {
  fill: '#c99b52',
  line: '#f0d9a0',
  casing: '#1c1610',
  label: '#f0dcae',
  halo: '#1c1610',
}

/**
 * Which wash the extent fill draws in, keyed to the basemap it sits over —
 * not the reader's theme, the same "follows the sheet" reasoning
 * `resolveSheetTone` already documents. `usePeriodOverlay` calls this fresh
 * on every attach, so switching basemaps while the scrubber is on (which
 * tears down and rebuilds every overlay via `styledata`, same as every
 * other overlay in this file) picks up the right palette automatically.
 */
export const resolvePeriodExtentColours = (
  view: BasemapView,
  isDark = false,
): PeriodExtentColours => {
  if (view === 'antiquity-dare') return DARE_PERIOD_EXTENT_COLOURS
  if (view === 'satellite') return SATELLITE_PERIOD_EXTENT_COLOURS
  if (view === 'vestigian' && isDark) return DARK_PERIOD_EXTENT_COLOURS
  return PERIOD_EXTENT_COLOURS
}

/**
 * How the frontier is told apart on the map: **colour says what the line is,
 * dash says how far to trust where it is drawn.**
 *
 * - `barrier` — a built work (wall, rampart, ditch): oxide red, the house accent.
 * - `river` — a frontier held along a watercourse: a deep teal. Nothing was built
 *   across it, so it is a different colour as well as a different weight.
 * - `notional` — a line with no structure to point at: umber.
 *
 * Solid means the line follows mapped or surveyed remains (OpenStreetMap,
 * OpenHistoricalMap, vici.org — within tens of metres of survey polygons);
 * dashed means it is generalised from the edge of AWMC's empire polygon or from
 * Barrington Atlas linework — a median 0.3–0.6 km off, with excursions of
 * several. Kept in one exported table so the key panel cannot drift from the map.
 *
 * Every colour clears 4.5:1 against the paper casing underneath it, and the
 * casing is what carries the line across a photograph or a dark sheet.
 */
export const LIMES_KIND_COLOURS: Record<LimesSegmentKind, string> = {
  barrier: '#b3321a',
  river: '#0b6e86',
  notional: '#6b4a2b',
}

/** Plain numbers, in units of line width: `line-dasharray` is not data-driven. */
export const LIMES_APPROXIMATE_DASH: [number, number] = [2.2, 1.6]

/** Widest for the built work, which is the subject; the others are still heavier than a road. */
const LIMES_KIND_WIDTHS: Record<LimesSegmentKind, [number, number, number]> = {
  barrier: [2.8, 4.2, 7.5],
  river: [2.4, 3.6, 6.5],
  notional: [2.2, 3.2, 5.5],
}

const LIMES_KINDS_DRAW_ORDER: LimesSegmentKind[] = ['notional', 'river', 'barrier']

const LIMES_COLOURS = {
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
      'line-opacity': 0.92,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 5.4, 8, 8, 14, 12.5],
    },
  },
  /**
   * Six layers — three kinds, solid or dashed — because `line-dasharray` is not
   * data-driven. Within each precision the order is notional, river, barrier, so
   * a built work wins where it meets a river; and every approximate layer is
   * added before every traced one, so a traced line is never under a dashed one.
   */
  ...[false, true].flatMap((isTraced) =>
    LIMES_KINDS_DRAW_ORDER.map((kind): LayerSpecification => ({
      id: `limes-frontier-${kind}${isTraced ? '' : '-approximate'}`,
      type: 'line',
      source: 'limes',
      'source-layer': 'frontier',
      filter: ['all', ['==', ['get', 'kind'], kind], ['==', ['get', 'traced'], isTraced]],
      layout: { 'line-cap': isTraced ? 'round' : 'butt', 'line-join': 'round' },
      paint: {
        'line-color': LIMES_KIND_COLOURS[kind],
        'line-opacity': 1,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          LIMES_KIND_WIDTHS[kind][0],
          8,
          LIMES_KIND_WIDTHS[kind][1],
          14,
          LIMES_KIND_WIDTHS[kind][2],
        ],
        ...(isTraced ? {} : { 'line-dasharray': LIMES_APPROXIMATE_DASH }),
      },
    })),
  ),
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
      'icon-size': MARKER_ICON_SIZE,
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

const buildAtlasStyleWithRelief = (
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
    terrain: buildTerrainSource(source),
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
        'icon-size': MARKER_ICON_SIZE,
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
 * In a production build the hillshade is drawn only from an elevation source
 * the deployment configured (`NUXT_PUBLIC_BASEMAP_TERRAIN_URL`), never from the
 * public fallback above.
 *
 * `tiles.mapterhorn.com` is fronted by Cloudflare (checked with a real request:
 * `server: cloudflare`, a `cf-ray` header), so falling back to it sends every
 * visitor's address to a US provider — the one thing the About page says does
 * not happen. A development build or a unit test still gets the fallback, which
 * is what keeps a fresh clone looking right. Point the variable at a mirror on
 * the CDN to bring the relief back in production.
 */
const buildAtlasStyle = (source: BasemapSource, options: AtlasStyleOptions): StyleSpecification => {
  const style = buildAtlasStyleWithRelief(source, options)
  if (!import.meta.env.PROD || source.terrainUrl.length > 0) return style

  return {
    ...style,
    sources: Object.fromEntries(Object.entries(style.sources).filter(([id]) => id !== 'terrain')),
    layers: style.layers.filter((layer) => layer.id !== 'atlas-hillshade'),
  }
}

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
    paint: { 'fill-color': colours.fill, 'fill-opacity': 0.4 },
  },
  {
    id: 'atlas-period-extent-casing',
    type: 'line',
    source: 'atlas-period',
    'source-layer': 'extent',
    paint: {
      'line-color': colours.casing,
      'line-opacity': 0.8,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3.4, 10, 5.6],
    },
  },
  {
    id: 'atlas-period-extent-outline',
    type: 'line',
    source: 'atlas-period',
    'source-layer': 'extent',
    paint: {
      'line-color': colours.line,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 10, 2.8],
      // Longer dashes than the neighbouring realms' [3, 2], so the two never read as one line.
      'line-dasharray': [5, 2.5],
    },
  },
  /**
   * The state's own name over its territory, drawn the way the neighbouring
   * realms' names are so the two read as one family — in capitals and wide
   * set, because it is the largest area on the map. The source's name is used
   * as it stands (`Res Publica Romana`, `Imperium Romanum`, and after 395 the
   * Western and Eastern halves each under their own), as the realms' names are.
   * Gone beyond zoom 9: the label is placed once per tile, so a closer view
   * would repeat it across a territory the reader can no longer see whole.
   */
  {
    id: 'atlas-period-extent-label',
    type: 'symbol',
    source: 'atlas-period',
    'source-layer': 'extent',
    maxzoom: 9,
    layout: {
      'text-field': ['get', 'state_name'],
      'text-font': [MAP_LABEL_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 16],
      'text-max-width': 8,
      'text-letter-spacing': 0.18,
      'text-transform': 'uppercase',
      // The label is placed once per tile, so a territory crossing a tile edge would
      // carry two. The padding is what makes the second one yield.
      'text-padding': 40,
    },
    paint: {
      'text-color': colours.label,
      'text-halo-color': colours.halo,
      'text-halo-width': 1.8,
    },
  },
]

export const POLITY_SOURCE_ID = 'atlas-polities'

export interface PolityColours {
  fill: string
  line: string
  /** A solid under-stroke beneath the dashed outline, so it survives any ground. */
  casing: string
  label: string
  halo: string
}

/**
 * Deep slate blue, deliberately the opposite of the Roman extent's amber: a
 * neighbouring realm should read as "someone else's territory" at a glance.
 * Raised well beyond the first version ("increase contrast a lot"): a barely
 * tinted fill and a thin grey-blue dash vanished on every sheet. The fill now
 * carries real weight, the outline is a two-stroke line (a solid pale casing
 * under a dark dashed stroke) and the name has a wide halo — each of the four
 * grounds below gets a palette measured against it, not one shared compromise.
 * Cliopatria's boundaries are still one scholarly version of a coarse outline,
 * and the popup says so.
 */
const POLITY_COLOURS: PolityColours = {
  fill: '#2a5d8f',
  line: '#0f2f52',
  casing: '#faf7ef',
  label: '#0b2745',
  halo: '#faf7ef',
}

/** Pale parchment needs a still darker ink, and a casing as pale as the sheet. */
const DARE_POLITY_COLOURS: PolityColours = {
  fill: '#17406b',
  line: '#071a2e',
  casing: '#fffdf4',
  label: '#06182b',
  halo: '#fffdf4',
}

/**
 * The night notebook: a light, cool blue on warm charcoal, with the casing in
 * the ground's own tone so the dashes stay crisp.
 */
const DARK_POLITY_COLOURS: PolityColours = {
  fill: '#6fb0e6',
  line: '#bfe0fa',
  casing: '#10202e',
  label: '#d9edfc',
  halo: '#10202e',
}

/**
 * Satellite photography has no stable background tone, so a bright cyan fill,
 * a white dashed line and a near-black casing: one of the pair contrasts with
 * whatever the pixel underneath is.
 */
const SATELLITE_POLITY_COLOURS: PolityColours = {
  fill: '#46c2ff',
  line: '#ffffff',
  casing: '#0a1a2a',
  label: '#ffffff',
  halo: '#0a1a2a',
}

export const resolvePolityColours = (view: BasemapView, isDark = false): PolityColours => {
  if (view === 'antiquity-dare') return DARE_POLITY_COLOURS
  if (view === 'satellite') return SATELLITE_POLITY_COLOURS
  if (view === 'vestigian' && isDark) return DARK_POLITY_COLOURS
  return POLITY_COLOURS
}

/**
 * The neighbours of the Roman state (`antiquity_polities`, Cliopatria) in the
 * scrubber's year: a fill, a casing and a dashed outline, and the realm's name.
 * Added by `usePeriodOverlay` *before* the Roman extent so Rome draws over
 * anything it overlaps. The dashed outline separates "territory a source drew"
 * from the solid line the frontier uses.
 */
export const buildPolityLayers = (
  colours: PolityColours = POLITY_COLOURS,
): LayerSpecification[] => [
  {
    id: 'atlas-polity-fill',
    type: 'fill',
    source: POLITY_SOURCE_ID,
    'source-layer': 'polities',
    paint: { 'fill-color': colours.fill, 'fill-opacity': 0.34 },
  },
  {
    id: 'atlas-polity-casing',
    type: 'line',
    source: POLITY_SOURCE_ID,
    'source-layer': 'polities',
    paint: {
      'line-color': colours.casing,
      'line-opacity': 0.8,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 10, 5],
    },
  },
  {
    id: 'atlas-polity-outline',
    type: 'line',
    source: POLITY_SOURCE_ID,
    'source-layer': 'polities',
    paint: {
      'line-color': colours.line,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 10, 2.6],
      'line-dasharray': [3, 2],
    },
  },
  {
    id: 'atlas-polity-label',
    type: 'symbol',
    source: POLITY_SOURCE_ID,
    'source-layer': 'polities',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': [MAP_LABEL_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 12, 8, 15],
      'text-max-width': 7,
      'text-letter-spacing': 0.06,
    },
    paint: {
      'text-color': colours.label,
      'text-halo-color': colours.halo,
      'text-halo-width': 2,
    },
  },
]

export const buildBasemapStyle = (request: StyleRequest): StyleSpecification => {
  if (request.view === 'antiquity-dare') return buildDareStyle(request.source)
  if (request.view === 'antiquity-awmc') {
    return buildAtlasStyle(request.source, { limes: request.isFollowingLimes === true })
  }
  if (request.view === 'satellite') return buildSatelliteStyle(request.source)
  if (request.view === 'osm-standard') return buildOsmStandardStyle(request.source)

  const colours = request.isDark ? DARK_COLOURS : LIGHT_COLOURS

  if (request.source.provider === 'pmtiles') registerPmtilesProtocol()

  return {
    version: 8,
    glyphs: request.source.glyphsUrl,
    sources: { basemap: buildVectorSource(request.source) },
    layers: buildBasemapLayers(colours, QUIET_ROAD_OPACITY, resolveModernSchema(request.source)),
  }
}

/**
 * The sheet a first visit opens on: the familiar OpenStreetMap look, so a
 * reader meets a map they already know how to read before any of the atlas's
 * own layers are switched on. `vestigian` stays one tap away in the switcher.
 * A reader who chose another sheet gets that one back (`BASEMAP_VIEW_STORAGE_KEY`);
 * this is only where a browser with nothing stored starts.
 */
export const DEFAULT_BASEMAP_VIEW: BasemapView = 'osm-standard'

/**
 * Which sheet the reader last chose, kept in `localStorage` as the view's own
 * id and nothing else.
 *
 * Same class of storage as the colour mode, the intro tour's answer and the
 * featured-list switches (`useFeaturedSites.ts`): the reader's own explicit act
 * of picking a sheet writes it, it is a single word, it is never a cookie and
 * never sent to us, so no consent banner is needed (§25(2) no. 2 TDDDG,
 * `gdpr-legal.md`). If the key or its contents change, change the disclosure in
 * `privacy.cookiesBody` in all six locales and the storage table in
 * `gdpr-legal.md` with it.
 */
export const BASEMAP_VIEW_STORAGE_KEY = 'vestigian-basemap-view'

/**
 * `label`/`hint` hold i18n key paths, not display text — this array is a
 * plain module-scope constant, outside any component's `t()` context, so it
 * cannot translate itself. `BasemapSwitcher.vue` is what calls `t()` on
 * these. Left as literal English for a while after the view itself shipped
 * (see `.claude/rules/map-and-tiles.md`) — a real, if narrow, i18n gap: the
 * description under each sheet's name read in English regardless of locale.
 */
export const BASEMAP_VIEWS: BasemapOption[] = [
  {
    value: 'vestigian',
    group: 'today',
    label: 'basemapSwitcher.views.vestigian.label',
    hint: 'basemapSwitcher.views.vestigian.hint',
  },
  {
    value: 'satellite',
    group: 'today',
    label: 'basemapSwitcher.views.satellite.label',
    hint: 'basemapSwitcher.views.satellite.hint',
  },
  {
    value: 'osm-standard',
    group: 'today',
    label: 'basemapSwitcher.views.osmStandard.label',
    hint: 'basemapSwitcher.views.osmStandard.hint',
  },
  {
    value: 'antiquity-dare',
    group: 'antiquity',
    label: 'basemapSwitcher.views.antiquityDare.label',
    hint: 'basemapSwitcher.views.antiquityDare.hint',
  },
  {
    value: 'antiquity-awmc',
    group: 'antiquity',
    label: 'basemapSwitcher.views.antiquityAwmc.label',
    hint: 'basemapSwitcher.views.antiquityAwmc.hint',
  },
]

/**
 * Reads what `setView` wrote, and only a sheet that is on offer. The stored
 * value is whatever the browser hands back — including a sheet a later version
 * dropped (`terrain` once was one) or a value somebody edited by hand — and a
 * map that opens on a view the switcher cannot show would have no way to be
 * switched away from it.
 */
export const parseStoredBasemapView = (raw: string | null): BasemapView | null =>
  BASEMAP_VIEWS.find((option) => option.value === raw)?.value ?? null

const readStoredBasemapView = (): BasemapView | null => {
  try {
    return parseStoredBasemapView(localStorage.getItem(BASEMAP_VIEW_STORAGE_KEY))
  } catch {
    return null
  }
}

const writeStoredBasemapView = (next: BasemapView): void => {
  try {
    localStorage.setItem(BASEMAP_VIEW_STORAGE_KEY, next)
  } catch {
    // Private browsing / storage blocked: the choice lasts until the tab closes.
  }
}

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
  const view = useState<BasemapView>('basemap-view', () => DEFAULT_BASEMAP_VIEW)
  const hasRestoredView = useState<boolean>('basemap-view-restored', () => false)

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
    referenceTilesUrl: absolute(config.public.basemap.referenceTilesUrl),
    polityTilesUrl: absolute(config.public.basemap.polityTilesUrl),
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
   * Modern city names, over a historical sheet — DARE's raster tiles carry
   * none of their own, and Barrington's own place labels are ancient names
   * from Pleiades, not a reader's present-day bearings; turning this on
   * draws `vestigian`/`satellite`'s own modern-places layer
   * (`useModernLabelsOverlay`) over whichever of the two is showing, purely
   * as an orientation aid.
   *
   * `canShowModernLabels` is the one `canShow*` flag in this file that is
   * not a constant `true` — these names are a fact about *today's* ground,
   * which only makes sense to offer as a reading aid over a historical
   * sheet. The period scrubber just above is the direct precedent for a
   * basemap-scoped control staying scoped rather than generalising to every
   * view the way the frontier and the reference overlays below did — see
   * `.claude/rules/antiquity-basemaps.md`. Not persisted, same reasoning as
   * `isLimesActive`.
   */
  const isModernLabelsActive = useState<boolean>('modern-labels-active', () => false)

  const canShowModernLabels = computed(
    () => view.value === 'antiquity-dare' || view.value === 'antiquity-awmc',
  )

  const isShowingModernLabels = computed(
    () => canShowModernLabels.value && isModernLabelsActive.value,
  )

  const setModernLabelsActive = (next: boolean): void => {
    isModernLabelsActive.value = next
  }

  /**
   * The Tabula Peutingeriana network — unlike the limes, an overlay drawn on
   * top of *any* basemap rather than baked into one vector style, since it is
   * a plain `geojson` source layered above whatever sheet is showing (see
   * `useTabulaPeutingerianaOverlay`), not a reading of one antiquity sheet in
   * particular.
   *
   * `canShow` reflects the server-side switch, on by default
   * (`NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED`, see `nuxt.config.ts`): the
   * toggle is not offered while it is `false`.
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
   * Counted clusters below zoom 9 (the default) or every site as its own
   * marker at every zoom. Only meaningful while `isShowingSites`. Not
   * persisted, for the same reason as the switches around it.
   */
  const isClusteringSites = useState<boolean>('sites-clustered', () => true)

  const setSitesClustered = (next: boolean): void => {
    isClusteringSites.value = next
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

  /**
   * The five reference overlays that share one tile endpoint (`reference-layers.ts`):
   * Itiner-e roads, Nomisma mints, the Wikidata monuments, I.Sicily and the Atlas of Hillforts. One record of
   * switches rather than four copies of the same three lines, because nothing about
   * them differs but the id. Off by default and not persisted, like every other
   * reference overlay here.
   */
  const referenceOverlaysActive = useState<Record<ReferenceOverlayId, boolean>>(
    'reference-overlays-active',
    () => ({
      'roman-roads': false,
      mints: false,
      monuments: false,
      isicily: false,
      hillforts: false,
    }),
  )

  const isShowingReferenceOverlay = (id: ReferenceOverlayId): boolean =>
    referenceOverlaysActive.value[id]

  const setReferenceOverlayActive = (id: ReferenceOverlayId, next: boolean): void => {
    referenceOverlaysActive.value = { ...referenceOverlaysActive.value, [id]: next }
  }

  /**
   * The Roman state's neighbours (Cliopatria) are drawn with the period scrubber, so
   * they can only be offered while it is on. On by default once it is — a scrubber
   * that shows Rome alone at the Second Punic War hides what it was fighting.
   */
  const arePolitiesEnabled = useState<boolean>('polities-enabled', () => true)

  const canShowPolities = computed(() => periodYear.value !== null)

  const isShowingPolities = computed(() => canShowPolities.value && arePolitiesEnabled.value)

  const setPolitiesEnabled = (next: boolean): void => {
    arePolitiesEnabled.value = next
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
    writeStoredBasemapView(next)
  }

  /**
   * Client-only — `MapCanvas` calls it in `onMounted`, before it creates the map,
   * so the map is built on the remembered sheet instead of drawing the default
   * and swapping. Never from this composable's body or a `useState` factory:
   * that runs during SSR, where there is no storage, and the client would
   * hydrate from whatever the server answered. Idempotent.
   */
  const restoreView = (): void => {
    if (hasRestoredView.value) return
    hasRestoredView.value = true
    const stored = readStoredBasemapView()
    if (stored) view.value = stored
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
    restoreView,
    currentStyle,
    isDark,
    sheetTone,
    availableViews: BASEMAP_VIEWS,
    /**
     * The full resolved source config, not just one tile URL — every other
     * overlay here only ever needed its own single endpoint, but
     * `useModernLabelsOverlay` builds the same vector source `vestigian`
     * and `satellite` draw, which needs `provider`/`pmtilesUrl` together,
     * not a single derived string.
     */
    source,
    canFollowLimes,
    isFollowingLimes,
    setLimesActive,
    limesTilesUrl: computed(() => source.value.limesTilesUrl),
    periodYear,
    setPeriodYear,
    canShowModernLabels,
    isShowingModernLabels,
    setModernLabelsActive,
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
    isClusteringSites,
    setSitesClustered,
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
    isShowingReferenceOverlay,
    setReferenceOverlayActive,
    referenceOverlaysActive,
    referenceTilesUrl: computed(() => source.value.referenceTilesUrl),
    canShowPolities,
    isShowingPolities,
    setPolitiesEnabled,
    polityTilesUrl: computed(() => source.value.polityTilesUrl),
  }
}
