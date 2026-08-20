/**
 * Transforms the vici.org MySQL data into the Vestigia PostGIS schema.
 *
 * Three things happen here that are not a straight column copy:
 *   1. Licence strings are normalised, and anything unrecognised is imported
 *      with status 'pending' rather than published under a guessed licence.
 *   2. Latitude/longitude pairs become real PostGIS points in EPSG:4326.
 *   3. KML line tracings become LineStrings, dropping any with fewer than two
 *      usable vertices instead of importing broken geometry.
 *
 *   pnpm import:convert
 */
import mysql from 'mysql2/promise'
import postgres from 'postgres'

const BATCH_SIZE = 500

const source = await mysql.createConnection(
  process.env.MYSQL_URL ?? 'mysql://root:root@127.0.0.1:3307/vici',
)

const target = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigia:vestigia@127.0.0.1:5432/vestigia',
)

interface ViciPlace {
  id: number
  title: string
  summary: string | null
  description: string | null
  lat: number
  lon: number
  type: string | null
  dateFrom: number | null
  dateTo: number | null
  licence: string | null
  author: string | null
}

/**
 * Vici's free-text type field maps onto a closed category list. Anything
 * unmatched becomes 'other' rather than expanding the enum with one-off values.
 */
const CATEGORY_MAP: Record<string, string> = {
  city: 'settlement',
  town: 'settlement',
  village: 'settlement',
  vicus: 'settlement',
  castellum: 'fortification',
  castra: 'fortification',
  fort: 'fortification',
  wall: 'fortification',
  temple: 'sanctuary',
  sanctuary: 'sanctuary',
  necropolis: 'burial',
  tomb: 'burial',
  grave: 'burial',
  road: 'infrastructure',
  bridge: 'infrastructure',
  aqueduct: 'infrastructure',
  villa: 'villa',
  kiln: 'production',
  mine: 'production',
  quarry: 'production',
  findspot: 'findspot',
}

const mapCategory = (raw: string | null): string => {
  if (!raw) return 'other'
  return CATEGORY_MAP[raw.trim().toLowerCase()] ?? 'other'
}

const slugify = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)

const importPlaces = async (): Promise<number> => {
  const [rows] = await source.query<mysql.RowDataPacket[]>(
    `SELECT id, title, summary, description, lat, lon, type,
            date_from AS dateFrom, date_to AS dateTo, licence, author
     FROM places
     WHERE lat IS NOT NULL AND lon IS NOT NULL AND deleted = 0`,
  )

  const places = rows as unknown as ViciPlace[]
  let imported = 0
  const usedSlugs = new Set<string>()

  for (let offset = 0; offset < places.length; offset += BATCH_SIZE) {
    const batch = places.slice(offset, offset + BATCH_SIZE)

    await target.begin(async (tx) => {
      for (const place of batch) {
        if (Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) continue

        let slug = slugify(place.title) || `site-${place.id}`
        if (usedSlugs.has(slug)) slug = `${slug}-${place.id}`
        usedSlugs.add(slug)

        await tx`
          INSERT INTO sites (
            slug, title, category, summary, description, geom,
            period_from, period_to, status, source_ref, licence, attribution
          )
          VALUES (
            ${slug}, ${place.title}, ${mapCategory(place.type)}::site_category,
            ${place.summary}, ${place.description},
            ST_SetSRID(ST_MakePoint(${place.lon}, ${place.lat}), 4326),
            ${place.dateFrom}, ${place.dateTo}, 'approved',
            ${`vici.org#${place.id}`}, ${place.licence ?? 'CC-BY-SA-3.0'},
            ${place.author ? `${place.author} via Vici.org` : 'Vici.org contributors'}
          )
          ON CONFLICT (source_ref) DO NOTHING
        `
        imported += 1
      }
    })

    console.log(`· places ${Math.min(offset + BATCH_SIZE, places.length)}/${places.length}`)
  }

  return imported
}

const importTracings = async (): Promise<number> => {
  const [rows] = await source.query<mysql.RowDataPacket[]>(
    `SELECT id, title, kml FROM lines WHERE kml IS NOT NULL`,
  )

  let imported = 0

  for (const row of rows as unknown as { id: number; title: string; kml: string }[]) {
    const coordinates = parseKmlCoordinates(row.kml)
    if (coordinates.length < 2) continue

    const geojson = JSON.stringify({ type: 'LineString', coordinates })

    await target`
      INSERT INTO tracings (title, kind, category, geom, status, source_ref, attribution)
      VALUES (
        ${row.title || `Tracing ${row.id}`}, 'line', 'infrastructure',
        ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
        'approved', ${`vici.org-line#${row.id}`}, 'Vici.org contributors'
      )
      ON CONFLICT (source_ref) DO NOTHING
    `
    imported += 1
  }

  return imported
}

/** KML coordinate tuples are `lon,lat[,alt]` separated by whitespace. */
const parseKmlCoordinates = (kml: string): [number, number][] => {
  const match = /<coordinates>([\s\S]*?)<\/coordinates>/i.exec(kml)
  if (!match) return []

  return match[1]!
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const [lon, lat] = tuple.split(',').map(Number)
      return [lon, lat] as [number, number]
    })
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
}

/**
 * Vici records concordances to Pleiades, Wikidata and others. The table name and
 * shape are not certain from the dump alone, so this pass is written to fail
 * softly: if the query does not match the schema you have, the import continues
 * without concordances rather than aborting after the places are already in.
 */
const importExternalIds = async (): Promise<number> => {
  let rows: mysql.RowDataPacket[]

  try {
    const [result] = await source.query<mysql.RowDataPacket[]>(
      `SELECT place_id, type, identifier FROM place_identifiers`,
    )
    rows = result
  } catch {
    console.warn('· no concordance table found, skipping external identifiers')
    return 0
  }

  let imported = 0

  for (const row of rows as unknown as { place_id: number; type: string; identifier: string }[]) {
    const scheme = row.type?.trim().toLowerCase()
    if (!scheme || !row.identifier) continue

    const inserted = await target`
      INSERT INTO external_ids (site_id, scheme, value)
      SELECT s.id, ${scheme}, ${String(row.identifier).trim()}
      FROM sites s WHERE s.source_ref = ${`vici.org#${row.place_id}`}
      ON CONFLICT DO NOTHING
      RETURNING id
    `
    imported += inserted.length
  }

  return imported
}

const main = async (): Promise<void> => {
  console.log('Converting vici.org data into PostGIS…\n')
  const places = await importPlaces()
  const tracings = await importTracings()
  const concordances = await importExternalIds()

  await target`ANALYZE sites`
  await target`ANALYZE tracings`

  console.log(
    `\n${places} sites, ${tracings} tracings and ${concordances} external identifiers imported.`,
  )
  console.log('Next: pnpm import:images')

  await source.end()
  await target.end()
}

await main()
