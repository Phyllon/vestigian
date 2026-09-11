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
 * further down this file (`DAM_ICON_PATH`, `TUMULUS_ICON_PATH`,
 * `COIN_HOARD_ICON_PATH` — no Lucide icon covers a dam, a burial mound in
 * elevation, or a stack of coins drawn side-on). Forcing a weak match there
 * would have been worse than the specific-purpose glyph already in place.
 *
 * **Settlement, production, other, cemetery and bridge are a second
 * borrowed family — filled game-icons.net silhouettes, not stroked Lucide
 * outlines**, swapped in after the Lucide-only set above read as too
 * generic/modern for these five specifically (a skyline, a factory, a
 * crosshair, a plain cross and an arch don't say "ancient" the way a
 * thatched-roof village, a smith's anvil, a standing stone, a walled
 * graveyard or a dressed-stone span do). Every one of these is CC BY 3.0 —
 * checked directly against `game-icons.net`'s own licence page, which
 * states the whole set is released under it with attribution owed to the
 * individual artist credited in each icon's own filename. Delapouite:
 * `village`, `menhir`, `graveyard`, `stone-bridge`. Lorc: `anvil`. Paths are
 * copied verbatim from the artist's original 512×512 viewBox — game-icons
 * silhouettes are authored to fill that box edge to edge, unlike Lucide's
 * 24×24 outlines, which is why `IconGlyph.viewBox`/`filled` exist: a filled
 * icon is scaled and centred into an 18-unit box inside the shared 24-unit
 * icon space (`GAME_ICON_SCALE`/`GAME_ICON_OFFSET`) and drawn with `fill`
 * instead of `stroke`, rather than trying to force it through the same
 * stroke-width pipeline the outline family uses. `Legend.vue` and
 * `FeaturePicker.vue` apply the identical transform via SVG's own
 * `transform` attribute, so the map, the key and the picker cannot drift
 * apart on how a filled glyph is placed.
 */
export const SITE_ICON_PREFIX = 'vestigian-site-'

/** The coordinate space a glyph's `path` was authored in, and how it's painted. */
export interface IconGlyph {
  path: string
  /** 24 for a Lucide outline, 512 for a game-icons.net silhouette. */
  viewBox: number
  /** A filled game-icons.net silhouette rather than a stroked Lucide outline. */
  filled?: boolean
}

/** A Lucide outline glyph — the common case, spelled out once rather than at every call site. */
const outline = (path: string): IconGlyph => ({ path, viewBox: 24 })

/**
 * A filled game-icons.net glyph. `GAME_ICON_VIEWBOX` is the artist's own
 * source box; `GAME_ICON_TARGET_SIZE`/`GAME_ICON_OFFSET`/`GAME_ICON_SCALE`
 * (below) are what every renderer uses to fit it into the 24-unit space the
 * outline family already occupies.
 */
const GAME_ICON_VIEWBOX = 512

const filled = (path: string): IconGlyph => ({ path, viewBox: GAME_ICON_VIEWBOX, filled: true })

/**
 * Every renderer of a filled glyph — the canvas rasteriser here, `Legend.vue`,
 * `FeaturePicker.vue` — centres it into an 18-unit box inside the shared
 * 24-unit icon space, the same rough padding a Lucide outline already carries
 * inside its own 24-unit box, rather than letting a game-icons silhouette
 * (authored edge-to-edge) touch the disc's own ring.
 */
export const GAME_ICON_TARGET_SIZE = 18
export const GAME_ICON_OFFSET = (24 - GAME_ICON_TARGET_SIZE) / 2
export const GAME_ICON_SCALE = GAME_ICON_TARGET_SIZE / GAME_ICON_VIEWBOX

/** Lucide `village` was never a candidate — Lucide has no settlement glyph at all; delapouite's `village` (game-icons.net). */
const VILLAGE_ICON_PATH =
  'm109.902 35.87-71.14 59.284h142.28l-71.14-59.285zm288 32-71.14 59.284h142.28l-71.14-59.285zM228.73 84.403l-108.9 90.75h217.8l-108.9-90.75zm-173.828 28.75v62h36.81l73.19-60.992v-1.008h-110zm23 14h16v18h-16v-18zm265 18v10.963l23 19.166v-16.13h16v18h-13.756l.104.087 19.098 15.914h-44.446v14h78v-39h18v39h14v-62h-110zm-194.345 48v20.08l24.095-20.08h-24.095zm28.158 0 105.1 87.582 27.087-22.574v-65.008H176.715zm74.683 14h35.735v34h-35.735v-34zm-76.714 7.74L30.37 335.153H319l-144.314-120.26zm198.046 13.51-76.857 64.047 32.043 26.704H481.63l-108.9-90.75zm-23.214 108.75.103.086 19.095 15.914h-72.248v77.467h60.435v-63.466h50v63.467h46v-93.466H349.516zm-278.614 16V476.13h126v-76.976h50v76.977h31.565V353.155H70.902zm30 30h50v50h-50v-50z'

/** delapouite's `anvil` (game-icons.net, credited to Lorc). */
const ANVIL_ICON_PATH =
  'M128.688 115.594v147.75h285v-147.75h-285zm-111.844 20.47c17.374 47.14 54.372 80.413 94.906 93.81v-93.81H16.844zm414.375 12.31v88.657c21.457-9.083 42.92-25.257 64.374-47.374-21.52-22.562-42.633-35.173-64.375-41.28zm-226.25 132.47c-12.15 38.536-33.897 71.5-60.595 100.47l257.844-.002c-28.705-29.016-49.952-62.054-61.5-100.468H204.97zM101.843 400v43.78h337.562V400H101.844z'

/** delapouite's `menhir` (game-icons.net). */
const MENHIR_ICON_PATH =
  'M226.502 17.773c-44.12.506-112.97 320.03-100.887 386.12 10.002 54.708 84.118 85.005 133.518 89.68 49.062 4.644 114.82-14.037 126.773-100.86l-7.035 4.04c-.863 1.036-4.473 5.37-9.29 11.084-4.864 5.77-9.245 11.08-12.188 14.186l-.01.01a43.53 43.53 0 0 1-.86.892c.433-.43.698-.71.853-.88a3.07 3.07 0 0 0-.412.656c-.39.86-.95 2.25-1.555 3.895-1.213 3.292-2.647 7.642-3.988 11.91-2.684 8.538-5.018 16.766-5.018 16.766l-2.334 8.232-34.18-7.846-22.105 19.13-38.524-7.142 31.445-10.533 24.308-21.038 26.528 6.088c.954-3.25 1.25-4.41 2.71-9.05 1.39-4.423 2.874-8.952 4.27-12.737.697-1.893 1.362-3.59 2.058-5.12.696-1.533.725-2.56 3.22-5.054.074-.077 6.704-7.657 12.022-13.964 5.318-6.307 10.27-12.252 10.27-12.252l1.035-1.238 20.566-11.817c.035-1.1.074-2.198.093-3.317.154-9.013-6.625-36.675-17.723-72.682l-.414 3.11-36.853 7.065-2.662 11.654-17.548-4.01 5.283-23.11 35.654-6.838 3.114-23.37 2.053.275a1629.602 1629.602 0 0 0-17.592-49.64l-1.83 5.323-17.023-5.85 7.726-22.474 2.678.92c-10.27-26.297-21.314-52.413-32.593-75.998l-3.32 6.482 15.683 23.94-52.146 19.85 26.675-25.882-11.006-16.797 14.15-27.624c-7.455-14.38-14.925-27.348-22.248-38.298l-13.034 8.812.305-25.86c-10.21-11.97-19.914-18.937-28.61-18.837zm82.244 208.148 22.543 18.314-16.194 3.414-12.586 17.08-36.42-.568.28-17.998 27.15.423zm40.95 94.757 15.833 1.582-1.792 17.907-4.035-.402-17.22 31.104-30.75-20.13-31.03 7.79 31.545-28.964 23.877 15.63zM255.6 389.12l25.033 19-22.643 1.122-26.937 18.248-10.096-14.903z'

/** delapouite's `graveyard` (game-icons.net). */
const GRAVEYARD_ICON_PATH =
  'M128 73c-25.495 0-44.07 6.4-55.97 13.86C60.134 94.32 56 103.84 56 104.63v40.274c6.343 2.532 12.03 5.422 17.023 8.545C89.79 163.94 100 175.957 100 189.542v59.57c8.63-1.35 17.956-2.113 28-2.113s19.37.764 28 2.113v-59.57c0-13.585 10.21-25.604 26.977-36.094 4.992-3.124 10.68-6.014 17.023-8.546V104.63c0-.792-4.133-10.31-16.03-17.77C172.07 79.4 153.494 73 128 73zm256 0c-25.495 0-44.07 6.4-55.97 13.86-11.896 7.46-16.03 16.98-16.03 17.77v40.274c6.343 2.532 12.03 5.422 17.023 8.545C345.79 163.94 356 175.957 356 189.542v59.57c8.63-1.35 17.956-2.113 28-2.113s19.37.764 28 2.113v-59.57c0-13.585 10.21-25.604 26.977-36.094 4.992-3.124 10.68-6.014 17.023-8.546V104.63c0-.792-4.133-10.31-16.03-17.77C428.07 79.4 409.494 73 384 73zM119 91.086h18v31.63h45v18h-45v99.34h-18v-99.34H74v-18h45v-31.63zm256 0h18v31.63h45v18h-45v99.34h-18v-99.34h-45v-18h45v-31.63zM256 153c-28.832 0-49.91 7.222-63.477 15.71C178.958 177.195 174 187.946 174 189.542v63.494c12.076 3.43 22.355 8.07 30.77 13.33C222.37 277.367 233 290 233 304v58.715h46V304c0-14 10.63-26.632 28.23-37.633 8.415-5.26 18.694-9.9 30.77-13.33v-63.494c0-1.596-4.958-12.347-18.523-20.834C305.91 160.22 284.832 153 256 153zm-238 1.016v56.888h42.666v18H18v133.81h5V304c0-14 10.63-26.632 28.23-37.633 8.415-5.26 18.694-9.9 30.77-13.33v-63.494c0-1.596-4.958-12.347-18.523-20.834C52.917 162.1 37.78 156.28 18 154.015zm476 0c-19.78 2.263-34.916 8.086-45.477 14.693C434.958 177.195 430 187.946 430 189.542v63.494c12.076 3.43 22.355 8.07 30.77 13.33C478.37 277.367 489 290 489 304v58.715h5v-133.81h-42.666v-18H494v-56.89zM247 174.36h18v36.544h51.666v18H265v112.448h-18V228.904h-51.666v-18H247V174.36zM128 265c-30.5 0-52.83 7.633-67.23 16.633C46.37 290.633 41 302 41 304v183h174V304c0-2-5.37-13.368-19.77-22.367-14.4-9-36.73-16.633-67.23-16.633zm256 0c-30.5 0-52.83 7.633-67.23 16.633C302.37 290.633 297 302 297 304v183h174V304c0-2-5.37-13.368-19.77-22.367-14.4-9-36.73-16.633-67.23-16.633zm-265 23h18v39h55v18h-55v119h-18V345H64v-18h55v-39zm256 0h18v39h55v18h-55v119h-18V345h-55v-18h55v-39z'

/** delapouite's `stone-bridge` (game-icons.net) — replaces the arch this map used to draw for a bridge. */
const STONE_BRIDGE_ICON_PATH =
  'M25 265v71.11c7.526-4.42 17.73-10.278 30-16.98V265H25zm432 0v54.205a1117.058 1117.058 0 0 1 30 16.93V265h-30zm-201.49.28c-39.653.03-99.394 23.28-148.06 46.976-44.553 21.694-76.747 41.37-82.45 44.88V471h110.387c1.88-32.24 13.54-69.11 32.552-99.74 20.797-33.505 51.085-60.252 88.058-60.26 36.985-.008 67.298 26.736 88.12 60.244 19.038 30.635 30.72 67.51 32.603 99.756H487V357.145c-5.72-3.51-38.067-23.218-82.82-44.93-48.875-23.713-108.863-46.962-148.67-46.934z'

/**
 * Lucide `cog` — replaces `milestone` for `infrastructure`: a gear reads as
 * "built works and engineering" (aqueducts, roads, mills) at a glance more
 * generally than one roadside marker did, requested directly rather than
 * swapped to a game-icons silhouette like its four siblings above, since
 * Lucide already had a good fit here. Two circles converted to arc
 * commands, same technique as `other`'s crosshair, see the file header.
 */
const COG_ICON_PATH =
  'M11 10.27L7 3.34m4 10.39l-4 6.93M12 22v-2m0-18v2m2 8h8m-5 8.66l-1-1.73m1-15.59l-1 1.73M2 12h2m16.66 5l-1.73-1m1.73-9l-1.73 1M3.34 17l1.73-1M3.34 7l1.73 1 M10 12A2 2 0 1 0 14 12A2 2 0 1 0 10 12 M4 12A8 8 0 1 0 20 12A8 8 0 1 0 4 12'

export const SITE_ICON_GLYPHS: Record<SiteCategory, IconGlyph> = {
  /** delapouite's `village` (game-icons.net) — thatched roofs read as ancient in a way `building-2`'s skyline didn't. */
  settlement: filled(VILLAGE_ICON_PATH),

  /** Lucide `castle` — battlements, gate and towers; nothing else reads as a fort at a glance. */
  fortification: outline(
    'M10 5V3m4 2V3m1 18v-3a3 3 0 0 0-6 0v3m9-18v8m0-6H6m16 6H2 M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9m4-6v8',
  ),

  /** Lucide `landmark` — pediment, columns, stylobate: a temple front by name. */
  sanctuary: outline(
    'M10 18v-7m1.119-8.795a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949zM14 18v-7m4 7v-7M3 22h18M6 18v-7',
  ),

  /** Lucide `pyramid` — a burial monument shape, not the modern-cemetery cross `cemetery` below uses. */
  burial: outline(
    'M2.5 16.88a1 1 0 0 1-.32-1.43l9-13.02a1 1 0 0 1 1.64 0l9 13.01a1 1 0 0 1-.32 1.44l-8.51 4.86a2 2 0 0 1-1.98 0ZM12 2v20',
  ),

  /** Lucide `cog` — see `COG_ICON_PATH`'s docstring. */
  infrastructure: outline(COG_ICON_PATH),

  /** Lucide `house` — one dwelling, against `settlement`'s several roofs. */
  villa: outline(
    'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8 M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ),

  /** delapouite's `anvil` (game-icons.net, credited to Lorc) — a smith's tool for kilns, forges and workshops alike, against `factory`'s modern chimneys. */
  production: filled(ANVIL_ICON_PATH),

  /** Lucide `amphora` — the object, not the place. */
  findspot: outline(
    'M10 2v5.632c0 .424-.272.795-.653.982A6 6 0 0 0 6 14c.006 4 3 7 5 8 M10 5H8a2 2 0 0 0 0 4h.68M14 2v5.632c0 .424.272.795.652.982A6 6 0 0 1 18 14c0 4-3 7-5 8 M14 5h2a2 2 0 0 1 0 4h-.68M18 22H6M9 2h6',
  ),

  /** delapouite's `menhir` (game-icons.net) — a standing stone, against `crosshair`'s modern surveying mark. */
  other: filled(MENHIR_ICON_PATH),
}

export const SITE_CATEGORIES = Object.keys(SITE_ICON_GLYPHS) as SiteCategory[]

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

/** Width for the halo drawn behind a reference mark, in 24-unit space. Colour comes from the palette. */
const REFERENCE_HALO_WIDTH = 3.2
/** The default halo colour — a pale wash, for a dark reference ink. */
const REFERENCE_HALO_COLOUR = 'rgba(250, 247, 239, 0.85)'

export interface SiteIconPalette {
  /** Line work for most categories. */
  ink: string
  /** Line work for infrastructure, tying a bridge or a milestone to the bronze tracings. */
  linear: string
  /** The disc the glyph sits on, so it stays legible over a busy basemap. */
  ground: string
  /** The disc's edge. */
  ring: string
  /**
   * Reported: a halo alone still left reference marks (no disc, previously a
   * fixed mid-tone `ATLAS_MARK_INK`) too faint to read over DARE's raster
   * imagery and the satellite view. Set only while one of those two basemaps
   * is active (`useViewportTiles`'s `palette`, from `useBasemapStyle`'s
   * `view`) — a vector sheet's contrast problem, if any, is a palette
   * problem, not something a halo fixes.
   */
  haloOnRaster?: boolean
  /**
   * Reported directly, twice more, after the halo above: reference marks
   * were "still barely viewable in some conditions" and needed "a whole
   * different colour" per basemap, not just a darker version of the same
   * one. `useViewportTiles`'s `palette` now sets this per `view`:
   * `antiquity-dare` and `antiquity-awmc` get `LIGHT_OVERLAY.ink` (the same
   * dark ink a contributed marker's disc already uses — measured at
   * 7.9–12.8:1 against Barrington's four flat fills, up from
   * `ATLAS_MARK_INK`'s 2.26–3.24:1, under WCAG 1.4.11's 3:1 floor for
   * graphical objects in three of the four); `vestigian` gets it too, but
   * only in light mode, on request, left unset in dark mode; `satellite`
   * gets a fixed high-visibility yellow (`SATELLITE_REFERENCE_INK`) instead
   * of a darker version of the same ink, since real photography ranges from
   * near-black water to bright sand and no single dark tone survives all of
   * it — see `haloColour` below for the half of that pairing this field
   * alone can't cover.
   */
  referenceInk?: string
  /**
   * The halo's own colour, overriding `REFERENCE_HALO_COLOUR`'s default pale
   * wash. Only `satellite` sets this (to a dark tone, `useViewportTiles.ts`):
   * pairing a light reference ink with a light halo leaves both halves of
   * the pair failing together against the same pale sand or snow a
   * photograph can just as easily show. Measured against real sampled
   * satellite tile colours: `SATELLITE_REFERENCE_INK` alone reaches
   * 4.1–11.6:1 against dark forest/ocean/mid-green tiles but only 1.2–2.1:1
   * against snow, sand or light urban roofs; a dark halo underneath reaches
   * 5.9–16.5:1 against exactly those light tiles. Together, one half of the
   * pair contrasts with whatever the photograph actually shows at that
   * pixel — the same reasoning `haloOnRaster` already relies on, just with
   * the ink and the halo swapped from "dark ink, pale halo" to "light ink,
   * dark halo" for this one basemap.
   */
  haloColour?: string
}

interface IconRasterRequest {
  glyph: IconGlyph
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

  const path = new Path2D(request.glyph.path)

  if (request.glyph.filled) {
    context.save()
    context.translate(GAME_ICON_OFFSET, GAME_ICON_OFFSET)
    context.scale(GAME_ICON_SCALE, GAME_ICON_SCALE)

    if (request.reference && request.palette.haloOnRaster) {
      context.lineJoin = 'round'
      context.strokeStyle = request.palette.haloColour ?? REFERENCE_HALO_COLOUR
      // `context.lineWidth` is read in the *native* 512-unit game-icon space
      // this block is scaled into, not the 24-unit space every other glyph
      // draws in — a width of `REFERENCE_HALO_WIDTH` here would come out
      // `GAME_ICON_SCALE` times thinner once rendered (was set to a flat
      // `26`, rendering under 1px on screen — invisible in practice, which
      // is exactly the "still bad on DARE/satellite" report). Dividing
      // undoes that compounding so the halo reads the same width as the
      // outline family's below, confirmed by comparing rendered pixel widths.
      context.lineWidth = REFERENCE_HALO_WIDTH / GAME_ICON_SCALE
      context.stroke(path)
    }

    context.fillStyle = request.ink
    context.fill(path)
    context.restore()
    return context.getImageData(0, 0, ICON_RASTER_PIXELS, ICON_RASTER_PIXELS)
  }

  if (request.reference && request.palette.haloOnRaster) {
    context.strokeStyle = request.palette.haloColour ?? REFERENCE_HALO_COLOUR
    context.lineWidth = REFERENCE_HALO_WIDTH
    context.stroke(path)
  }

  context.strokeStyle = request.ink
  context.lineWidth = request.reference ? 1.1 : 1.6
  context.stroke(path)

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
      glyph: SITE_ICON_GLYPHS[category],
      ink: category === 'infrastructure' ? palette.linear : palette.ink,
      palette,
    })
    if (!image) continue

    const id = siteIconId(category)
    if (map.hasImage(id)) map.removeImage(id)
    map.addImage(id, image, { pixelRatio: ICON_PIXEL_RATIO })
  }
}

/** Line work for a borrowed place — the same glyphs, drawn as annotation. Superseded per-basemap by `SiteIconPalette.referenceInk`; kept as the fallback for any view that doesn't set one. */
export const ATLAS_MARK_INK = '#8c8271'

/**
 * A fixed high-visibility yellow, not a darker version of `ATLAS_MARK_INK` —
 * real satellite photography ranges from near-black water to bright sand,
 * and no single dark tone reads against all of it (measured: a dark ink
 * reaches only 1.0–2.3:1 against a dark forest, ocean or mid-green tile in
 * this app's own imagery). This red instead reaches 4.1–11.6:1 against
 * those same dark tiles; `SiteIconPalette.haloColour`'s dark override
 * covers the light tiles (snow, sand, pale roofs) this colour alone can't.
 * Set only for `satellite` (`useViewportTiles.ts`'s `palette`) — a
 * deliberate, requested exception to this app's "one accent, the oxide red"
 * rule, since it exists for legibility over unpredictable photography, not
 * for decoration.
 */
export const SATELLITE_REFERENCE_INK = '#ff4000'

/** `palette.referenceInk` where the active basemap sets one, `ATLAS_MARK_INK` everywhere else — see `SiteIconPalette.referenceInk`'s docstring. */
const referenceInk = (palette: SiteIconPalette): string => palette.referenceInk ?? ATLAS_MARK_INK

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
      glyph: SITE_ICON_GLYPHS[category],
      ink: referenceInk(palette),
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
        glyph: outline(LIMES_ICON_PATHS[mark]),
        ink: reference ? referenceInk(palette) : palette.ink,
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
    glyph: outline(BATTLE_ICON_PATH),
    ink: referenceInk(palette),
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
    glyph: outline(PORT_ICON_PATH),
    ink: referenceInk(palette),
    palette,
    reference: true,
  })
  if (!image) return

  if (map.hasImage(PORT_ICON_ID)) map.removeImage(PORT_ICON_ID)
  map.addImage(PORT_ICON_ID, image, { pixelRatio: ICON_PIXEL_RATIO })
}

export const INSCRIPTION_ICON_ID = 'vestigian-inscription'

/**
 * Lucide `scroll-text` — two `<path>` elements flattened into one `d`
 * string, the same technique this file already uses for a `<circle>`.
 * Deliberately not `landmark` (already the app-menu icon for `/inscriptions`
 * — a map marker wants a mark distinct from a menu glyph) and not any
 * cemetery/grave-specific icon, since the corpus is funerary, votive,
 * honorific and building inscriptions alike, not tombstones exclusively.
 */
export const INSCRIPTION_ICON_PATH =
  'M15 12h-5m5-4h-5m9 9V5a2 2 0 0 0-2-2H4 M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3'

/**
 * Registered alongside the other reference marks, for the same reason as
 * `registerPortIcon`: one more canvas, cheaper than a second hook that has
 * to know whether "Show inscriptions" is on.
 */
export const registerInscriptionIcon = (map: MapLibreMap, palette: SiteIconPalette): void => {
  const image = rasteriseIcon({
    glyph: outline(INSCRIPTION_ICON_PATH),
    ink: referenceInk(palette),
    palette,
    reference: true,
  })
  if (!image) return

  if (map.hasImage(INSCRIPTION_ICON_ID)) map.removeImage(INSCRIPTION_ICON_ID)
  map.addImage(INSCRIPTION_ICON_ID, image, { pixelRatio: ICON_PIXEL_RATIO })
}

export const ATTIC_INSCRIPTION_ICON_ID = 'vestigian-attic-inscription'

/**
 * Lucide `scroll` — an unrolled scroll with no text lines, deliberately
 * distinct from `INSCRIPTION_ICON_PATH` (`scroll-text`, EDH's mark): the
 * two overlays can be switched on together and cluster in the same small
 * area around Athens, so they need marks a reader can actually tell apart
 * at a glance, not two near-identical scrolls.
 */
export const ATTIC_INSCRIPTION_ICON_PATH =
  'M19 17V5a2 2 0 0 0-2-2H4 M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3'

/** Registered alongside `registerInscriptionIcon`, same reasoning. */
export const registerAtticInscriptionIcon = (map: MapLibreMap, palette: SiteIconPalette): void => {
  const image = rasteriseIcon({
    glyph: outline(ATTIC_INSCRIPTION_ICON_PATH),
    ink: referenceInk(palette),
    palette,
    reference: true,
  })
  if (!image) return

  if (map.hasImage(ATTIC_INSCRIPTION_ICON_ID)) map.removeImage(ATTIC_INSCRIPTION_ICON_ID)
  map.addImage(ATTIC_INSCRIPTION_ICON_ID, image, { pixelRatio: ICON_PIXEL_RATIO })
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

/** Lucide `pickaxe` — the tool, not the place, the same convention `findspot`'s amphora uses. */
export const MINE_QUARRY_ICON_PATH =
  'm14 13l-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999m4.973-5.972A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024m4 4.001a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 1.676 2.603.278A13 13 0 0 0 20 8.069 M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l5.296-5.296a1.205 1.205 0 0 0 0-1.704z'

/** A dam wall holding water back, water shown as two short crests upstream of it. No Lucide icon covers this. */
export const DAM_ICON_PATH = 'M4 18h16M5 18v-7h4v-3h6v3h4v7M4 11h4M16 11h4'

/** A burial mound — a low arc on the ground line, against `burial`'s pyramid. No Lucide icon covers this. */
export const TUMULUS_ICON_PATH = 'M4 18.5h16M5 18.5a7 5 0 0 1 14 0'

export const MINOR_FEATURE_ICON_GLYPHS: Partial<Record<MinorFeatureKind, IconGlyph>> = {
  /** delapouite's `stone-bridge` (game-icons.net) — see `STONE_BRIDGE_ICON_PATH`'s docstring. */
  bridge: filled(STONE_BRIDGE_ICON_PATH),
  mine_quarry: outline(MINE_QUARRY_ICON_PATH),
  dam: outline(DAM_ICON_PATH),
  /** delapouite's `graveyard` (game-icons.net) — see `GRAVEYARD_ICON_PATH`'s docstring. */
  cemetery: filled(GRAVEYARD_ICON_PATH),
  tumulus: outline(TUMULUS_ICON_PATH),
}

/**
 * Registered alongside the other reference marks, for the same reason as
 * `registerBattleIcon`. `fort` is skipped here deliberately —
 * `registerAtlasIcons` already registers `atlasIconId('fortification')`,
 * and re-registering the same image id a second time would just repeat
 * that work every style load.
 */
export const registerMinorFeatureIcons = (map: MapLibreMap, palette: SiteIconPalette): void => {
  for (const [kind, glyph] of Object.entries(MINOR_FEATURE_ICON_GLYPHS)) {
    const image = rasteriseIcon({ glyph, ink: referenceInk(palette), palette, reference: true })
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
    glyph: outline(COIN_HOARD_ICON_PATH),
    ink: referenceInk(palette),
    palette,
    reference: true,
  })
  if (!image) return

  if (map.hasImage(COIN_HOARD_ICON_ID)) map.removeImage(COIN_HOARD_ICON_ID)
  map.addImage(COIN_HOARD_ICON_ID, image, { pixelRatio: ICON_PIXEL_RATIO })
}
