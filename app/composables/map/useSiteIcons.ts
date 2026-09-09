import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { LimesMark, SiteCategory } from '#shared/types'
import { LIMES_MARKS, VICI_MARKS } from '#shared/utils/limes'

/**
 * A drawn mark per category, so a fort reads as a fort at a glance rather than
 * as a coloured dot that has to be opened to be identified.
 *
 * Each glyph is a Lucide icon (ISC — MIT for the small subset of
 * Feather-derived glyphs, both permissive, verified against
 * `node_modules/@iconify-json/lucide` before use), not hand-drawn: Lucide is
 * already the project's icon system everywhere else (`i-lucide-*` via
 * `@nuxt/icon`, self-hosted through `@iconify-json/lucide` per
 * `nuxt.config.ts`), so map markers hand-drawing their own approximation of
 * icons the app already ships was the odd one out, not the norm. Paths are
 * taken verbatim from Lucide's 24×24, `stroke-width:2` source — multi-path
 * icons have their `<path>`/`<circle>` elements concatenated into one `d`
 * string (a circle becomes two arc commands), since `rasteriseIcon` below
 * takes a single path and `Path2D` parses the full SVG path grammar,
 * including arcs, from one string just as happily as from several.
 *
 * The paths are also the legend: `MapLegend` renders these same strings as
 * inline SVG, so the key on screen cannot drift from the marks on the map.
 *
 * Two families deliberately were not moved to Lucide: `LIMES_ICON_PATHS`
 * below (fort plans drawn in *plan* view, not elevation — nothing in a
 * general-purpose icon set represents "playing-card rectangle with two
 * gates seen from above") and the AWMC minor-feature/coin-hoard glyphs
 * further down this file (`BRIDGE_ICON_PATH`, `DAM_ICON_PATH`,
 * `TUMULUS_ICON_PATH`, `COIN_HOARD_ICON_PATH` — no Lucide icon covers a dam,
 * a burial mound in elevation, or a stack of coins drawn side-on). Forcing a
 * weak match there would have been worse than the specific-purpose glyph
 * already in place.
 */
export const SITE_ICON_PREFIX = 'vestigian-site-'

export const SITE_ICON_PATHS: Record<SiteCategory, string> = {
  /** Lucide `building-2` — a two-building skyline, which is what a town is. */
  settlement:
    'M10 12h4m-4-4h4m0 13v-3a2 2 0 0 0-4 0v3 M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2 M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16',

  /** Lucide `castle` — battlements, gate and towers; nothing else reads as a fort at a glance. */
  fortification:
    'M10 5V3m4 2V3m1 18v-3a3 3 0 0 0-6 0v3m9-18v8m0-6H6m16 6H2 M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9m4-6v8',

  /** Lucide `landmark` — pediment, columns, stylobate: a temple front by name. */
  sanctuary:
    'M10 18v-7m1.119-8.795a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949zM14 18v-7m4 7v-7M3 22h18M6 18v-7',

  /** Lucide `pyramid` — a burial monument shape, not the modern-cemetery cross `cemetery` below uses. */
  burial:
    'M2.5 16.88a1 1 0 0 1-.32-1.43l9-13.02a1 1 0 0 1 1.64 0l9 13.01a1 1 0 0 1-.32 1.44l-8.51 4.86a2 2 0 0 1-1.98 0ZM12 2v20',

  /** Lucide `milestone` — a roadside marker, standing in for the aqueduct/bridge/road category as a whole. */
  infrastructure:
    'M12 13v8m0-18v3m6.172 0a2 2 0 0 1 1.414.586l2.06 2.06a1.207 1.207 0 0 1 0 1.708l-2.06 2.06a2 2 0 0 1-1.414.586H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',

  /** Lucide `house` — one dwelling, against `settlement`'s several roofs. */
  villa:
    'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8 M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',

  /** Lucide `factory` — an industrial silhouette for kilns, workshops and mines alike. */
  production:
    'M12 16h.01M16 16h.01M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a.5.5 0 0 0-.769-.422l-4.462 2.844A.5.5 0 0 1 15 10.5v-2a.5.5 0 0 0-.769-.422L9.77 10.922A.5.5 0 0 1 9 10.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2zm5-3h.01',

  /** Lucide `amphora` — the object, not the place. */
  findspot:
    'M10 2v5.632c0 .424-.272.795-.653.982A6 6 0 0 0 6 14c.006 4 3 7 5 8 M10 5H8a2 2 0 0 0 0 4h.68M14 2v5.632c0 .424.272.795.652.982A6 6 0 0 1 18 14c0 4-3 7-5 8 M14 5h2a2 2 0 0 1 0 4h-.68M18 22H6M9 2h6',

  /** Lucide `crosshair` — a point recorded, nothing claimed about it. Circle converted to two arc commands, see file header. */
  other: 'M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12 M22 12h-4M6 12H2m10-6V2m0 20v-4',
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
 * Lucide `swords` — the one mark on this map for an event rather than a
 * place. Always drawn as the reference/pencil variant: every row behind it
 * is borrowed from Wikidata, never a contribution, the same reasoning
 * `registerLimesIcons` and `registerAtlasIcons` already give for the marks
 * they draw.
 */
export const BATTLE_ICON_PATH =
  'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6m-3 3l4 4m-1 1l2-2M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4m-2-1l-3 3m-1-1l2 2'

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
 * Lucide `anchor`. Always drawn as the reference/pencil variant — every row
 * behind it is borrowed from the Catalogue of Ancient Ports, never a
 * contribution, the same reasoning `registerBattleIcon` already gives.
 * Circle converted to two arc commands, see the file header.
 */
export const PORT_ICON_PATH =
  'M10 4A2 2 0 1 0 14 4A2 2 0 1 0 10 4 M12 6v16m7-9l2-1a9 9 0 0 1-18 0l2 1m4-2h6'

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

/** Lucide `pickaxe` — the tool, not the place, the same convention `findspot`'s amphora uses. */
export const MINE_QUARRY_ICON_PATH =
  'm14 13l-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999m4.973-5.972A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024m4 4.001a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 1.676 2.603.278A13 13 0 0 0 20 8.069 M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l5.296-5.296a1.205 1.205 0 0 0 0-1.704z'

/** A dam wall holding water back, water shown as two short crests upstream of it. No Lucide icon covers this. */
export const DAM_ICON_PATH = 'M4 18h16M5 18v-7h4v-3h6v3h4v7M4 11h4M16 11h4'

/** Lucide `cross` — the everyday cemetery symbol, against `burial`'s pyramid for an unmarked ancient grave. */
export const CEMETERY_ICON_PATH =
  'M4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a1 1 0 0 1 1 1v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a1 1 0 0 1 1-1h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4a1 1 0 0 1-1-1V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4a1 1 0 0 1-1 1z'

/** A burial mound — a low arc on the ground line, against `burial`'s pyramid. No Lucide icon covers this. */
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
