/**
 * Mirrors a raster basemap pyramid into object storage.
 *
 * Two servers publish tiles under a licence that permits reuse:
 *
 *   dare       https://dh.gu.se/tiles/imperium/  Digital Atlas of the Roman
 *              Empire, Johan Åhlfeldt, Centre for Digital Humanities,
 *              Gothenburg. CC BY-SA 3.0 per imperium.ahlfeldt.se/info_api.php.
 *              Note that DARE's own legend credits two inputs as CC BY-NC 3.0
 *              and CC BY-NC-SA, which the blanket BY-SA cannot cover;
 *              acceptable while nothing here is sold.
 *   satellite  https://tiles.maps.eox.at/  Sentinel-2 cloudless, EOX IT
 *              Services GmbH (Vienna, Austria), built from ESA Copernicus
 *              Sentinel-2 open data. This mirrors the 2025 vintage, CC
 *              BY-NC-SA 4.0 — same "acceptable while nothing here is sold"
 *              trade-off as DARE above, not a coincidence. **EOX's tile path
 *              is z/row/col, not the z/x/y every other source here uses** —
 *              `urlTemplate` below has `{y}` before `{x}` for exactly that
 *              reason; storage keys still use this project's own `z/x/y`
 *              convention regardless, so a mirrored pull-zone URL reads
 *              exactly like DARE's does.
 *
 * The other antiquity sheet is not mirrored and never was. The CAWM tile server
 * publishes physical relief only — no roads, names or settlements — so copying
 * it would have bought a beautiful empty map. Its information is published
 * separately as open data and is imported by `pnpm import:atlas` instead.
 *
 * Permission is not the same as bandwidth. Like the photograph mirror, this is
 * deliberately slow and single-threaded: a parallel crawl of tens of thousands
 * of tiles off someone else's server is indistinguishable from an attack. Tell
 * the source before the full run and quote the real figures this script
 * prints — johan.ahlfeldt@lir.gu.se for DARE, cloudless@eox.at for the
 * satellite tiles. Prove the setup first with MIRROR_LIMIT=5.
 *
 * Hotlinking instead would push that same traffic onto them permanently and
 * once per visitor rather than once in total, which is why the pyramid is
 * copied at all; vici.org mirrors the DARE tileset for the same reason.
 *
 * Resumable: a tile already in storage costs a HEAD against our own bucket and
 * no request to the origin, so an interrupted run is restarted freely and a
 * second full run is nearly free.
 *
 *   pnpm import:basemap dare
 *   pnpm import:basemap satellite
 *   MIRROR_LIMIT=5 pnpm import:basemap dare
 */
import {
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { detectImageFormat, type AcceptedImageFormat } from '../../server/utils/uploads'

const EXTENSION_FOR_FORMAT: Record<AcceptedImageFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
}

const CONTENT_TYPE_FOR_FORMAT: Record<AcceptedImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** Pause between requests to the source server, in milliseconds. */
const REQUEST_INTERVAL = 200

/**
 * DARE holds z3–z11, and z11 alone is three quarters of the pyramid for a
 * level the base is never read at — sites are individual markers by then and
 * the sheet underneath is scenery. Stopping at 10 and letting MapLibre
 * overzoom by a factor of two costs a little sharpness and saves ~89,000
 * tiles. `DARE_MAX_ZOOM` in useBasemapStyle.ts must agree with this.
 *
 * The satellite mirror stops at 13 instead — measured against a real sample
 * (see `SATELLITE_MAX_ZOOM`'s own docstring in useBasemapStyle.ts): Sentinel-2's
 * ~10m/pixel ground resolution lands almost exactly there, so a deeper mirror
 * would only be storing the upstream server's own upsampling.
 * `MIRROR_MAX_ZOOM` overrides either default (set per tileset below) for a
 * single run.
 */
const MIN_ZOOM = 3

/**
 * Europe, the Mediterranean and the North African coast — where the imported
 * records are. Mirroring the whole world would multiply the request count by
 * an order of magnitude for tiles holding nothing but ocean.
 */
const BBOX = { west: -12, south: 30, east: 45, north: 62 }

/**
 * Caps the run. Worth a small number on the first pass: it proves the storage
 * credentials, the bucket and the format check before committing someone
 * else's server to a day of traffic.
 */
const MIRROR_LIMIT = Number(process.env.MIRROR_LIMIT ?? Number.POSITIVE_INFINITY)

/**
 * CAWM answers above its maximum zoom with a 116-byte blank PNG rather than a
 * 404, which is a valid image and would be stored as one. Anything this small
 * is not cartography.
 */
const MIN_TILE_BYTES = 200

interface Tileset {
  urlTemplate: string
  prefix: string
  attribution: string
  format: AcceptedImageFormat
  maxZoom: number
  /** What to tell the operator to set once the mirror exists. */
  envVar: string
}

const TILESETS: Record<string, Tileset> = {
  dare: {
    urlTemplate: 'https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png',
    prefix: 'basemap/dare',
    attribution: 'Digital Atlas of the Roman Empire, Johan Åhlfeldt (CC BY-SA 3.0)',
    format: 'png',
    maxZoom: 10,
    envVar: 'NUXT_PUBLIC_BASEMAP_ANTIQUITY_DARE_URL',
  },
  satellite: {
    // z/row/col — see the module docstring above.
    urlTemplate:
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
    prefix: 'basemap/satellite',
    attribution:
      'Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025, CC BY-NC-SA 4.0)',
    format: 'jpeg',
    maxZoom: 13,
    envVar: 'NUXT_PUBLIC_BASEMAP_SATELLITE_URL',
  },
}

/**
 * The fallbacks match docker/compose.dev.yml. Without them an unset environment
 * points the client at real AWS with empty credentials, and every upload fails
 * on a message that says nothing about the actual mistake.
 */
const storage = new S3Client({
  region: process.env.NUXT_STORAGE_REGION ?? 'us-east-1',
  endpoint: process.env.NUXT_STORAGE_ENDPOINT ?? 'http://127.0.0.1:9000',
  credentials: {
    accessKeyId: process.env.NUXT_STORAGE_ACCESS_KEY_ID ?? 'vestigian',
    secretAccessKey: process.env.NUXT_STORAGE_SECRET_ACCESS_KEY ?? 'vestigian-dev-secret',
  },
  forcePathStyle: true,
})

const BUCKET = process.env.NUXT_STORAGE_BUCKET ?? 'vestigian'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface TileAddress {
  z: number
  x: number
  y: number
}

const longitudeToColumn = (longitude: number, zoom: number): number =>
  Math.floor(((longitude + 180) / 360) * 2 ** zoom)

/**
 * Web Mercator's y is a logarithm of latitude, not a linear share of it, which
 * is why this is not the mirror image of the longitude conversion.
 */
const latitudeToRow = (latitude: number, zoom: number): number => {
  const radians = (latitude * Math.PI) / 180
  const mercator = Math.log(Math.tan(radians) + 1 / Math.cos(radians))
  return Math.floor(((1 - mercator / Math.PI) / 2) * 2 ** zoom)
}

/** Every tile of the bounding box, coarsest zoom first, so an interrupted run still covers the world. */
const planPyramid = (maxZoom: number): TileAddress[] => {
  const tiles: TileAddress[] = []

  for (let z = MIN_ZOOM; z <= maxZoom; z += 1) {
    const limit = 2 ** z - 1
    const first = { x: longitudeToColumn(BBOX.west, z), y: latitudeToRow(BBOX.north, z) }
    const last = { x: longitudeToColumn(BBOX.east, z), y: latitudeToRow(BBOX.south, z) }

    for (let x = Math.max(0, first.x); x <= Math.min(limit, last.x); x += 1) {
      for (let y = Math.max(0, first.y); y <= Math.min(limit, last.y); y += 1) {
        tiles.push({ z, x, y })
      }
    }
  }

  return tiles
}

const fillTemplate = (template: string, tile: TileAddress): string =>
  template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))

const storageKeyFor = (tileset: Tileset, tile: TileAddress): string =>
  `${tileset.prefix}/${tile.z}/${tile.x}/${tile.y}.${EXTENSION_FOR_FORMAT[tileset.format]}`

const isAlreadyStored = async (key: string): Promise<boolean> => {
  try {
    await storage.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

/** A missing tile is missing for good; a failing server is having a bad day. */
const isPermanentFailure = (status: number): boolean => status === 404 || status === 410

type TileOutcome = 'mirrored' | 'absent' | 'deferred'

interface MirrorRequest {
  tileset: Tileset
  tile: TileAddress
}

/**
 * Stored as fetched. These PNGs are already optimised and re-encoding them
 * would alter someone else's cartography for no gain — the opposite of the
 * photograph mirror, where re-encoding is what strips EXIF.
 */
const mirrorTile = async (request: MirrorRequest): Promise<TileOutcome> => {
  const response = await fetch(fillTemplate(request.tileset.urlTemplate, request.tile))

  if (!response.ok) return isPermanentFailure(response.status) ? 'absent' : 'deferred'

  const raw = Buffer.from(await response.arrayBuffer())

  // The declared content type is a hint; the leading bytes are not. A tile
  // server answering an out-of-range request with an HTML error page reaches
  // this point looking like a success.
  if (raw.byteLength < MIN_TILE_BYTES || detectImageFormat(raw) !== request.tileset.format) {
    return 'absent'
  }

  await storage.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKeyFor(request.tileset, request.tile),
      Body: raw,
      ContentType: CONTENT_TYPE_FOR_FORMAT[request.tileset.format],
      CacheControl: 'public, max-age=31536000, immutable',
      // S3 metadata values must be US-ASCII; an un-encoded "Johan Åhlfeldt"
      // silently broke every upload's SigV4 signature (confirmed directly
      // against this project's own MinIO — "the request signature we
      // calculated does not match the signature you provided", on every
      // single tile, with nothing in the earlier error to suggest the cause
      // was the attribution string rather than the credentials). Percent-
      // encoding is the standard escape for non-ASCII S3 metadata; decode on
      // read if this is ever surfaced rather than just stored.
      Metadata: { attribution: encodeURIComponent(request.tileset.attribution) },
    }),
  )

  return 'mirrored'
}

/**
 * Fails loudly here rather than ten hours in: a missing bucket answers every
 * upload identically, and the run would otherwise look like a crawl that
 * rejected everything.
 */
const checkBucketReachable = async (): Promise<void> => {
  try {
    await storage.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch (error) {
    throw new Error(
      `Bucket '${BUCKET}' is not reachable at ${process.env.NUXT_STORAGE_ENDPOINT ?? 'http://127.0.0.1:9000'} ` +
        `(${(error as Error).message}). Start the stack with pnpm stack:up, which creates it.`,
      { cause: error },
    )
  }
}

const main = async (): Promise<void> => {
  const name = process.argv[2] ?? ''
  const tileset = TILESETS[name]

  if (!tileset) {
    throw new Error(
      `Name the tileset to mirror: ${Object.keys(TILESETS).join(' | ')}. ` +
        `e.g. pnpm import:basemap dare`,
    )
  }

  await checkBucketReachable()

  const maxZoom = Number(process.env.MIRROR_MAX_ZOOM ?? tileset.maxZoom)
  const planned = planPyramid(maxZoom).slice(0, MIRROR_LIMIT)

  console.log(
    `${planned.length} tiles planned for '${name}', z${MIN_ZOOM}–z${maxZoom} over ` +
      `${BBOX.west}…${BBOX.east}°E, ${BBOX.south}…${BBOX.north}°N.\n` +
      `That is the number of requests their server will see, and the number to quote ` +
      `when you tell them. Roughly ${Math.round((planned.length * REQUEST_INTERVAL) / 3600000)} ` +
      `hours at the configured pace, plus transfer.\n`,
  )

  let mirrored = 0
  let skipped = 0
  let absent = 0
  let deferred = 0

  for (const tile of planned) {
    if (await isAlreadyStored(storageKeyFor(tileset, tile))) {
      // No pause: nothing was asked of the origin, so there is nothing to be
      // polite about, and a resumed run reaches new ground in minutes.
      skipped += 1
      continue
    }

    try {
      const outcome = await mirrorTile({ tileset, tile })
      if (outcome === 'mirrored') mirrored += 1
      else if (outcome === 'absent') absent += 1
      else {
        deferred += 1
        console.warn(`  ~ ${tile.z}/${tile.x}/${tile.y} unavailable, left for a later run`)
      }
    } catch (error) {
      deferred += 1
      console.error(`  ~ ${tile.z}/${tile.x}/${tile.y}: ${(error as Error).message}`)
    }

    if ((mirrored + absent + deferred) % 100 === 0) {
      console.log(`· ${mirrored + absent + deferred + skipped}/${planned.length}`)
    }
    await wait(REQUEST_INTERVAL)
  }

  console.log(
    `\nMirrored ${mirrored} tiles, ${skipped} already in storage. ` +
      `${absent} not published by the source, ${deferred} left for a later run.\n` +
      `Set ${tileset.envVar} to the pull zone path for ` +
      `${tileset.prefix}/{z}/{x}/{y}.${EXTENSION_FOR_FORMAT[tileset.format]}.`,
  )
}

await main()
