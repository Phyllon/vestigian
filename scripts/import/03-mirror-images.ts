/**
 * Mirrors the vici.org image originals into object storage.
 *
 * This script is deliberately slow. It fetches one image at a time with a pause
 * between requests, because the source is a volunteer-run server and a parallel
 * crawl of several thousand photographs is indistinguishable from an attack.
 * Expect it to run for a few hours; it is resumable, so interrupt it freely.
 *
 * Before running this at full scale, tell René Voorburg what you are doing.
 * The data is licensed for reuse, but the bandwidth is his.
 *
 *   pnpm import:images
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import sharp from 'sharp'

/** Pause between requests to the source server, in milliseconds. */
const REQUEST_INTERVAL = 1200
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigia:vestigia@127.0.0.1:5432/vestigia',
)

const storage = new S3Client({
  region: 'auto',
  endpoint: process.env.NUXT_STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.NUXT_STORAGE_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.NUXT_STORAGE_SECRET_ACCESS_KEY ?? '',
  },
  forcePathStyle: true,
})

const BUCKET = process.env.NUXT_STORAGE_BUCKET ?? 'vestigia'

interface PendingImage {
  id: number
  source_url: string
  storage_key: string
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
 */
const processImage = async (input: Buffer): Promise<ProcessedImage> => {
  const pipeline = sharp(input, { failOn: 'error' }).rotate()
  const metadata = await pipeline.metadata()

  const body = await pipeline
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()

  return { body, width: metadata.width ?? 0, height: metadata.height ?? 0 }
}

const mirrorOne = async (image: PendingImage): Promise<void> => {
  const response = await fetch(image.source_url, {
    headers: { 'user-agent': 'Vestigia image mirror (contact: you@example.org)' },
  })

  if (!response.ok) {
    await sql`UPDATE site_images SET status = 'rejected' WHERE id = ${image.id}`
    console.warn(`  ! ${image.source_url} → ${response.status}`)
    return
  }

  const raw = Buffer.from(await response.arrayBuffer())
  if (raw.byteLength > MAX_SOURCE_BYTES) {
    console.warn(`  ! ${image.source_url} exceeds the size ceiling, skipped`)
    return
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
    WHERE id = ${image.id}
  `
}

const main = async (): Promise<void> => {
  // Only images whose licence resolved cleanly are mirrored. An unknown licence
  // means the image stays unpublished until a person decides what it is.
  const pending = await sql<PendingImage[]>`
    SELECT id, source_url, storage_key
    FROM site_images
    WHERE status = 'pending'
      AND source_url IS NOT NULL
      AND licence NOT IN ('UNKNOWN', 'ARR')
    ORDER BY id
  `

  console.log(`${pending.length} images to mirror, roughly ${
    Math.round((pending.length * REQUEST_INTERVAL) / 60000)
  } minutes at the configured pace.\n`)

  let done = 0
  for (const image of pending) {
    try {
      await mirrorOne(image)
    } catch (error) {
      console.error(`  ! ${image.source_url}: ${(error as Error).message}`)
    }

    done += 1
    if (done % 25 === 0) console.log(`· ${done}/${pending.length}`)
    await wait(REQUEST_INTERVAL)
  }

  console.log(`\nMirrored ${done} images.`)
  await sql.end()
}

await main()
