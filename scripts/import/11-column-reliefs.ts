/**
 * Mirrors Conrad Cichorius's 1896–1900 photographic plates of Trajan's
 * Column — the standard scholarly scene-by-scene reference for the
 * column's reliefs — from Wikimedia Commons' "Cichorius Plates" category:
 * https://commons.wikimedia.org/wiki/Category:Trajan's_Column_-_Cichorius_Plates
 *
 * 138 files, made from casts taken directly off the column, tagged
 * `PD-old-80-expired` / `CC-PD-Mark` on Commons — unambiguously public
 * domain (Cichorius died in 1930, the casts are older still). Verified live
 * before this script was written, not assumed from a summary: fetched the
 * category listing and a sample of files directly.
 *
 * The Column of Marcus Aurelius's own scholarly plates (Petersen,
 * Domaszewski & Calderini, 1896) are **not** mirrored here — they're served
 * live from Heidelberg University Library's IIIF API instead (one scanned
 * book, not a bounded file set the way this category is), from the
 * `/columns` page's "Column of Marcus Aurelius" tab. See CLAUDE.md's
 * "Column reliefs" section for why the two monuments use different
 * mechanisms, and for the live verification of Heidelberg's IIIF endpoint
 * (its human-facing HTML viewer sits behind a bot challenge; its IIIF API
 * does not — confirmed with real requests, not assumed).
 *
 * Wikimedia Commons is a large, CDN-backed service explicitly built for
 * bulk, automated reads like this one — a materially different situation
 * from Åhlfeldt's or Voorburg's personal servers, which is why this script
 * does not apply their 1.2s-per-request courtesy pace. It still identifies
 * itself with a descriptive User-Agent (Wikimedia's API etiquette) and
 * paces requests modestly rather than firing them without any gap at all.
 *
 * Resumable like the other mirrors here: an object already in storage costs
 * a HEAD against this project's own bucket, not a re-download from Commons.
 * Unlike the tile mirror, though, each row's *metadata* (licence, title,
 * description) is always re-upserted on every run, keyed on the Commons
 * file-page URL — a hybrid of the tile mirror's bucket-state resumability
 * and the vici.org photograph mirror's DB-driven metadata, cheap enough at
 * 138 rows that there is no reason to skip it. `description` comes from
 * Commons' own `extmetadata.ImageDescription` — real per-scene captions,
 * licensed identically to the image since they live on the same file page.
 *
 *   pnpm import:column-reliefs
 *   MIRROR_LIMIT=5 pnpm import:column-reliefs
 */
import { fileURLToPath } from 'node:url'
import {
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import postgres from 'postgres'
import sharp from 'sharp'
import { stripHtml } from '../../server/utils/sanitize'
import { detectImageFormat, type AcceptedImageFormat } from '../../server/utils/uploads'
import { requireDatabaseUrl } from '../../server/database/database-url'

/**
 * `server/utils/images.ts`'s `normaliseLicence`/`LICENCE_ALIASES` are not
 * reachable from here on purpose — that file also exports `buildImageUrl`,
 * which calls the Nitro-only `useRuntimeConfig`, and `tsconfig.scripts.json`
 * only whitelists server/utils files verified free of Nitro auto-imports
 * (see its own comment). A small, self-contained mapping for exactly the
 * vocabulary Commons' `extmetadata.LicenseShortName` actually returns is the
 * correct fix, not widening that whitelist to a file that isn't pure.
 */
const UNKNOWN_LICENCE = 'UNKNOWN'
const COMMONS_LICENCE_ALIASES: Record<string, string> = {
  'public domain': 'PUBLIC-DOMAIN',
  'cc by-sa 3.0': 'CC-BY-SA-3.0',
  'cc by-sa 4.0': 'CC-BY-SA-4.0',
  'cc by 3.0': 'CC-BY-3.0',
  'cc by 4.0': 'CC-BY-4.0',
  cc0: 'CC0-1.0',
}
const normaliseCommonsLicence = (raw: string | undefined): string => {
  if (!raw) return UNKNOWN_LICENCE
  return COMMONS_LICENCE_ALIASES[raw.trim().toLowerCase()] ?? UNKNOWN_LICENCE
}

const MONUMENT = 'trajans-column'
const CATEGORY = "Trajan's Column - Cichorius Plates"
const API_BASE = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'Vestigian/1.0 (+https://vestigian.org; column relief plate mirror)'

/** Modest, not the 1.2s DARE/EOX pace — see the module docstring for why. */
const REQUEST_INTERVAL = 350

/** The largest `titles=` batch Commons' API accepts for a non-bot client. */
const IMAGEINFO_BATCH_SIZE = 50

const MIRROR_LIMIT = Number(process.env.MIRROR_LIMIT ?? Number.POSITIVE_INFINITY)

const CONTENT_TYPE_FOR_FORMAT: Record<AcceptedImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const sql = postgres(requireDatabaseUrl(), { max: 1 })

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

const isAlreadyStored = async (key: string): Promise<boolean> => {
  try {
    await storage.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

/**
 * Cichorius's plates are numbered "Tafel I" … "Tafel LVII", not with arabic
 * numerals, so the scene number has to be parsed from a Roman numeral. No
 * library for a seven-symbol subset like this is worth a dependency.
 */
export const romanToArabic = (roman: string): number | null => {
  const upper = roman.toUpperCase()
  if (!/^[IVXLCDM]+$/.test(upper)) return null

  let total = 0
  for (let i = 0; i < upper.length; i += 1) {
    const current = ROMAN_VALUES[upper[i]!]!
    const next = i + 1 < upper.length ? ROMAN_VALUES[upper[i + 1]!]! : 0
    total += current < next ? -current : current
  }
  return total > 0 ? total : null
}

/** e.g. "File:028 Conrad Cichorius, Die Reliefs der Traianssäule, Tafel XXVIII.jpg" → 28. */
export const parseSceneNumber = (title: string): number | null => {
  const match = /Tafel\s+([IVXLCDM]+)/i.exec(title)
  return match ? romanToArabic(match[1]!) : null
}

/** The zero-padded file-sequence prefix Commons' own filenames carry — every
 *  file has one, even the ones with no parseable Tafel number, so it's the
 *  stable overall ordering; `sceneNumber` is the semantic identity, nullable. */
export const parseSortOrder = (title: string): number => {
  const match = /^File:0*(\d+)/.exec(title)
  return match ? Number(match[1]) : 0
}

/** "File:028 …, Tafel XXVIII.jpg" → "028 …, Tafel XXVIII" — drops the namespace and extension. */
const humaniseTitle = (title: string): string => title.replace(/^File:/, '').replace(/\.\w+$/, '')

const fileUrl = (title: string): string =>
  `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`

interface CommonsExtMetadataValue {
  value: string
}

interface CommonsImageInfo {
  url: string
  width: number
  height: number
  extmetadata?: {
    LicenseShortName?: CommonsExtMetadataValue
    Copyrighted?: CommonsExtMetadataValue
    Artist?: CommonsExtMetadataValue
    Credit?: CommonsExtMetadataValue
    ImageDescription?: CommonsExtMetadataValue
  }
}

interface CommonsPage {
  pageid: number
  title: string
  imageinfo?: CommonsImageInfo[]
}

const commonsRequest = async (params: Record<string, string>): Promise<unknown> => {
  const url = new URL(API_BASE)
  url.search = new URLSearchParams({ format: 'json', ...params }).toString()
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) throw new Error(`Commons API answered ${response.status} for ${url}`)
  return response.json()
}

/** Enumerates every file title in the category, following `cmcontinue` — the
 *  category holds 138 files today, comfortably under one page, but nothing
 *  here assumes that stays true. */
const fetchCategoryMembers = async (): Promise<string[]> => {
  const titles: string[] = []
  let cmcontinue: string | undefined

  do {
    const body = (await commonsRequest({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${CATEGORY}`,
      cmtype: 'file',
      cmlimit: '500',
      ...(cmcontinue ? { cmcontinue } : {}),
    })) as {
      query: { categorymembers: { title: string }[] }
      continue?: { cmcontinue: string }
    }

    titles.push(...body.query.categorymembers.map((member) => member.title))
    cmcontinue = body.continue?.cmcontinue
    if (cmcontinue) await wait(REQUEST_INTERVAL)
  } while (cmcontinue)

  return titles
}

/** Commons answers up to 50 titles' `imageinfo` in one request for a non-bot client. */
const fetchImageInfo = async (titles: string[]): Promise<CommonsPage[]> => {
  const pages: CommonsPage[] = []

  for (let start = 0; start < titles.length; start += IMAGEINFO_BATCH_SIZE) {
    const batch = titles.slice(start, start + IMAGEINFO_BATCH_SIZE)
    const body = (await commonsRequest({
      action: 'query',
      titles: batch.join('|'),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|size',
    })) as { query: { pages: Record<string, CommonsPage> } }

    pages.push(...Object.values(body.query.pages))
    if (start + IMAGEINFO_BATCH_SIZE < titles.length) await wait(REQUEST_INTERVAL)
  }

  return pages
}

const DEFAULT_ATTRIBUTION = 'Conrad Cichorius, 1896–1900 (Wikimedia Commons)'

/** `Copyrighted: "False"` is Commons' own structured signal for public-domain
 *  content — used ahead of the free-text `LicenseShortName`, so a stray
 *  non-PD file in the category still gets its own real licence read rather
 *  than an assumption of perfect category uniformity. */
const resolveLicence = (info: CommonsImageInfo): string => {
  if (info.extmetadata?.Copyrighted?.value === 'False') return 'PUBLIC-DOMAIN'
  return normaliseCommonsLicence(info.extmetadata?.LicenseShortName?.value)
}

const resolveAttribution = (info: CommonsImageInfo): string => {
  const raw = info.extmetadata?.Artist?.value ?? info.extmetadata?.Credit?.value
  const stripped = raw ? stripHtml(raw).trim() : ''
  return stripped || DEFAULT_ATTRIBUTION
}

/** Commons' own scene caption for the file ("Cavalry battle against
 *  Sarmatians (scene XXXVII)") — licensed identically to the image, since
 *  it lives on the same file page, not a separate work. Stripped of the
 *  HTML Commons wraps it in, the same policy this project applies to every
 *  other piece of free text on the way in. Null, not guessed, where
 *  Commons has none. */
const resolveDescription = (info: CommonsImageInfo): string | null => {
  const raw = info.extmetadata?.ImageDescription?.value
  const stripped = raw ? stripHtml(raw).trim() : ''
  return stripped || null
}

interface PlateRecord {
  monument: string
  sceneNumber: number | null
  title: string
  description: string | null
  storageKey: string
  licence: string
  attribution: string
  sourceUrl: string
  width: number
  height: number
  sortOrder: number
  imageUrl: string
}

const buildPlateRecord = (page: CommonsPage): PlateRecord | null => {
  const info = page.imageinfo?.[0]
  if (!info) return null

  // Commons' `imageinfo.url` carries UTM tracking query params
  // (`?utm_source=…`) as of this writing — confirmed by fetching a real
  // response, not assumed — so the extension has to come from the URL's
  // *pathname*, not a naive split on the whole string, or it reads the
  // query string's own dots instead of the real file extension.
  const extension = new URL(info.url).pathname.split('.').pop()?.toLowerCase() ?? 'jpg'

  return {
    monument: MONUMENT,
    sceneNumber: parseSceneNumber(page.title),
    title: humaniseTitle(page.title),
    description: resolveDescription(info),
    storageKey: `column-reliefs/${MONUMENT}/${page.pageid}.${extension}`,
    licence: resolveLicence(info),
    attribution: resolveAttribution(info),
    sourceUrl: fileUrl(page.title),
    width: info.width,
    height: info.height,
    sortOrder: parseSortOrder(page.title),
    imageUrl: info.url,
  }
}

type MirrorOutcome = 'mirrored' | 'skipped' | 'absent' | 'deferred'

/** A missing file is missing for good; a rate limit or a bad moment on
 *  Commons' end is not — same distinction 04-mirror-basemap-tiles.ts makes. */
const isPermanentFailure = (status: number): boolean => status === 404 || status === 410

const attemptMirrorPlate = async (plate: PlateRecord): Promise<MirrorOutcome> => {
  if (await isAlreadyStored(plate.storageKey)) return 'skipped'

  const response = await fetch(plate.imageUrl, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) return isPermanentFailure(response.status) ? 'absent' : 'deferred'

  const raw = Buffer.from(await response.arrayBuffer())
  const format = detectImageFormat(raw)
  if (!format) return 'absent'

  // A valid magic-byte header is not a valid image: plate 095 (5128786.jpg)
  // downloaded byte-for-byte identical to Commons' own copy — same size,
  // confirmed with a direct re-fetch — and still fails a real decode both
  // here and in imgproxy at serve time ("Corrupt JPEG data: premature end
  // of data segment"), the same libvips build behind both. The corruption
  // is in Commons' own source file, not in the download, but publishing it
  // anyway would mean a plate that never renders — better to skip it and
  // say so than to store bytes that pass a header check and fail everyone
  // who tries to actually look at them.
  try {
    await sharp(raw, { failOn: 'none' }).toBuffer()
  } catch {
    return 'absent'
  }

  await storage.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: plate.storageKey,
      Body: raw,
      ContentType: CONTENT_TYPE_FOR_FORMAT[format],
      CacheControl: 'public, max-age=31536000, immutable',
      // Same non-ASCII trap documented in 04-mirror-basemap-tiles.ts: S3
      // metadata must be US-ASCII, and an attribution naming Cichorius in
      // German orthography ("Traianssäule") would otherwise break the
      // upload's SigV4 signature silently.
      Metadata: { attribution: encodeURIComponent(plate.attribution) },
    }),
  )

  return 'mirrored'
}

/** Seconds of backoff before each retry of a `deferred` outcome. */
const RETRY_BACKOFF_MS = [2000, 5000]

/**
 * A real run against Commons showed sustained sequences of `deferred`
 * outcomes — always mid-to-late in a long run, never reproducible against
 * the same URL fetched in isolation seconds later — that cleared on their
 * own within a handful of seconds. Whatever the exact cause (a transient
 * throttle on Commons' side or on this run's own network path), retrying
 * in place converts most of what would otherwise be "run the whole import
 * again by hand" into one run finishing on its own, without masking a
 * genuinely missing file (still `absent` after every attempt, not retried).
 */
const mirrorPlate = async (plate: PlateRecord): Promise<MirrorOutcome> => {
  for (const backoffMs of [0, ...RETRY_BACKOFF_MS]) {
    if (backoffMs > 0) await wait(backoffMs)
    const outcome = await attemptMirrorPlate(plate)
    if (outcome !== 'deferred') return outcome
  }
  return 'deferred'
}

const upsertPlateRow = async (plate: PlateRecord): Promise<void> => {
  await sql`
    INSERT INTO column_relief_plates
      (monument, scene_number, title, description, storage_key, licence, attribution, source_url, width, height, sort_order)
    VALUES
      (${plate.monument}, ${plate.sceneNumber}, ${plate.title}, ${plate.description}, ${plate.storageKey},
       ${plate.licence}, ${plate.attribution}, ${plate.sourceUrl}, ${plate.width}, ${plate.height}, ${plate.sortOrder})
    ON CONFLICT (source_url) DO UPDATE SET
      scene_number = EXCLUDED.scene_number,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      storage_key = EXCLUDED.storage_key,
      licence = EXCLUDED.licence,
      attribution = EXCLUDED.attribution,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      sort_order = EXCLUDED.sort_order
  `
}

const main = async (): Promise<void> => {
  await checkBucketReachable()

  console.log(`Fetching category listing for "${CATEGORY}"…`)
  const titles = await fetchCategoryMembers()
  console.log(`${titles.length} files in the category.`)

  const pages = await fetchImageInfo(titles)
  const plates = pages
    .map(buildPlateRecord)
    .filter((plate): plate is PlateRecord => plate !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, MIRROR_LIMIT)

  console.log(`${plates.length} plates planned.\n`)

  let mirrored = 0
  let skipped = 0
  let absent = 0
  let deferred = 0

  for (const plate of plates) {
    let outcome: MirrorOutcome
    try {
      outcome = await mirrorPlate(plate)
    } catch (error) {
      // A thrown network error is still a real request that was made, not a
      // local check — it gets the same pause as any other real request
      // below, not a bare `continue` that would fire the next one instantly.
      outcome = 'deferred'
      console.error(`  ~ ${plate.title}: ${(error as Error).message}`)
    }

    // `skipped` is the one outcome with no remote request behind it (a local
    // HEAD against this project's own bucket) — every other outcome asked
    // something of Commons and gets paced accordingly. Skipping the pause
    // specifically on failure is what turned one transient hiccup into a
    // cascade of consecutive failures on a real run: once a request failed,
    // nothing slowed the next one down, and Commons kept refusing them.
    if (outcome !== 'skipped') await wait(REQUEST_INTERVAL)

    if (outcome === 'mirrored') mirrored += 1
    else if (outcome === 'skipped') skipped += 1
    else if (outcome === 'absent') {
      absent += 1
      console.warn(`  ~ ${plate.title}: not a recognisable image, skipped`)
      continue
    } else {
      deferred += 1
      console.warn(`  ~ ${plate.title}: unavailable this run, left for a later run`)
      continue
    }

    await upsertPlateRow(plate)
  }

  console.log(
    `\nMirrored ${mirrored} plates, ${skipped} already in storage (metadata refreshed either way). ` +
      `${absent} not a recognisable image, ${deferred} left for a later run.`,
  )

  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
