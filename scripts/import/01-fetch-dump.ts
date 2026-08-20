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
import { mkdir, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const DUMP_BASE = 'https://raw.githubusercontent.com/renevoorburg/vici.org/main/db'
const WORK_DIR = new URL('../../.import/', import.meta.url).pathname

const DUMPS = [
  { file: 'vici.sql.gz', database: 'vici' },
  { file: 'geo.sql.gz', database: 'geo' },
]

const downloadDump = async (file: string): Promise<string> => {
  const target = `${WORK_DIR}${file}`

  try {
    const existing = await stat(target)
    if (existing.size > 0) {
      console.log(`· ${file} already present, skipping download`)
      return target
    }
  } catch { /* not downloaded yet */ }

  console.log(`· fetching ${file}`)
  const response = await fetch(`${DUMP_BASE}/${file}`)
  if (!response.ok || !response.body) {
    throw new Error(`Could not fetch ${file}: ${response.status}`)
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target))
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
