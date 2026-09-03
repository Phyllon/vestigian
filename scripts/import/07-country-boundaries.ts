/**
 * Imports real national boundaries for point-in-polygon reverse geocoding —
 * "which country is this site in" — which `geo_names` cannot answer on its
 * own. `geo_names` is a sparse point set scoped to wherever vici.org's own
 * `geo.sql` dump happens to cover (five countries: DE, FR, IT, NL, BE), so a
 * nearest-*point* match for a site genuinely outside that area still returns
 * whichever of the five is closest, however far away. Measured: 43,479 of
 * 61,274 approved sites — over two thirds — sit outside that five-country
 * area and were wrongly assigned one of those five countries before this was
 * caught (`scripts/backfill-country-codes.ts`'s corrected version now clears
 * them to null instead). Real boundary polygons have no such failure mode.
 *
 * Source: Natural Earth's 1:50m admin-0 countries, public domain, no
 * attribution required (naturalearthdata.com). 50m rather than 10m: accurate
 * enough for a country-level lookup at a fraction of the size (~3 MB vs.
 * ~50+ MB), and this dataset only ever needs to answer "which country",
 * never render a coastline.
 *
 * `ISO_A2` is `-99` (unset) for a handful of features Natural Earth's own
 * data model complicates — France and Norway among them, both squarely
 * inside where this project has sites, because their metropolitan territory
 * and overseas departments don't share one ISO code in Natural Earth's
 * admin-0 model. `ISO_A2_EH` ("extended handling") is Natural Earth's own
 * fallback field for exactly this and resolves both correctly; a genuinely
 * disputed territory (Somaliland, Northern Cyprus, the Siachen Glacier) is
 * `-99` in both fields and is skipped rather than assigned a guessed code.
 *
 *   pnpm import:country-boundaries
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import postgres from 'postgres'

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
  { max: 1 },
)

const CACHE_DIR = join(process.cwd(), '.import')
const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'

interface CountryFeature {
  type: 'Feature'
  properties: {
    NAME: string
    ISO_A2: string
    ISO_A2_EH: string
  }
  geometry: { type: string; coordinates: unknown } | null
}

const exists = async (path: string): Promise<boolean> =>
  stat(path)
    .then(() => true)
    .catch(() => false)

const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(target),
  )

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024)} KB`)
  return target
}

/**
 * `ISO_A2_EH` first, not `ISO_A2`: Taiwan's plain `ISO_A2` is the five-
 * character political compromise `"CN-TW"`, which is not a two-letter code
 * at all and overflowed `varchar(2)` the first time this ran, aborting the
 * import after 190-odd rows with no indication which feature did it. The
 * length check is the general form of that fix — the two known-good fields
 * happen to cover every real ISO 3166-1 alpha-2 code, but nothing here
 * should trust an upstream field to hold exactly what its name promises.
 */
const resolveIsoA2 = (properties: CountryFeature['properties']): string | null => {
  for (const candidate of [properties.ISO_A2_EH, properties.ISO_A2]) {
    if (candidate && candidate !== '-99' && /^[A-Z]{2}$/.test(candidate)) return candidate
  }
  return null
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Importing country boundaries — Natural Earth, public domain.\n')

  const path = await fetchCached(SOURCE_URL, 'ne_50m_admin_0_countries.geojson')
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { features: CountryFeature[] }

  await sql`TRUNCATE country_boundaries RESTART IDENTITY`

  let imported = 0
  let skipped = 0

  for (const feature of parsed.features) {
    const isoA2 = resolveIsoA2(feature.properties)
    if (!isoA2 || !feature.geometry) {
      skipped += 1
      continue
    }

    await sql`
      INSERT INTO country_boundaries (iso_a2, name, geom)
      VALUES (
        ${isoA2}, ${feature.properties.NAME},
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326))
      )
    `
    imported += 1
  }

  console.log(
    `${imported} country boundaries imported, ${skipped} skipped (no resolvable ISO code).`,
  )
  console.log('Next: pnpm exec tsx scripts/backfill-country-codes.ts --repair')

  await sql.end()
}

await main()
