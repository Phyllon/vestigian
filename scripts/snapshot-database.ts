/**
 * Writes a compressed snapshot of the converted database.
 *
 * The import is reproducible — convert runs again in minutes — but only until
 * the first real contribution lands. Accounts, revisions and uploads exist
 * nowhere else, and from that moment this file is the only copy.
 *
 * A snapshot on the same disk as the database is not a backup. Copy it off the
 * machine, and restore it somewhere occasionally: an untested dump is a guess.
 *
 *   pnpm db:snapshot
 */
import { execFile, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SNAPSHOT_DIR = new URL('../.import/snapshots/', import.meta.url).pathname
const COMPOSE_FILE = new URL('../docker/compose.dev.yml', import.meta.url).pathname
const KEEP_SNAPSHOTS = Number(process.env.KEEP_SNAPSHOTS ?? 14)

const DATABASE_URL =
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigia:vestigia@127.0.0.1:5432/vestigia'

interface DatabaseTarget {
  user: string
  database: string
}

const readDatabaseTarget = (url: string): DatabaseTarget => {
  const parsed = new URL(url)
  return {
    user: decodeURIComponent(parsed.username) || 'vestigia',
    database: parsed.pathname.replace(/^\//, '') || 'vestigia',
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
 * pg_dump is rarely installed on the machine running this, and the version has
 * to match the server anyway. Falling back through compose uses the same
 * Postgres image the data lives in, which removes both problems.
 */
const buildDumpCommand = async (target: DatabaseTarget): Promise<[string, string[]]> => {
  if (await isCommandAvailable('pg_dump')) {
    return ['pg_dump', ['--format=custom', DATABASE_URL]]
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
      '--format=custom',
      target.database,
    ],
  ]
}

const writeSnapshot = async (destination: string): Promise<void> => {
  const target = readDatabaseTarget(DATABASE_URL)
  const [command, args] = await buildDumpCommand(target)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] })
    const file = createWriteStream(destination)

    child.stdout.pipe(file)
    child.on('error', reject)
    child.on('close', (code) => {
      // A dump that failed halfway still leaves a plausible-looking file, so a
      // non-zero exit has to take the file with it.
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code}`))
    })
  })
}

const pruneOldSnapshots = async (): Promise<number> => {
  const entries = (await readdir(SNAPSHOT_DIR))
    .filter((name) => name.endsWith('.dump'))
    .sort()
    .reverse()

  const stale = entries.slice(KEEP_SNAPSHOTS)
  for (const name of stale) await rm(`${SNAPSHOT_DIR}${name}`, { force: true })
  return stale.length
}

const main = async (): Promise<void> => {
  await mkdir(SNAPSHOT_DIR, { recursive: true })

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  const destination = `${SNAPSHOT_DIR}vestigia-${stamp}.dump`

  console.log('Writing snapshot…')
  try {
    await writeSnapshot(destination)
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }

  const written = await stat(destination)
  const pruned = await pruneOldSnapshots()

  console.log(`\n${destination}`)
  console.log(`· ${(written.size / 1024 / 1024).toFixed(1)} MB`)
  if (pruned > 0) console.log(`· ${pruned} older snapshot(s) pruned, keeping ${KEEP_SNAPSHOTS}`)
  console.log('\nRestore into a scratch database to check it:')
  console.log(`  createdb restore_test && pg_restore -d restore_test --no-owner "${destination}"`)
  console.log('\nImages are not in here — they live in object storage. Both must be')
  console.log('restored together, or approved rows will point at objects that are gone.')
}

await main()
