/**
 * Packages the local database and every mirrored image into two files a new
 * developer can drop into their own clean checkout and be looking at the
 * real atlas within minutes, instead of re-running the import pipeline (which
 * means re-fetching from vici.org, Wikimedia Commons, Heidelberg and every
 * other borrowed source a second time for no reason but a personal setup).
 *
 * Deliberately **not** `pnpm db:snapshot`: that script excludes `antiquity_*`
 * row data on purpose, because a nightly backup is cheaply refilled by
 * `pnpm import:atlas` and friends. A one-time bundle for someone else's first
 * checkout is the opposite case — every extra `import:*` command they'd have
 * to remember and re-run is friction this bundle exists to remove, and the
 * antiquity tables are a small fraction of the total size (see
 * `snapshot-database.ts`'s own docstring: ~75 MB of ~190 MB). Nothing is
 * excluded here.
 *
 * The database dump is Postgres's own custom format (`-Fc`), which is
 * already zlib-compressed — the same reasoning documented in
 * `documents/runbook_prod.deployment.md`'s "Datenbank: lokal → Produktion"
 * section for not wrapping a `pg_dump` in a second, redundant zip step.
 * Images are downloaded from the S3-compatible store (MinIO in development)
 * via the same `@aws-sdk/client-s3` client `reconcile-images.ts` already
 * uses, into a local mirror of the bucket's key layout, then archived with
 * the system `tar` — streaming, unlike `adm-zip` (already a dependency, but
 * an in-memory zip of gigabytes of images is the wrong tool for gigabytes of
 * images).
 *
 *   pnpm dev:bundle
 *
 * Restoring on the other side: `pnpm dev:bundle:restore -- <dump> <tar.gz>`
 * (see restore-dev-bundle.ts).
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

const BUNDLE_DIR = new URL('../.import/bundle/', import.meta.url).pathname
const IMAGES_STAGING_DIR = `${BUNDLE_DIR}images/`
const COMPOSE_FILE = new URL('../docker/compose.dev.yml', import.meta.url).pathname

const DATABASE_URL =
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian'

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

interface DatabaseTarget {
  user: string
  database: string
}

const readDatabaseTarget = (url: string): DatabaseTarget => {
  const parsed = new URL(url)
  return {
    user: decodeURIComponent(parsed.username) || 'vestigian',
    database: parsed.pathname.replace(/^\//, '') || 'vestigian',
  }
}

const isCommandAvailable = async (command: string): Promise<boolean> => {
  try {
    await run('sh', ['-c', `command -v ${command}`])
    return true
  } catch {
    return false
  }
}

/** Same fallback `snapshot-database.ts` uses, and for the same reason: the
 *  Postgres client tools are rarely installed on the host, and the version
 *  has to match the server regardless. */
const buildDumpCommand = async (target: DatabaseTarget): Promise<[string, string[]]> => {
  const options = ['--format=custom']

  if (await isCommandAvailable('pg_dump')) {
    return ['pg_dump', [...options, DATABASE_URL]]
  }

  return [
    'docker',
    [
      'compose',
      '--file',
      COMPOSE_FILE,
      'exec',
      '--no-TTY',
      'postgres',
      'pg_dump',
      '--username',
      target.user,
      ...options,
      target.database,
    ],
  ]
}

const writeDump = async (destination: string): Promise<void> => {
  const target = readDatabaseTarget(DATABASE_URL)
  const [command, args] = await buildDumpCommand(target)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] })
    const file = createWriteStream(destination)

    child.stdout.pipe(file)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code}`))
    })
  })
}

/** `true` means it was actually fetched; `false` means a matching local copy
 *  already existed and was left untouched (the resumability check). */
const downloadOneObject = async (key: string, remoteSize: number | undefined): Promise<boolean> => {
  const destination = `${IMAGES_STAGING_DIR}${key}`

  if (existsSync(destination)) {
    const local = await stat(destination)
    if (local.size === remoteSize) return false
  }

  await mkdir(dirname(destination), { recursive: true })
  const response = await storage.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  if (!response.Body) return false

  await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destination))
  return true
}

/**
 * Downloads every object into a local mirror of the bucket's own key layout.
 * Resumable the same way the image import already is: an object whose local
 * copy exists at the same size is assumed already downloaded and skipped,
 * so an interrupted run picks up where it left off rather than starting a
 * 15 GiB transfer over from zero.
 */
const downloadAllObjects = async (): Promise<number> => {
  let continuationToken: string | undefined
  let downloaded = 0

  do {
    const page = await storage.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: continuationToken }),
    )

    for (const object of page.Contents ?? []) {
      if (!object.Key) continue
      if (await downloadOneObject(object.Key, object.Size)) downloaded += 1
      if (downloaded > 0 && downloaded % 500 === 0)
        console.log(`  ${downloaded} objects downloaded…`)
    }

    continuationToken = page.NextContinuationToken
  } while (continuationToken)

  return downloaded
}

const archiveImages = async (destination: string): Promise<void> => {
  if (!(await isCommandAvailable('tar'))) {
    throw new Error(
      'tar is not available on this machine — install it, or archive ' +
        `${IMAGES_STAGING_DIR} by hand.`,
    )
  }
  await run('tar', ['czf', destination, '-C', IMAGES_STAGING_DIR, '.'])
}

const main = async (): Promise<void> => {
  await mkdir(BUNDLE_DIR, { recursive: true })
  await mkdir(IMAGES_STAGING_DIR, { recursive: true })

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  const dumpPath = `${BUNDLE_DIR}vestigian-${stamp}.dump`
  const imagesArchivePath = `${BUNDLE_DIR}vestigian-images-${stamp}.tar.gz`

  console.log('Writing full database dump (nothing excluded)…')
  try {
    await writeDump(dumpPath)
  } catch (error) {
    await rm(dumpPath, { force: true })
    throw error
  }

  console.log('Downloading every mirrored image (resumable — safe to re-run)…')
  const downloaded = await downloadAllObjects()

  console.log('Archiving images…')
  await archiveImages(imagesArchivePath)
  await rm(IMAGES_STAGING_DIR, { recursive: true, force: true })

  const dumpSize = (await stat(dumpPath)).size
  const archiveSize = (await stat(imagesArchivePath)).size

  console.log(`\n${dumpPath}`)
  console.log(`· ${(dumpSize / 1024 / 1024).toFixed(1)} MB`)
  console.log(
    '· Postgres custom-format dumps are already zlib-compressed — no further ' +
      'zip step buys anything, see documents/runbook_prod.deployment.md.',
  )
  console.log(`\n${imagesArchivePath}`)
  console.log(`· ${(archiveSize / 1024 / 1024).toFixed(1)} MB, ${downloaded} object(s) downloaded`)
  console.log('\nHand both files to the other developer, then on their machine:')
  console.log(`  pnpm dev:bundle:restore -- ${dumpPath} ${imagesArchivePath}`)
}

await main()
