import type {
  CircleLayerSpecification,
  FilterSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import { arrangeMarkers, type ArrangementMarker } from '#shared/utils/marker-arrangement'
import {
  buildLimesRecordIconExpression,
  buildSiteIconExpression,
  markerDiscPixelsAt,
  scaleMarkerIconSize,
} from './useSiteIcons'

/**
 * Sites that lie on top of one another, spread into a ring or a grid.
 *
 * The vector tiles draw every site at its true coordinate with
 * `icon-allow-overlap`, on purpose: collision would drop records the reader has
 * no way of knowing exist. Where sites are dense that leaves piles of discs
 * drawn one over another, and only the topmost can be read or tapped.
 *
 * This reads the sites MapLibre has loaded, projects them to the screen,
 * works out which overlap (`arrangeMarkers`) and draws those again from a
 * GeoJSON source of its own — displaced into a compact raster and shrunk until
 * they stop covering each other. Nothing is dropped: the tile layers hide only
 * the ids that are redrawn here (see `useViewportTiles`), a dot stays at each
 * true coordinate and a hairline joins it to its icon, so the displacement is
 * never silent. Zooming in separates the groups for real and they dissolve.
 *
 * Layout is in screen pixels, so it is recomputed when the camera settles, not
 * while it moves: panning does not change it (every marker moves together),
 * zooming does.
 */

export const ARRANGEMENT_SOURCE_ID = 'vestigian-arrangement'
export const ARRANGED_LEG_LAYER_ID = 'vestigian-arranged-legs'
export const ARRANGED_ANCHOR_LAYER_ID = 'vestigian-arranged-anchors'
export const ARRANGED_HALO_LAYER_ID = 'vestigian-arranged-halo'
export const ARRANGED_SITE_LAYER_ID = 'vestigian-arranged-sites'
export const ARRANGED_LIMES_FORT_LAYER_ID = 'vestigian-arranged-limes-forts'

/**
 * Where the tiles start carrying individual sites. Below it the clustered tiles
 * hold counted discs, and the every-site mode a continent's points per tile —
 * arranging those would be arranging noise, and the density mode is the
 * reader's own choice to look at exactly that.
 */
const ARRANGEMENT_MIN_ZOOM = 9

/**
 * Past this many sites in view the arrangement stands down and the markers
 * overlap as before. The densest 2.75° × 1.4° window in the import holds 5,406
 * (measured), so this is headroom, not a limit anyone meets — it exists so a
 * pathological tile cannot stall the page.
 */
const MAX_ARRANGED_SITES = 8000

/** A hairline shorter than this is not worth drawing: the icon is on its dot. */
const MIN_LEG_PIXELS = 4

/** Kept clear between two arranged icons, so their rings do not run together. */
const ICON_SPACING_PIXELS = 2

type PointFeature = GeoJSON.Feature<GeoJSON.Point>
type LegFeature = GeoJSON.Feature<GeoJSON.LineString>

interface ArrangementPalette {
  ink: string
  ring: string
  siteHalo: string
  selection: string
}

export interface ArrangementLayers {
  legs: LineLayerSpecification
  anchors: CircleLayerSpecification
  halo: CircleLayerSpecification
  sites: SymbolLayerSpecification
  limesForts: SymbolLayerSpecification
}

export interface ArrangementLayerRequest {
  palette: ArrangementPalette
  isFollowingLimes: boolean
  /** The reader's choice of site kinds (`useSiteTypeFilter`); `null` shows all. */
  typeFilter?: FilterSpecification | null
}

export interface ArrangementRefreshRequest {
  /** The vector source the sites are read from. */
  sourceId: string
  sourceLayer: string
  /**
   * Sites the reader has filtered out are not read, so they neither take a
   * slot in a ring nor push a visible neighbour out of its own.
   */
  filter?: FilterSpecification | null
}

interface LoadedSite {
  id: number
  lng: number
  lat: number
  title: string
  category: string
  subcategory: string | null
}

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

const IS_MEMBER: FilterSpecification = ['==', ['get', 'kind'], 'member']
const IS_FORTIFICATION: FilterSpecification = ['==', ['get', 'category'], 'fortification']

/**
 * The two icon layers split the way the tile layers do: while the frontier is
 * followed, fortifications are drawn as plans by their own layer and the
 * general one leaves them out, or every fort carries two glyphs.
 */
export const buildArrangedSiteFilter = (
  isFollowingLimes: boolean,
  typeFilter: FilterSpecification | null = null,
): FilterSpecification => {
  const clauses: FilterSpecification[] = [IS_MEMBER]
  if (isFollowingLimes)
    clauses.push(['!=', ['get', 'category'], 'fortification'] as FilterSpecification)
  if (typeFilter) clauses.push(typeFilter)
  return clauses.length === 1 ? IS_MEMBER : (['all', ...clauses] as FilterSpecification)
}

export const buildArrangedLimesFortFilter = (
  typeFilter: FilterSpecification | null = null,
): FilterSpecification =>
  (typeFilter
    ? ['all', IS_MEMBER, IS_FORTIFICATION, typeFilter]
    : ['all', IS_MEMBER, IS_FORTIFICATION]) as FilterSpecification

/**
 * What the tile layers must not draw: the ids this module draws instead.
 * `match` is a hash lookup per feature, where `in` against a literal array
 * scans it — with several thousand ids that is the difference between a
 * filter that costs nothing and one that is quadratic. `null` for none,
 * because `match` needs at least one label.
 */
export const buildArrangedExclusionFilter = (ids: readonly number[]): FilterSpecification | null =>
  ids.length === 0 ? null : ['match', ['id'], [...ids], false, true]

export const buildArrangementSource = (): GeoJSONSourceSpecification => ({
  type: 'geojson',
  data: EMPTY_COLLECTION,
})

export const buildArrangementLayers = (request: ArrangementLayerRequest): ArrangementLayers => {
  const { palette } = request

  return {
    legs: {
      id: ARRANGED_LEG_LAYER_ID,
      type: 'line',
      source: ARRANGEMENT_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'leg'],
      paint: { 'line-color': palette.ring, 'line-width': 1, 'line-opacity': 0.8 },
    },
    anchors: {
      id: ARRANGED_ANCHOR_LAYER_ID,
      type: 'circle',
      source: ARRANGEMENT_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'anchor'],
      paint: {
        'circle-radius': 2.2,
        'circle-color': palette.ink,
        'circle-stroke-color': palette.siteHalo,
        'circle-stroke-width': 1,
      },
    },
    // The selection ring, as `SITE_HALO_LAYER_ID` draws it for the tile layer,
    // but around the displaced icon and as small as the icon is.
    halo: {
      id: ARRANGED_HALO_LAYER_ID,
      type: 'circle',
      source: ARRANGEMENT_SOURCE_ID,
      filter: IS_MEMBER,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          9,
          ['*', ['get', 'scale'], 22],
          17,
          ['*', ['get', 'scale'], 34],
        ],
        'circle-color': palette.selection,
        'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.16, 0],
        'circle-stroke-color': palette.selection,
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 0],
      },
    },
    sites: {
      id: ARRANGED_SITE_LAYER_ID,
      type: 'symbol',
      source: ARRANGEMENT_SOURCE_ID,
      filter: buildArrangedSiteFilter(request.isFollowingLimes, request.typeFilter),
      layout: {
        'icon-image': buildSiteIconExpression(),
        'icon-size': scaleMarkerIconSize(['get', 'scale']),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    limesForts: {
      id: ARRANGED_LIMES_FORT_LAYER_ID,
      type: 'symbol',
      source: ARRANGEMENT_SOURCE_ID,
      filter: buildArrangedLimesFortFilter(request.typeFilter),
      layout: {
        visibility: request.isFollowingLimes ? 'visible' : 'none',
        'icon-image': buildLimesRecordIconExpression(),
        'icon-size': scaleMarkerIconSize(['get', 'scale']),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
  }
}

/** A site the loaded tiles carry, once, whichever tiles it appears in. */
const readLoadedSites = (map: MapLibreMap, request: ArrangementRefreshRequest): LoadedSite[] => {
  const sites = new Map<number, LoadedSite>()

  for (const feature of map.querySourceFeatures(request.sourceId, {
    sourceLayer: request.sourceLayer,
    ...(request.filter ? { filter: request.filter } : {}),
  })) {
    if (typeof feature.id !== 'number' || sites.has(feature.id)) continue
    if (feature.geometry.type !== 'Point') continue

    const [lng, lat] = feature.geometry.coordinates as [number, number]
    const properties = feature.properties ?? {}
    sites.set(feature.id, {
      id: feature.id,
      lng,
      lat,
      title: String(properties.title ?? ''),
      category: String(properties.category ?? 'other'),
      subcategory: typeof properties.subcategory === 'string' ? properties.subcategory : null,
    })
  }

  return [...sites.values()]
}

/**
 * What the arrangement is a function of: the sites in view and the camera's
 * scale and angle. Panning changes none of it — every marker moves together —
 * so a pan that loads no new tile is answered without laying anything out.
 * Summed, so the order tiles deliver features in does not matter.
 */
const inputKeyOf = (map: MapLibreMap, sites: LoadedSite[]): string => {
  let sum = 0
  for (const site of sites) sum = (sum + Math.imul(site.id, 0x9e3779b1)) | 0
  const camera = [map.getZoom().toFixed(3), map.getBearing().toFixed(1), map.getPitch().toFixed(1)]
  return `${camera.join(':')}:${sites.length}:${sum}`
}

/** A cheap fingerprint of an arrangement, so an unchanged one is not sent to the map again. */
const fingerprintOf = (members: PointFeature[]): string => {
  let hash = 0
  for (const member of members) {
    const [lng, lat] = member.geometry.coordinates as [number, number]
    const parts = [member.id as number, lng * 1e5, lat * 1e5, (member.properties?.scale ?? 1) * 1e3]
    for (const part of parts) hash = (Math.imul(hash, 31) + Math.round(part)) | 0
  }
  return `${members.length}:${hash}`
}

export const useSiteArrangement = () => {
  let arrangedIds: number[] = []
  let lastFingerprint = ''
  let lastInputKey = ''
  let selectedSiteId: number | null = null

  const getArrangedIds = (): readonly number[] => arrangedIds

  /** Forgets what was drawn; the next refresh sends its result whatever it is. */
  const resetArrangement = (): void => {
    arrangedIds = []
    lastFingerprint = ''
    lastInputKey = ''
  }

  /**
   * The open record's ring, for the case where its icon is one of these. The
   * id is kept, not just applied: the source is rebuilt on a style change and
   * on the clustering switch, and its feature state goes with it.
   */
  const applySelection = (map: MapLibreMap): void => {
    if (!map.getSource(ARRANGEMENT_SOURCE_ID)) return
    map.removeFeatureState({ source: ARRANGEMENT_SOURCE_ID })
    if (selectedSiteId === null) return
    map.setFeatureState({ source: ARRANGEMENT_SOURCE_ID, id: selectedSiteId }, { selected: true })
  }

  const selectArrangedSite = (map: MapLibreMap, id: number | null): void => {
    selectedSiteId = id
    applySelection(map)
  }

  const buildCollection = (
    map: MapLibreMap,
    sites: LoadedSite[],
  ): { collection: GeoJSON.FeatureCollection; members: PointFeature[] } => {
    const byId = new Map(sites.map((site) => [site.id, site]))
    const projected: Array<ArrangementMarker & { site: LoadedSite }> = sites.map((site) => {
      const point = map.project([site.lng, site.lat])
      return { id: site.id, x: point.x, y: point.y, site }
    })

    const arranged = arrangeMarkers(projected, {
      cellSize: markerDiscPixelsAt(map.getZoom()) + ICON_SPACING_PIXELS,
    })

    const members: PointFeature[] = []
    const dressing: Array<PointFeature | LegFeature> = []
    const trueScreen = new Map(projected.map((marker) => [marker.id, marker]))

    for (const placed of arranged) {
      const site = byId.get(placed.id)!
      const origin = trueScreen.get(placed.id)!
      const drawnAt = map.unproject([placed.x, placed.y])

      members.push({
        type: 'Feature',
        id: site.id,
        geometry: { type: 'Point', coordinates: [drawnAt.lng, drawnAt.lat] },
        properties: {
          kind: 'member',
          scale: placed.scale,
          title: site.title,
          category: site.category,
          subcategory: site.subcategory,
        },
      })

      dressing.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [site.lng, site.lat] },
        properties: { kind: 'anchor' },
      })

      if (Math.hypot(placed.x - origin.x, placed.y - origin.y) >= MIN_LEG_PIXELS) {
        dressing.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [site.lng, site.lat],
              [drawnAt.lng, drawnAt.lat],
            ],
          },
          properties: { kind: 'leg' },
        })
      }
    }

    return {
      collection: { type: 'FeatureCollection', features: [...dressing, ...members] },
      members,
    }
  }

  /**
   * Recomputes the arrangement from what is loaded now and, if it differs from
   * what is drawn, sends it to the map. Returns whether it changed, so the
   * caller knows to update the tile layers' filters to match.
   */
  const refreshArrangement = (map: MapLibreMap, request: ArrangementRefreshRequest): boolean => {
    const source = map.getSource<GeoJSONSource>(ARRANGEMENT_SOURCE_ID)
    if (!source) return false

    const sites = map.getZoom() < ARRANGEMENT_MIN_ZOOM ? [] : readLoadedSites(map, request)
    const isTooDense = sites.length > MAX_ARRANGED_SITES
    const inputKey = inputKeyOf(map, sites)
    if (inputKey === lastInputKey) return false
    lastInputKey = inputKey

    const { collection, members } = buildCollection(map, isTooDense ? [] : sites)

    const fingerprint = fingerprintOf(members)
    if (fingerprint === lastFingerprint) return false

    lastFingerprint = fingerprint
    arrangedIds = members.map((member) => member.id as number)
    source.setData(collection)
    applySelection(map)
    return true
  }

  return { getArrangedIds, resetArrangement, refreshArrangement, selectArrangedSite }
}
