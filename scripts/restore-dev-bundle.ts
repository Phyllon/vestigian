/**
 * Restores a bundle written by `create-dev-bundle.ts` into a clean checkout —
 * the counterpart that makes handing someone else "everything" actually
 * useful, rather than two files and a page of manual instructions.
 *
 * Expects `pnpm stack:up` to already be running (Postgres and MinIO need to
 * exist, though the database can and should still be empty — this restores
 * the full dump onto it, it does not merge into existing data).
 *
 *   pnpm dev:bundle:restore -- <path-to.dump> <path-to-images.tar.gz>
 */
import { HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { execFile, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { requireDatabaseUrl } from '../server/database/database-url'

const run = promisify(execFile)

const BUNDLE_DIR = new URL('../.import/bundle/', import.meta.url).pathname
const RESTORE_STAGING_DIR = `${BUNDLE_DIR}restore/`
const COMPOSE_FILE = new URL('../docker/compose.dev.yml', import.meta.url).pathname

const DATABASE_URL = requireDatabaseUrl()

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

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

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

/**
 * `--clean --if-exists` makes this safe to re-run: without them, a second
 * attempt after a partial failure aborts on "relation already exists"
 * instead of just dropping and recreating. `--no-owner --no-acl` sidesteps
 * an owner mismatch if the two databases' role names ever differ.
 */
const buildRestoreCommand = async (
  target: DatabaseTarget,
  dumpPath: string,
): Promise<[string, string[]]> => {
  const options = ['--no-owner', '--no-acl', '--clean', '--if-exists']

  if (await isCommandAvailable('pg_restore')) {
    return ['pg_restore', [...options, '--dbname', DATABASE_URL, dumpPath]]
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
      'pg_restore',
      '--username',
      target.user,
      ...options,
      '--dbname',
      target.database,
      // No path argument: `docker compose exec` shares nothing from the host
      // filesystem by default, so the dump is piped in via stdin instead —
      // see `restoreDatabase` below. A literal '-' does NOT mean "read
      // stdin" to pg_restore the way it does to many other Unix tools; it
      // tries to open a file named "-" and fails with "No such file or
      // directory" (found by actually running this against a scratch
      // database, not assumed from pg_restore's man page). Omitting the
      // argument entirely is what makes it read stdin.
    ],
  ]
}

const restoreDatabase = async (dumpPath: string): Promise<void> => {
  const target = readDatabaseTarget(DATABASE_URL)
  const [command, args] = await buildRestoreCommand(target, dumpPath)

  const usesStdin = command === 'docker'
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [usesStdin ? 'pipe' : 'ignore', 'inherit', 'inherit'],
    })

    if (usesStdin && child.stdin) {
      createReadStream(dumpPath).pipe(child.stdin)
    }

    child.on('error', reject)
    child.on('close', (code) => {
      // pg_restore exits non-zero on warnings (e.g. "role does not exist" for
      // a role that was never dumped, harmless with --no-owner) as well as
      // real failures — there is no clean way to tell them apart from the
      // exit code alone, so this is reported rather than treated as fatal.
      if (code === 0) resolve()
      else {
        console.warn(`\npg_restore exited with ${code} — check the output above for real errors`)
        resolve()
      }
    })
  })
}

const walkFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name)
      return entry.isDirectory() ? walkFiles(path) : [path]
    }),
  )
  return files.flat()
}

/** `undefined` size means "not there yet"; a mismatched size is treated the
 *  same as absent, so a half-written object from an interrupted run gets
 *  overwritten rather than trusted. */
const readRemoteObjectSize = async (key: string): Promise<number | undefined> => {
  try {
    const head = await storage.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return head.ContentLength
  } catch (error) {
    if (error instanceof NotFound) return undefined
    throw error
  }
}

const uploadAllObjects = async (root: string): Promise<number> => {
  const files = await walkFiles(root)
  let uploaded = 0

  for (const file of files) {
    const key = relative(root, file).replaceAll('\\', '/')
    const localSize = (await stat(file)).size
    if ((await readRemoteObjectSize(key)) === localSize) continue

    const body = await readFile(file)
    await storage.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      }),
    )
    uploaded += 1
    if (uploaded % 500 === 0) console.log(`  ${uploaded} object(s) uploaded…`)
  }

  return uploaded
}

const main = async (): Promise<void> => {
  // pnpm forwards the `--` separator itself into argv (confirmed by actually
  // running `pnpm dev:bundle:restore -- a b`, not assumed) — a plain `node`
  // or `tsx` invocation would not, so this only strips it when present.
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const [dumpPath, imagesArchivePath] = args
  if (!dumpPath || !imagesArchivePath) {
    console.error('Usage: pnpm dev:bundle:restore -- <path-to.dump> <path-to-images.tar.gz>')
    process.exitCode = 1
    return
  }
  await stat(dumpPath) // throws a clear ENOENT if the path is wrong
  await stat(imagesArchivePath)

  if (!(await isCommandAvailable('tar'))) {
    throw new Error('tar is not available on this machine — extract the archive by hand instead.')
  }

  console.log('Restoring database (this replaces existing tables — see --clean above)…')
  await restoreDatabase(dumpPath)

  console.log('Extracting images…')
  await rm(RESTORE_STAGING_DIR, { recursive: true, force: true })
  await mkdir(RESTORE_STAGING_DIR, { recursive: true })
  await run('tar', ['xzf', imagesArchivePath, '-C', RESTORE_STAGING_DIR])

  console.log('Uploading images to local object storage (resumable — safe to re-run)…')
  const uploaded = await uploadAllObjects(RESTORE_STAGING_DIR)
  await rm(RESTORE_STAGING_DIR, { recursive: true, force: true })

  console.log(`\nRestored. ${uploaded} object(s) uploaded.`)
  console.log('Run `pnpm images:reconcile` to confirm the database and storage agree.')
}

await main()
