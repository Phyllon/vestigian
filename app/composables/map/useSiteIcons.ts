import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { SiteCategory } from '#shared/types'

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
export const SITE_ICON_PREFIX = 'vestigia-site-'

export const SITE_ICON_PATHS: Record<SiteCategory, string> = {
  /** A skyline of roofs — several dwellings, which is what a town is. */
  settlement:
    'M5 18.5h14M7 18.5v-4.5l2.75-2.5 2.75 2.5v4.5M12.5 18.5v-6.25l2.75-2.5 2.75 2.5v6.25',

  /** Crenellations. The one silhouette nothing else on the map can be mistaken for. */
  fortification: 'M5 18.5V10h2.8v2.6h2.8V10h2.8v2.6h2.8V10h2.8v8.5',

  /** A temple front: pediment, three columns, stylobate. */
  sanctuary: 'M5 11.5 12 6.2l7 5.3M6.5 11.5v7M12 11.5v7M17.5 11.5v7M5 18.5h14',

  /** A round-topped stele, inscribed, standing on the ground it marks. */
  burial: 'M5.5 18.5h13M8.8 18.5v-5.4a3.2 3.2 0 0 1 6.4 0v5.4M10.6 15.2h2.8',

  /** An arcade under a deck — aqueduct, bridge and road all at once. */
  infrastructure: 'M5 9.5h14M5 9.5v9M12 9.5v9M19 9.5v9M5 16a3.5 3.5 0 0 1 7 0M12 16a3.5 3.5 0 0 1 7 0',

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

export const SITE_CATEGORY_LABELS: Record<SiteCategory, string> = {
  settlement: 'Settlement',
  fortification: 'Fortification',
  sanctuary: 'Sanctuary',
  burial: 'Burial',
  infrastructure: 'Infrastructure',
  villa: 'Villa',
  production: 'Production',
  findspot: 'Findspot',
  other: 'Other',
}

export const SITE_CATEGORIES = Object.keys(SITE_ICON_PATHS) as SiteCategory[]

export const siteIconId = (category: SiteCategory): string => `${SITE_ICON_PREFIX}${category}`

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

  context.beginPath()
  context.arc(12, 12, 10.4, 0, Math.PI * 2)
  context.fillStyle = request.palette.ground
  context.fill()
  context.strokeStyle = request.palette.ring
  context.lineWidth = 1
  context.stroke()

  context.strokeStyle = request.ink
  context.lineWidth = 1.6
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
