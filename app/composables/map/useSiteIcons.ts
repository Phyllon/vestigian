import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { LimesMark, SiteCategory } from '#shared/types'
import { LIMES_MARKS, VICI_MARKS } from '#shared/utils/limes'

/**
 * A drawn mark per category, so a fort reads as a fort at a glance rather than
 * as a coloured dot that has to be opened to be identified.
 *
 * Each glyph is a stroked path in a 24×24 box, drawn the way the rest of the
 * project is written: line work in ink, no fills, nothing that reads as a
 * pin dropped by a modern mapping app. They are elevations of the thing itself
 * — battlements, an arcade, a temple front — because that is what someone
 * sketching a site in a notebook would draw.
 *
 * The paths are also the legend: `MapLegend` renders these same strings as
 * inline SVG, so the key on screen cannot drift from the marks on the map.
 */
export const SITE_ICON_PREFIX = 'vestigian-site-'

export const SITE_ICON_PATHS: Record<SiteCategory, string> = {
  /** A skyline of roofs — several dwellings, which is what a town is. */
  settlement: 'M5 18.5h14M7 18.5v-4.5l2.75-2.5 2.75 2.5v4.5M12.5 18.5v-6.25l2.75-2.5 2.75 2.5v6.25',

  /** Crenellations. The one silhouette nothing else on the map can be mistaken for. */
  fortification: 'M5 18.5V10h2.8v2.6h2.8V10h2.8v2.6h2.8V10h2.8v8.5',

  /** A temple front: pediment, three columns, stylobate. */
  sanctuary: 'M5 11.5 12 6.2l7 5.3M6.5 11.5v7M12 11.5v7M17.5 11.5v7M5 18.5h14',

  /** A round-topped stele, inscribed, standing on the ground it marks. */
  burial: 'M5.5 18.5h13M8.8 18.5v-5.4a3.2 3.2 0 0 1 6.4 0v5.4M10.6 15.2h2.8',

  /** An arcade under a deck — aqueduct, bridge and road all at once. */
  infrastructure:
    'M5 9.5h14M5 9.5v9M12 9.5v9M19 9.5v9M5 16a3.5 3.5 0 0 1 7 0M12 16a3.5 3.5 0 0 1 7 0',

  /** One dwelling with a wing, against the settlement's several roofs. */
  villa: 'M5 18.5h14M6.5 18.5v-5L10 10.5l3.5 3v5M13.5 18.5v-3.9h5v3.9',

  /** A kiln: domed, stoke-hole arched under it, flue off the top. */
  production:
    'M5.5 18.5h13M7 18.5v-3.5a5 5 0 0 1 10 0v3.5M10 18.5v-3.1a2 2 0 0 1 4 0v3.1M10.6 10.3V7.2h2.8v3.1',

  /** An amphora — the object, not the place. */
  findspot:
    'M9.2 6.2h5.6M10.9 6.2C8.4 9 7.3 12 8.7 15.1 9.5 16.9 10.7 18.3 12 19.2M13.1 6.2c2.5 2.8 3.6 5.8 2.2 8.9-.8 1.8-2 3.2-3.3 4.1M10.4 6.6 8.6 9.4M13.6 6.6l1.8 2.8',

  /** A surveyor's mark: a point recorded, nothing claimed about it. */
  other: 'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0M12 6.5v2M12 15.5v2M6.5 12h2M15.5 12h2',
}

export const SITE_CATEGORIES = Object.keys(SITE_ICON_PATHS) as SiteCategory[]

export const siteIconId = (category: SiteCategory): string => `${SITE_ICON_PREFIX}${category}`

const ATLAS_ICON_PREFIX = 'vestigian-atlas-'

export const atlasIconId = (category: SiteCategory): string => `${ATLAS_ICON_PREFIX}${category}`

/**
 * The box the paths are drawn in, the size the marker occupies on screen, and
 * the device pixels behind it. Rasterising at twice the display size and
 * declaring `pixelRatio: 2` is what keeps the line work sharp rather than
 * soft, which is the difference between a drawing and a smudge.
 */
const ICON_VIEWBOX = 24
const ICON_DISPLAY_PIXELS = 23
const ICON_PIXEL_RATIO = 2
const ICON_RASTER_PIXELS = ICON_DISPLAY_PIXELS * ICON_PIXEL_RATIO

export interface SiteIconPalette {
  /** Line work for most categories. */
  ink: string
  /** Line work for infrastructure, tying a bridge or a milestone to the bronze tracings. */
  linear: string
  /** The disc the glyph sits on, so it stays legible over a busy basemap. */
  ground: string
  /** The disc's edge. */
  ring: string
}

interface IconRasterRequest {
  path: string
  ink: string
  palette: SiteIconPalette
  /**
   * A reference mark rather than a record: drawn straight onto the sheet with
   * no disc behind it and a thinner line.
   *
   * The antiquity view carries two populations at once — twenty-eight thousand
   * places borrowed from Pleiades, and the records people actually contributed
   * here. Given the same marker they are indistinguishable, and the borrowed
   * ones outnumber the contributed ones badly enough to make the atlas look
   * like the work. Pencil on the printed sheet, ink for what is ours.
   */
  reference?: boolean
}

/**
 * Drawn with `Path2D` rather than an SVG data URL on purpose: this is
 * synchronous, so the images are in place before the symbol layer is added.
 * An image loaded through `Image.onload` arrives a frame or two later, and
 * MapLibre draws nothing at all for a marker whose icon is missing.
 */
const rasteriseIcon = (request: IconRasterRequest): ImageData | null => {
  const canvas = document.createElement('canvas')
  canvas.width = ICON_RASTER_PIXELS
  canvas.height = ICON_RASTER_PIXELS

  const context = canvas.getContext('2d')
  if (!context) return null

  const scale = ICON_RASTER_PIXELS / ICON_VIEWBOX
  context.scale(scale, scale)
  context.lineJoin = 'round'
  context.lineCap = 'round'

  if (!request.reference) {
    context.beginPath()
    context.arc(12, 12, 10.4, 0, Math.PI * 2)
    context.fillStyle = request.palette.ground
    context.fill()
    context.strokeStyle = request.palette.ring
    context.lineWidth = 1
    context.stroke()
  }

  context.strokeStyle = request.ink
  context.lineWidth = request.reference ? 1.1 : 1.6
  context.stroke(new Path2D(request.path))

  return context.getImageData(0, 0, ICON_RASTER_PIXELS, ICON_RASTER_PIXELS)
}

/**
 * Registers one image per category on the map. Call once per style: `setStyle`
 * discards the image registry along with the sources, and a marker whose icon
 * has gone missing disappears without an error.
 *
 * Both calls below fire a `styledata` event, so anything listening on that to
 * rebuild the overlay will re-enter here. `attachOverlay` orders itself around
 * that; see the comment there before moving this call.
 */
export const registerSiteIcons = (map: MapLibreMap, palette: SiteIconPalette): void => {
  for (const category of SITE_CATEGORIES) {
    const image = rasteriseIcon({
      path: SITE_ICON_PATHS[category],
      ink: category === 'infrastructure' ? palette.linear : palette.ink,
      palette,
    })
    if (!image) continue

    const id = siteIconId(category)
    if (map.hasImage(id)) map.removeImage(id)
    map.addImage(id, image, { pixelRatio: ICON_PIXEL_RATIO })
  }
}

/** Line work for a borrowed place — the same glyphs, drawn as annotation. */
export const ATLAS_MARK_INK = '#8c8271'

/**
 * The antiquity sheet's own marks, registered alongside the record markers
 * because both are wiped by `setStyle` and both are rebuilt from one place.
 * Cheap enough to register unconditionally: nine more canvases, drawn once per
 * style change, and the alternative is a second hook that has to know which
 * basemap is showing.
 */
export const registerAtlasIcons = (map: MapLibreMap, palette: SiteIconPalette): void => {
  for (const category of SITE_CATEGORIES) {
    const image = rasteriseIcon({
      path: SITE_ICON_PATHS[category],
      ink: ATLAS_MARK_INK,
      palette,
      reference: true,
    })
    if (!image) continue

    const id = atlasIconId(category)
    if (map.hasImage(id)) map.removeImage(id)
    map.addImage(id, image, { pixelRatio: ICON_PIXEL_RATIO })
  }
}

/**
 * `match` on the category, falling back to the 'other' mark. Built from the
 * path record so a new category cannot be added without also getting a marker,
 * and an unrecognised one still draws something rather than nothing.
 */
export const buildSiteIconExpression = (): ExpressionSpecification =>
  [
    'match',
    ['get', 'category'],
    ...SITE_CATEGORIES.flatMap((category) => [category, siteIconId(category)]),
    siteIconId('other'),
    // A spread cannot satisfy the tuple shape `match` is typed with, though the
    // value it produces is exactly that shape.
  ] as unknown as ExpressionSpecification

/**
 * The same match against the atlas marks. Its fallback is an empty string
 * rather than the 'other' glyph: a Pleiades record with no category is a river
 * or a mountain, which belongs on the sheet as a name and not as a place, and
 * MapLibre draws no icon for an empty `icon-image`.
 */
export const buildAtlasIconExpression = (): ExpressionSpecification =>
  [
    'match',
    ['get', 'category'],
    ...SITE_CATEGORIES.flatMap((category) => [category, atlasIconId(category)]),
    '',
  ] as unknown as ExpressionSpecification

const LIMES_ICON_PREFIX = 'vestigian-limes-'

export const limesIconId = (mark: LimesMark): string => `${LIMES_ICON_PREFIX}${mark}`

/**
 * The frontier's own marks — a plan, not an elevation.
 *
 * Every other glyph in this file is drawn as the thing would look standing in
 * front of you, which is right for a sheet where each mark is a separate place.
 * These are drawn as the thing looks from above, because a frontier is read
 * from above: the playing-card rectangle of a Roman fort, with its rounded
 * corners and its two gates, is the single most recognisable plan in Roman
 * archaeology and it does not need a caption. Rank comes from size and from how
 * much is inside, so a tower, a fortlet, a fort and a legionary fortress sort
 * themselves down a line without a legend.
 */
export const LIMES_ICON_PATHS: Record<LimesMark, string> = {
  /**
   * A tower inside its enclosure: the small square is the tower, the larger one
   * the ditch and palisade around it.
   *
   * It was first drawn with four sight lines radiating out, which is what a
   * watchtower was for and which at map size collapsed into a plus sign in a
   * circle — the most generic mark it is possible to draw. Nested squares
   * survive being small, which is the only property that matters at 20 pixels.
   */
  watchtower: 'M7.4 7.4h9.2v9.2H7.4zM10.4 10.4h3.2v3.2h-3.2z',

  /** The fort plan at its smallest — rounded corners, one gate, nothing inside. */
  fortlet:
    'M8.6 8.8h6.8a1.8 1.8 0 0 1 1.8 1.8v3.8a1.8 1.8 0 0 1-1.8 1.8H8.6a1.8 1.8 0 0 1-1.8-1.8v-3.8a1.8 1.8 0 0 1 1.8-1.8M12 6.9v1.9',

  /** The playing card: rounded corners, four gates, the via principalis across it. */
  fort: 'M7.6 6.8h8.8a2.4 2.4 0 0 1 2.4 2.4v5.6a2.4 2.4 0 0 1-2.4 2.4H7.6a2.4 2.4 0 0 1-2.4-2.4V9.2a2.4 2.4 0 0 1 2.4-2.4M5.2 12h13.6M12 6.8v10.4',

  /** The same plan doubled: a legionary fortress is a fort with a fort inside it. */
  fortress:
    'M6 5.9h12a2.1 2.1 0 0 1 2.1 2.1v8a2.1 2.1 0 0 1-2.1 2.1H6A2.1 2.1 0 0 1 3.9 16V8A2.1 2.1 0 0 1 6 5.9M8.3 9.1h7.4a1.2 1.2 0 0 1 1.2 1.2v3.4a1.2 1.2 0 0 1-1.2 1.2H8.3a1.2 1.2 0 0 1-1.2-1.2v-3.4a1.2 1.2 0 0 1 1.2-1.2',

  /** A marching camp: the same shape, dug in a day and never finished. */
  camp: 'M7.6 7.6h3M13.4 7.6h3a2 2 0 0 1 2 2v1.4M18.4 13.4v1a2 2 0 0 1-2 2h-3M10.6 16.4h-3a2 2 0 0 1-2-2v-1M5.6 11v-1.4a2 2 0 0 1 2-2',
}

/**
 * Registered like the other two sets, and for the same reason: `setStyle` wipes
 * the image registry, so everything the map might draw is rebuilt from one
 * place after every style change. Five more canvases.
 *
 * Both a record's mark and a borrowed place's mark come from here. They are
 * told apart by the disc, exactly as elsewhere on the sheet — ink for what is
 * ours, pencil for what is referenced — so the frontier does not quietly
 * inflate Pleiades' 2,700 military places into contributions.
 */
export const registerLimesIcons = (map: MapLibreMap, palette: SiteIconPalette): void => {
  for (const mark of LIMES_MARKS) {
    for (const reference of [false, true]) {
      const image = rasteriseIcon({
        path: LIMES_ICON_PATHS[mark],
        ink: reference ? ATLAS_MARK_INK : palette.ink,
        palette,
        reference,
      })
      if (!image) continue

      const id = reference ? `${limesIconId(mark)}-reference` : limesIconId(mark)
      if (map.hasImage(id)) map.removeImage(id)
      map.addImage(id, image, { pixelRatio: ICON_PIXEL_RATIO })
    }
  }
}

/**
 * The mark for a contributed record on the frontier, matched on vici's own kind.
 *
 * Falls back to the fortification glyph rather than to a fort: most of the
 * 12,804 records in that category came from vici with a kind this vocabulary
 * does not translate, and promoting all of them to forts would put a fort plan
 * on every hillfort and city wall along the Rhine.
 */
export const buildLimesRecordIconExpression = (): ExpressionSpecification =>
  [
    'match',
    ['get', 'subcategory'],
    // Matched on vici's word, not on the mark's name. The two coincide for all
    // three kinds today, which is exactly why this must not be written as if
    // they were the same vocabulary.
    ...Object.entries(VICI_MARKS).flatMap(([kind, mark]) => [kind, limesIconId(mark)]),
    siteIconId('fortification'),
  ] as unknown as ExpressionSpecification

/**
 * The mark for a borrowed place on the frontier. Drawn as annotation, like
 * every other Pleiades mark on the sheet, and falling back to nothing: a
 * military place Pleiades classifies only as a stretch of wall is part of the
 * frontier without being a post on it.
 */
export const buildLimesReferenceIconExpression = (): ExpressionSpecification =>
  [
    'match',
    ['get', 'mark'],
    ...LIMES_MARKS.flatMap((mark) => [mark, `${limesIconId(mark)}-reference`]),
    '',
  ] as unknown as ExpressionSpecification

export const BATTLE_ICON_ID = 'vestigian-battle'

/**
 * Two crossed blades, hilts out at the bottom corners — the one mark on this
 * map for an event rather than a place. Always drawn as the reference/pencil
 * variant: every row behind it is borrowed from Wikidata, never a
 * contribution, the same reasoning `registerLimesIcons` and
 * `registerAtlasIcons` already give for the marks they draw.
 */
export const BATTLE_ICON_PATH =
  'M6 6l12 12M18 6L6 18M6 6l-1.5-.5M6 6l-.5-1.5M18 6l1.5-.5M18 6l.5-1.5M6 18l-1.5.5M6 18l-.5 1.5M18 18l1.5.5M18 18l.5 1.5'

/**
 * Registered alongside the other reference marks, for the same reason: one
 * more canvas, drawn once per style change, cheaper than a second hook that
 * has to know whether "Show battles" is on.
 */
export const registerBattleIcon = (map: MapLibreMap, palette: SiteIconPalette): void => {
  const image = rasteriseIcon({
    path: BATTLE_ICON_PATH,
    ink: ATLAS_MARK_INK,
    palette,
    reference: true,
  })
  if (!image) return

  if (map.hasImage(BATTLE_ICON_ID)) map.removeImage(BATTLE_ICON_ID)
  map.addImage(BATTLE_ICON_ID, image, { pixelRatio: ICON_PIXEL_RATIO })
}

export const PORT_ICON_ID = 'vestigian-port'

/**
 * An anchor: ring, shank, stock and two flukes. Always drawn as the
 * reference/pencil variant — every row behind it is borrowed from the
 * Catalogue of Ancient Ports, never a contribution, the same reasoning
 * `registerBattleIcon` already gives.
 */
export const PORT_ICON_PATH =
  'M9.8 5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0M12 7.2V17M8 9.5h8M12 17a6 6 0 0 1 -6 -4M12 17a6 6 0 0 0 6 -4'

/**
 * Registered alongside the other reference marks, for the same reason as
 * `registerBattleIcon`: one more canvas, cheaper than a second hook that
 * has to know whether "Show ports" is on.
 */
export const registerPortIcon = (map: MapLibreMap, palette: SiteIconPalette): void => {
  const image = rasteriseIcon({
    path: PORT_ICON_PATH,
    ink: ATLAS_MARK_INK,
    palette,
    reference: true,
  })
  if (!image) return

  if (map.hasImage(PORT_ICON_ID)) map.removeImage(PORT_ICON_ID)
  map.addImage(PORT_ICON_ID, image, { pixelRatio: ICON_PIXEL_RATIO })
}

/**
 * AWMC's minor point features — bridges, mines/quarries, dams, cemeteries
 * and tumuli. `fort` has no glyph of its own here: it reuses
 * `atlasIconId('fortification')`, the same reference mark already drawn
 * for a Pleiades place classified as a fortification, since both are the
 * same thing — a fortification referenced from a source, not contributed
 * — and inventing a second glyph for it would draw two different marks
 * for one idea.
 */
export type MinorFeatureKind = 'bridge' | 'mine_quarry' | 'dam' | 'cemetery' | 'fort' | 'tumulus'

const MINOR_FEATURE_ICON_PREFIX = 'vestigian-feature-'

export const minorFeatureIconId = (kind: MinorFeatureKind): string =>
  kind === 'fort' ? atlasIconId('fortification') : `${MINOR_FEATURE_ICON_PREFIX}${kind}`

/** An arch bridge in elevation: deck, two piers, the arch beneath. */
export const BRIDGE_ICON_PATH = 'M4 14h16M6 14v4M18 14v4M4 14a8 5 0 0 1 16 0'

/** A pickaxe, angled — the tool, not the place, the same convention `findspot`'s amphora already uses. */
export const MINE_QUARRY_ICON_PATH = 'M5 19 15 9M13 7l4 4-2 2-4-4 2-2z'

/** A dam wall holding water back, water shown as two short crests upstream of it. */
export const DAM_ICON_PATH = 'M4 18h16M5 18v-7h4v-3h6v3h4v7M4 11h4M16 11h4'

/** A headstone with a cross, the same weight as `burial`'s stele but a different shape for a different Barrington layer. */
export const CEMETERY_ICON_PATH = 'M12 5v6M9.5 8h5M7 19a5 5 0 0 1 10 0z'

/** A burial mound — a low arc on the ground line, against `burial`'s standing stele. */
export const TUMULUS_ICON_PATH = 'M4 18.5h16M5 18.5a7 5 0 0 1 14 0'

export const MINOR_FEATURE_ICON_PATHS: Partial<Record<MinorFeatureKind, string>> = {
  bridge: BRIDGE_ICON_PATH,
  mine_quarry: MINE_QUARRY_ICON_PATH,
  dam: DAM_ICON_PATH,
  cemetery: CEMETERY_ICON_PATH,
  tumulus: TUMULUS_ICON_PATH,
}

/**
 * Registered alongside the other reference marks, for the same reason as
 * `registerBattleIcon`. `fort` is skipped here deliberately —
 * `registerAtlasIcons` already registers `atlasIconId('fortification')`,
 * and re-registering the same image id a second time would just repeat
 * that work every style load.
 */
export const registerMinorFeatureIcons = (map: MapLibreMap, palette: SiteIconPalette): void => {
  for (const [kind, path] of Object.entries(MINOR_FEATURE_ICON_PATHS)) {
    const image = rasteriseIcon({ path, ink: ATLAS_MARK_INK, palette, reference: true })
    if (!image) continue

    const id = minorFeatureIconId(kind as MinorFeatureKind)
    if (map.hasImage(id)) map.removeImage(id)
    map.addImage(id, image, { pixelRatio: ICON_PIXEL_RATIO })
  }
}

export const COIN_HOARD_ICON_ID = 'vestigian-coin-hoard'

/** A stack of coins: three overlapping ellipses in elevation. */
export const COIN_HOARD_ICON_PATH =
  'M6 9.5a6 2 0 1 0 12 0a6 2 0 1 0 -12 0M6 9.5v5a6 2 0 0 0 12 0v-5M6 12a6 2 0 0 0 12 0'

/**
 * Registered alongside the other reference marks, for the same reason as
 * `registerBattleIcon`.
 */
export const registerCoinHoardIcon = (map: MapLibreMap, palette: SiteIconPalette): void => {
  const image = rasteriseIcon({
    path: COIN_HOARD_ICON_PATH,
    ink: ATLAS_MARK_INK,
    palette,
    reference: true,
  })
  if (!image) return

  if (map.hasImage(COIN_HOARD_ICON_ID)) map.removeImage(COIN_HOARD_ICON_ID)
  map.addImage(COIN_HOARD_ICON_ID, image, { pixelRatio: ICON_PIXEL_RATIO })
}
