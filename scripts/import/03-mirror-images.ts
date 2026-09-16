/**
 * Mirrors the vici.org image originals into object storage.
 *
 * This script is deliberately slow. It fetches one image at a time with a pause
 * between requests, because the source is a volunteer-run server and a parallel
 * crawl of several thousand photographs is indistinguishable from an attack.
 * Expect it to run for most of a day; it is resumable, so interrupt it freely.
 *
 * Before running this at full scale, tell René Voorburg what you are doing.
 * The data is licensed for reuse, but the bandwidth is his. Run
 * `pnpm import:image-records` first and use the object count it prints: that is
 * the number of requests his server will see, and it is the number to quote.
 *
 *   pnpm import:images
 */
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import sharp from 'sharp'
import { isPublishableLicence } from './vici-licences'
import { detectImageFormat } from '../../server/utils/uploads'
import { requireDatabaseUrl } from '../../server/database/database-url'

/** Pause between requests to the source server, in milliseconds. */
const REQUEST_INTERVAL = 1200
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

/**
 * Caps the run. Worth a small number on the first pass: it proves the storage
 * credentials, the bucket and the re-encode before committing someone else's
 * server to a day of traffic.
 */
const MIRROR_LIMIT = Number(process.env.MIRROR_LIMIT ?? Number.POSITIVE_INFINITY)

const sql = postgres(requireDatabaseUrl())

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

interface PendingImage {
  id: number
  source_url: string
  storage_key: string
  licence: string
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface ProcessedImage {
  body: Buffer
  width: number
  height: number
}

/**
 * Re-encoding through sharp is not only about file size: it drops every EXIF
 * block, which is the simplest way to guarantee no photographer's home address
 * or camera serial travels into the new bucket. GPS is preserved separately in
 * the database when the contributor chose to publish it.
 *
 * The dimensions come from the encoded result, not from the source metadata:
 * most of these originals are around 4000×2700 and are resized on the way
 * through, so source dimensions would describe a file that was never stored.
 */
const processImage = async (input: Buffer): Promise<ProcessedImage> => {
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  return { body: data, width: info.width, height: info.height }
}

/** A missing image is missing for good; a failing server is having a bad day. */
const isPermanentFailure = (status: number): boolean => status === 404 || status === 410

interface MirrorOutcome {
  mirrored: boolean
  retryable: boolean
  reason?: string
}

/**
 * Rebuilding the image records puts every row back to 'pending', which would
 * otherwise mean fetching thirty-six thousand photographs a second time from
 * someone else's server for bytes already sitting in the bucket. An object that
 * is already stored is adopted instead: read back from our own storage, measured
 * and marked approved, with no request to vici.org at all.
 */
const adoptStoredObject = async (image: PendingImage, rowIds: number[]): Promise<boolean> => {
  let stored: Buffer

  try {
    const existing = await storage.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: image.storage_key }),
    )
    stored = Buffer.from(await existing.Body!.transformToByteArray())
  } catch {
    return false
  }

  const measured = await sharp(stored).metadata()
  await sql`
    UPDATE site_images
    SET width = ${measured.width ?? 0}, height = ${measured.height ?? 0}, status = 'approved'
    WHERE id = ANY(${rowIds})
  `

  return true
}

/**
 * One fetch per storage key, not per row. A photograph attached to two sites
 * has two site_images rows pointing at one object, and downloading it twice
 * would spend the source server's bandwidth to no purpose.
 */
const mirrorOne = async (image: PendingImage, rowIds: number[]): Promise<MirrorOutcome> => {
  const response = await fetch(image.source_url)

  if (!response.ok) {
    if (isPermanentFailure(response.status)) {
      await sql`UPDATE site_images SET status = 'rejected' WHERE id = ANY(${rowIds})`
      return { mirrored: false, retryable: false, reason: `${response.status}` }
    }
    // Left pending so a later run picks it up rather than losing the image to
    // one bad afternoon on a volunteer-run server.
    return { mirrored: false, retryable: true, reason: `${response.status}` }
  }

  const raw = Buffer.from(await response.arrayBuffer())
  if (raw.byteLength > MAX_SOURCE_BYTES) {
    await sql`UPDATE site_images SET status = 'rejected' WHERE id = ANY(${rowIds})`
    return { mirrored: false, retryable: false, reason: 'over the size ceiling' }
  }

  /**
   * vici.org answers a missing photograph with 200 and an HTML body reading
   * "404 - file not found", so response.ok proves nothing. The bytes are read
   * the same way an upload's are — by their own leading bytes.
   */
  if (!detectImageFormat(raw)) {
    await sql`UPDATE site_images SET status = 'rejected' WHERE id = ANY(${rowIds})`
    return { mirrored: false, retryable: false, reason: 'not an image' }
  }

  const processed = await processImage(raw)

  await storage.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: image.storage_key,
      Body: processed.body,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  )

  await sql`
    UPDATE site_images
    SET width = ${processed.width}, height = ${processed.height}, status = 'approved'
    WHERE id = ANY(${rowIds})
  `

  return { mirrored: true, retryable: false }
}

/**
 * Fails loudly here rather than thirteen hours in: a missing bucket answers
 * every upload identically, and the run would otherwise look like a crawl that
 * rejected everything.
 */
const checkBucketReachable = async (): Promise<void> => {
  try {
    await storage.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch (error) {
    throw new Error(
      `Bucket '${BUCKET}' is not reachable at ${process.env.NUXT_STORAGE_ENDPOINT ?? 'http://127.0.0.1:9000'} ` +
        `(${(error as Error).message}). Start the stack with pnpm stack:up, which now creates it.`,
      { cause: error },
    )
  }
}

const main = async (): Promise<void> => {
  await checkBucketReachable()

  // Only images whose licence resolved cleanly are mirrored. An unknown licence
  // means the image stays unpublished until a person decides what it is.
  const pending = await sql<PendingImage[]>`
    SELECT DISTINCT ON (storage_key) id, source_url, storage_key, licence
    FROM site_images
    WHERE status = 'pending'
      AND source_url IS NOT NULL
      AND licence NOT IN ('UNKNOWN', 'ARR')
    ORDER BY storage_key, id
  `

  const publishable = pending
    .filter((image) => isPublishableLicence(image.licence))
    .slice(0, MIRROR_LIMIT)

  console.log(
    `${publishable.length} objects to mirror, roughly ${Math.round(
      (publishable.length * REQUEST_INTERVAL) / 3600000,
    )} hours of waiting at the configured pace, plus transfer.\n`,
  )

  let mirrored = 0
  let adopted = 0
  let deferred = 0
  let rejected = 0

  for (const image of publishable) {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM site_images WHERE storage_key = ${image.storage_key} AND status = 'pending'
    `
    const rowIds = rows.map((row) => row.id)

    if (await adoptStoredObject(image, rowIds)) {
      adopted += 1
      // No pause: nothing was asked of vici.org, so there is nothing to be
      // polite about, and a rebuilt database re-links in minutes not hours.
      continue
    }

    try {
      const outcome = await mirrorOne(image, rowIds)
      if (outcome.mirrored) mirrored += 1
      else if (outcome.retryable) {
        deferred += 1
        console.warn(`  ~ ${image.source_url} → ${outcome.reason}, left for a later run`)
      } else {
        rejected += 1
        console.warn(`  ! ${image.source_url} → ${outcome.reason}, rejected`)
      }
    } catch (error) {
      deferred += 1
      console.error(`  ~ ${image.source_url}: ${(error as Error).message}`)
    }

    if ((mirrored + deferred + rejected) % 25 === 0) {
      console.log(`· ${mirrored + deferred + rejected + adopted}/${publishable.length}`)
    }
    await wait(REQUEST_INTERVAL)
  }

  console.log(
    `\nMirrored ${mirrored} objects, adopted ${adopted} already in storage. ` +
      `${rejected} rejected, ${deferred} left pending for a later run.`,
  )
  await sql.end()
}

await main()
