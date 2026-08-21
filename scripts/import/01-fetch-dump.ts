/**
 * Downloads the vici.org SQL dumps and loads them into a scratch MariaDB.
 * Run this on your own machine — it needs about 3 GB of disk and network access
 * to GitHub, and it is deliberately a separate step from the conversion so a
 * failed transform does not mean downloading
 * everything again.
 *
 *   pnpm import:fetch
 */
import { createWriteStream } from 'node:fs'
import { mkdir, open, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * raw.githubusercontent.com, not github.com: the latter answers 200 with the
 * repository's *web page* for any path, which is how a 150 KB HTML document
 * ends up on disk named vici.sql.gz.
 */
const DUMP_BASE = 'https://raw.githubusercontent.com/renevoorburg/vici.org/main/db'
const WORK_DIR = new URL('../../.import/', import.meta.url).pathname

/** Dumps fetched by hand are picked up from here. Override with VICI_DUMP_DIR. */
const LOCAL_DUMP_DIR =
  process.env.VICI_DUMP_DIR ?? new URL('../../db_dumb/', import.meta.url).pathname

const DUMPS = [
  { file: 'vici.sql.gz', database: 'vici' },
  { file: 'geo.sql.gz', database: 'geo' },
]

/**
 * Size cannot tell a dump from a saved error page, and the failure only
 * surfaces much later as a gunzip error. The gzip magic number can.
 */
const isGzipFile = async (path: string): Promise<boolean> => {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) return false

  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(2), 0, 2, 0)
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
  } finally {
    await handle.close()
  }
}

const downloadDump = async (file: string): Promise<string> => {
  const target = `${WORK_DIR}${file}`

  if (await isGzipFile(target)) {
    console.log(`· ${file} already present, skipping download`)
    return target
  }

  const local = `${LOCAL_DUMP_DIR}${file}`
  if (await isGzipFile(local)) {
    console.log(`· using ${local}`)
    return local
  }

  console.log(`· fetching ${file}`)
  const response = await fetch(`${DUMP_BASE}/${file}`)
  if (!response.ok || !response.body) {
    throw new Error(`Could not fetch ${file}: ${response.status}`)
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target))

  if (!(await isGzipFile(target))) {
    await rm(target, { force: true })
    throw new Error(`${file} downloaded but is not gzip — the URL served something else.`)
  }

  return target
}

const loadIntoMariadb = async (path: string, database: string): Promise<void> => {
  console.log(`· loading ${database}`)
  const dsn = process.env.MYSQL_DSN ?? '-h 127.0.0.1 -P 3307 -uroot -proot'
  await run('sh', [
    '-c',
    `mysql ${dsn} -e "CREATE DATABASE IF NOT EXISTS ${database}" && gunzip -c ${path} | mysql ${dsn} ${database}`,
  ])
}

const main = async (): Promise<void> => {
  await mkdir(WORK_DIR, { recursive: true })
  console.log('Vici.org dump — October 2023, CC BY-SA text, CC0 metadata.')
  console.log('Please credit René Voorburg and the Vici.org contributors.\n')

  for (const dump of DUMPS) {
    const path = await downloadDump(dump.file)
    await loadIntoMariadb(path, dump.database)
  }

  console.log('\nDone. Next: pnpm import:convert')
}

await main()
