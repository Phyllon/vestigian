/**
 * Checks that the database and the object store still agree.
 *
 * The failure this exists for is silent: restore a database snapshot that is
 * newer than the bucket and rows sit at status 'approved' describing objects
 * that are not there. The gallery renders broken images while every query
 * reports health. Nothing else in the system notices.
 *
 * Three states are reported:
 *   · missing   approved rows whose object is gone — the silent case
 *   · unstored  pending rows whose object already exists, which is what an
 *               interrupted mirror leaves behind
 *   · orphan    objects nothing references
 *
 * Only the first is repaired, by returning those rows to 'pending' so the
 * mirror fetches them again. Orphans are reported and left alone: withdrawal is
 * reversible by design in this project, and nothing here deletes bytes.
 *
 *   pnpm images:reconcile           report only
 *   pnpm images:reconcile --repair  also requeue the missing ones
 */
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import postgres from 'postgres'

const shouldRepair = process.argv.includes('--repair')

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
)

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

interface ImageRow {
  storage_key: string
  status: string
  rows: number
}

/**
 * One paginated listing rather than a HEAD per row: at 39,000 images that is
 * forty requests instead of thirty-nine thousand, and it answers the orphan
 * question in the same pass.
 */
const listStoredKeys = async (): Promise<Set<string>> => {
  const keys = new Set<string>()
  let continuationToken: string | undefined

  do {
    const page = await storage.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    )

    for (const object of page.Contents ?? []) {
      if (object.Key) keys.add(object.Key)
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)

  return keys
}

const describe = (label: string, keys: string[]): void => {
  if (keys.length === 0) {
    console.log(`· ${label}: none`)
    return
  }

  console.log(`· ${label}: ${keys.length}`)
  for (const key of keys.slice(0, 5)) console.log(`    ${key}`)
  if (keys.length > 5) console.log(`    … and ${keys.length - 5} more`)
}

const main = async (): Promise<void> => {
  const recorded = await sql<ImageRow[]>`
    SELECT storage_key, status, COUNT(*)::int AS rows
    FROM site_images
    WHERE storage_key IS NOT NULL AND storage_key <> ''
    GROUP BY storage_key, status
  `

  const stored = await listStoredKeys()

  const missing = recorded
    .filter((row) => row.status === 'approved' && !stored.has(row.storage_key))
    .map((row) => row.storage_key)

  const unstored = recorded
    .filter((row) => row.status === 'pending' && stored.has(row.storage_key))
    .map((row) => row.storage_key)

  const referenced = new Set(recorded.map((row) => row.storage_key))
  const orphans = [...stored].filter((key) => !referenced.has(key))

  console.log(
    `${referenced.size} keys referenced by the database, ${stored.size} objects stored.\n`,
  )
  describe('missing (approved, no object)', missing)
  describe('unstored (pending, object already there)', unstored)
  describe('orphan (object, nothing references it)', orphans)

  if (missing.length > 0 && shouldRepair) {
    const requeued = await sql`
      UPDATE site_images SET status = 'pending'
      WHERE storage_key = ANY(${missing}) AND status = 'approved'
      RETURNING id
    `
    console.log(
      `\n${requeued.length} rows returned to 'pending'. Run pnpm import:images to refetch.`,
    )
  } else if (missing.length > 0) {
    console.log("\nRun again with --repair to return those rows to 'pending'.")
  }

  await sql.end()
}

await main()
