/**
 * Mints from Nomisma.org — the numismatic linked-open-data hub of the
 * American Numismatic Society — read from its public SPARQL endpoint.
 *
 * **Licence, read from the source:** nomisma.org's front page states "All
 * concepts published by Nomisma.org domain are openly accessible with a CC-BY
 * license" and, beside the licence badge, "Unless specified otherwise, content
 * in Nomisma.org is licensed under a Creative Commons Attribution 3.0 License"
 * (fetched 3 Oct 2026). A mint is a Nomisma *concept*, not a partner dataset,
 * so CC BY 3.0 applies; no per-record licence overrides exist for them.
 *
 * What is imported is the mint concepts that carry a WGS 84 point
 * (`geo:location` → `geo:lat`/`geo:long`): **2,194 of them, 1,425 linked to a
 * Pleiades place**, checked against the live endpoint before writing this. The
 * English `skos:prefLabel` is the name — every one of the 2,194 has one. Mints
 * are worldwide and include medieval and later issuers, which is Nomisma's
 * scope, not a filter this import applies: the atlas is a reading aid for coin
 * evidence, and a Sasanian or Umayyad mint on the map is correct.
 *
 * Not imported: coin counts, periods and the coin types themselves. Nomisma
 * holds them as separate concepts; joining them is a larger piece of work than
 * "where was this struck", and the popup links back to the mint's own page
 * for all of it.
 *
 *   pnpm import:nomisma-mints
 *   pnpm import:nomisma-mints -- --dry-run
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'
import { refreshAtlasCache } from './atlas-cache'
import { checksumOfSource, guardImport, isDryRun, recordImportRun } from './guard'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'nomisma')
const SPARQL_ENDPOINT = 'https://nomisma.org/query'
const SOURCE_ID = 'nomisma:mints'
const BATCH_SIZE = 500

const MINTS_QUERY = `
  PREFIX nmo: <http://nomisma.org/ontology#>
  PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  SELECT ?m ?label ?lat ?long ?exact ?close WHERE {
    ?m a nmo:Mint ; geo:location ?loc .
    ?loc geo:lat ?lat ; geo:long ?long .
    OPTIONAL { ?m skos:prefLabel ?label . FILTER(lang(?label) = "en") }
    OPTIONAL { ?m skos:exactMatch ?exact . FILTER(CONTAINS(STR(?exact), "pleiades")) }
    OPTIONAL { ?m skos:closeMatch ?close . FILTER(CONTAINS(STR(?close), "pleiades")) }
  }
  ORDER BY ?m
`

export interface MintBinding {
  m: { value: string }
  label?: { value: string }
  lat: { value: string }
  long: { value: string }
  exact?: { value: string }
  close?: { value: string }
}

export interface MintRow {
  nomismaId: string
  name: string
  pleiadesId: string | null
  lon: number
  lat: number
}

/** The numeric tail of a Pleiades place URI, or null when it is not one. */
export const pleiadesIdFrom = (uri: string | undefined): string | null =>
  /\/places\/(\d+)\/?$/.exec(uri ?? '')?.[1] ?? null

/** `http://nomisma.org/id/Paktye` → `Paktye`. */
export const nomismaIdFrom = (uri: string): string => decodeURIComponent(uri.split('/').pop() ?? '')

/**
 * One row per mint. Nomisma can answer a mint with two matches (an exact and a
 * close one), which arrives as two bindings; the exact match is preferred and
 * the first binding otherwise wins. A row without a usable coordinate or name
 * is dropped, not repaired.
 */
export const parseMintBindings = (bindings: readonly MintBinding[]): MintRow[] => {
  const byId = new Map<string, MintRow>()

  for (const binding of bindings) {
    const nomismaId = nomismaIdFrom(binding.m.value)
    const lat = Number(binding.lat.value)
    const lon = Number(binding.long.value)
    const name = binding.label?.value.trim()
    if (!nomismaId || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue

    const pleiadesId = pleiadesIdFrom(binding.exact?.value) ?? pleiadesIdFrom(binding.close?.value)
    const existing = byId.get(nomismaId)

    if (!existing) {
      byId.set(nomismaId, { nomismaId, name: name.slice(0, 240), pleiadesId, lon, lat })
    } else if (!existing.pleiadesId && pleiadesId) {
      existing.pleiadesId = pleiadesId
    }
  }

  return [...byId.values()]
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const fetchMints = async (): Promise<string> => {
  const target = join(CACHE_DIR, 'mints.json')
  if (await exists(target)) return readFile(target, 'utf8')

  process.stdout.write('  ↓ Nomisma SPARQL mints … ')
  const url = new URL(SPARQL_ENDPOINT)
  url.searchParams.set('query', MINTS_QUERY)
  const response = await fetch(url, {
    headers: {
      accept: 'application/sparql-results+json',
      'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)',
    },
  })
  if (!response.ok) throw new Error(`Nomisma answered ${response.status}`)

  const body = await response.text()
  await writeFile(target, body)
  console.log(`${Math.round(body.length / 1024)} KB`)
  return body
}

const insertBatch = async (rows: MintRow[]): Promise<void> => {
  await sql`
    INSERT INTO antiquity_mints (nomisma_id, name, pleiades_id, geom)
    SELECT
      v.nomisma_id, v.name, v.pleiades_id,
      ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
    FROM unnest(
      ${rows.map((row) => row.nomismaId)}::text[],
      ${rows.map((row) => row.name)}::text[],
      ${rows.map((row) => row.pleiadesId)}::text[],
      ${rows.map((row) => String(row.lon))}::text[],
      ${rows.map((row) => String(row.lat))}::text[]
    ) AS v(nomisma_id, name, pleiades_id, lon, lat)
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Nomisma mints — CC BY 3.0, nomisma.org.\n')

  const raw = await fetchMints()
  const parsed = JSON.parse(raw) as { results: { bindings: MintBinding[] } }
  const rows = parseMintBindings(parsed.results.bindings)
  console.log(
    `${rows.length} mints parsed, ${rows.filter((row) => row.pleiadesId).length} with a Pleiades link.`,
  )

  const proceed = await guardImport({
    sql,
    source: SOURCE_ID,
    rowCount: rows.length,
    checksum: checksumOfSource(raw),
    dryRun: isDryRun(process.argv),
  })
  if (!proceed) {
    await sql.end()
    return
  }

  await sql`TRUNCATE antiquity_mints RESTART IDENTITY`
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insertBatch(rows.slice(start, start + BATCH_SIZE))
  }

  await sql`ANALYZE antiquity_mints`
  await recordImportRun(sql, {
    source: SOURCE_ID,
    rowCount: rows.length,
    checksum: checksumOfSource(raw),
  })

  const [total] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM antiquity_mints`
  console.log(`${total?.count} rows in antiquity_mints.`)

  await refreshAtlasCache(['reference:mints:*'])
  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
