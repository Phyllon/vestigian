/**
 * Transforms the vici.org MySQL data into the Vestigia PostGIS schema.
 *
 * The dump's shape was verified against the October 2023 export. It is not a
 * places/lines pair — a site is assembled from five tables:
 *   · points       one row per site, pnt_lat/pnt_lng, pnt_kind
 *   · psummaries   per-language display name and short text
 *   · ptexts       per-language full description
 *   · pmetadata    period, and concordances held as columns rather than rows
 *   · pkinds       the 25-value type vocabulary behind pnt_kind
 * and a tracing from two:
 *   · plines       one row per tracing, with licence and attribution
 *   · pline_data   the vertices, pre-generalised into zoom bands
 *
 * Four things happen here that are not a straight column copy:
 *   1. Licence ids are resolved through vici's licenses table, and anything
 *      unrecognised or reserved is imported as 'pending' rather than published
 *      under a guessed licence.
 *   2. Latitude/longitude pairs become real PostGIS points in EPSG:4326.
 *   3. Tracing vertices are stored [lat, lng] and become [lon, lat] LineStrings,
 *      dropping any with fewer than two usable vertices.
 *   4. Concordances are read from typed columns and from the free-text
 *      pmeta_extids field, which holds `<span>scheme=value</span>` fragments.
 *
 *   pnpm import:convert
 */
import mysql from 'mysql2/promise'
import postgres from 'postgres'
import { isPublishableLicence, resolveLicence } from './vici-licences'

const BATCH_SIZE = 500

const source = await mysql.createConnection(
  process.env.MYSQL_URL ?? 'mysql://root:root@127.0.0.1:3307/vici',
)

const target = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigia:vestigia@127.0.0.1:5432/vestigia',
)

interface ViciPoint {
  pointId: number
  title: string
  kind: string | null
  latitude: number
  longitude: number
  summary: string | null
  description: string | null
  periodFrom: number | null
  periodTo: number | null
}

interface ViciLine {
  lineId: number
  kind: string | null
  note: string | null
  pointName: string | null
  licenceId: number | null
  attribution: string | null
  owner: string | null
  vertices: string | null
}

/**
 * Vici's 25-value kind vocabulary mapped onto the closed site_category enum.
 * Anything unmatched becomes 'other' rather than expanding the enum with
 * one-off values; unmatched kinds are reported at the end of the run.
 */
const CATEGORY_BY_KIND: Record<string, string> = {
  city: 'settlement',
  vicus: 'settlement',
  fort: 'fortification',
  watchtower: 'fortification',
  camp: 'fortification',
  temple: 'sanctuary',
  altar: 'sanctuary',
  graves: 'burial',
  aquaduct: 'infrastructure',
  road: 'infrastructure',
  bridge: 'infrastructure',
  milestone: 'infrastructure',
  mansio: 'infrastructure',
  villa: 'villa',
  industry: 'production',
  object: 'findspot',
  shipwreck: 'findspot',
  observation: 'findspot',
  baths: 'other',
  theater: 'other',
  building: 'other',
  rural: 'other',
  memorial: 'other',
  museum: 'other',
  event: 'other',
}

/** Site text is CC BY-SA across the whole dump; only media carry their own terms. */
const SITE_LICENCE = 'CC-BY-SA-3.0'

const unmatchedKinds = new Set<string>()

const mapCategory = (kind: string | null): string => {
  if (!kind) return 'other'
  const normalised = kind.trim().toLowerCase()
  const category = CATEGORY_BY_KIND[normalised]
  if (!category) {
    unmatchedKinds.add(normalised)
    return 'other'
  }
  return category
}

const slugify = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)

/**
 * The period columns are hand-entered and a few rows run backwards. A period
 * that ends before it begins violates the sites_period_order constraint, and a
 * guess at which end is wrong would be invention, so both ends are dropped.
 */
const readPeriod = (from: number | null, to: number | null): [number | null, number | null] => {
  if (from !== null && to !== null && from > to) return [null, null]
  return [from, to]
}

const importPoints = async (): Promise<number> => {
  const usedSlugs = new Set<string>()
  let lastPointId = 0
  let imported = 0

  for (;;) {
    const [rows] = await source.query<mysql.RowDataPacket[]>(
      `SELECT p.pnt_id                                   AS pointId,
              COALESCE(NULLIF(s.psum_pnt_name, ''), p.pnt_name) AS title,
              k.pkind_name                               AS kind,
              p.pnt_lat                                  AS latitude,
              p.pnt_lng                                  AS longitude,
              COALESCE(NULLIF(s.psum_short, ''), p.pnt_dflt_short) AS summary,
              t.ptxt_full                                AS description,
              m.pmeta_startyr                            AS periodFrom,
              m.pmeta_endyr                              AS periodTo
       FROM points p
       LEFT JOIN pkinds k     ON k.pkind_id     = p.pnt_kind
       LEFT JOIN psummaries s ON s.psum_pnt_id  = p.pnt_id AND s.psum_lang = 'en'
       LEFT JOIN ptexts t     ON t.ptxt_pnt_id  = p.pnt_id AND t.ptxt_lang = 'en'
       LEFT JOIN pmetadata m  ON m.pmeta_pnt_id = p.pnt_id
       WHERE p.pnt_visible = 1 AND p.pnt_hide = 0
         AND p.pnt_lat IS NOT NULL AND p.pnt_lng IS NOT NULL
         AND p.pnt_id > ?
       ORDER BY p.pnt_id
       LIMIT ?`,
      [lastPointId, BATCH_SIZE],
    )

    if (rows.length === 0) break
    const points = rows as unknown as ViciPoint[]
    lastPointId = points.at(-1)!.pointId

    await target.begin(async (tx) => {
      for (const point of points) {
        if (Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) continue

        let slug = slugify(point.title ?? '') || `site-${point.pointId}`
        if (usedSlugs.has(slug)) slug = `${slug}-${point.pointId}`
        usedSlugs.add(slug)

        const [periodFrom, periodTo] = readPeriod(point.periodFrom, point.periodTo)

        await tx`
          INSERT INTO sites (
            slug, title, category, summary, description, geom,
            period_from, period_to, status, source_ref, licence, attribution
          )
          VALUES (
            ${slug}, ${point.title}, ${mapCategory(point.kind)}::site_category,
            ${point.summary}, ${point.description},
            ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326),
            ${periodFrom}, ${periodTo}, 'approved',
            ${`vici.org#${point.pointId}`}, ${SITE_LICENCE},
            'Vici.org contributors'
          )
          ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING
        `
        imported += 1
      }
    })

    console.log(`· points ${imported} (through id ${lastPointId})`)
  }

  return imported
}

/**
 * pline_data holds the same tracing several times, generalised for a band of
 * zoom levels. The most detailed band is imported and PostGIS simplifies per
 * tile at read time, so the tile pipeline decides detail rather than the import.
 *
 * The category comes from the point the tracing is attached to, not from
 * line_kind: that column only ever holds 1–5 and is a drawing type, not a
 * pkinds reference. Read as a category it files the Aqua Claudia under baths.
 */
const importTracings = async (): Promise<number> => {
  const [rows] = await source.query<mysql.RowDataPacket[]>(
    `SELECT l.line_id          AS lineId,
            k.pkind_name       AS kind,
            l.line_note        AS note,
            p.pnt_name         AS pointName,
            l.line_license     AS licenceId,
            l.line_attribution AS attribution,
            l.line_owner       AS owner,
            d.pldata_points    AS vertices
     FROM plines l
     LEFT JOIN points p ON p.pnt_id   = l.line_pnt_id
     LEFT JOIN pkinds k ON k.pkind_id = p.pnt_kind
     JOIN pline_data d ON d.pldata_id = (
       SELECT inner_data.pldata_id
       FROM pline_data inner_data
       WHERE inner_data.pldata_pline_id = l.line_id
       ORDER BY inner_data.pldata_fromzoom DESC
       LIMIT 1
     )
     WHERE l.line_hide = 0`,
  )

  const lines = rows as unknown as ViciLine[]
  let imported = 0

  for (let offset = 0; offset < lines.length; offset += BATCH_SIZE) {
    const batch = lines.slice(offset, offset + BATCH_SIZE)

    await target.begin(async (tx) => {
      for (const line of batch) {
        const coordinates = parseLineVertices(line.vertices)
        if (coordinates.length < 2) continue

        const licence = resolveLicence(line.licenceId)
        const title = line.note?.trim() || line.pointName?.trim() || `Tracing ${line.lineId}`
        const geojson = JSON.stringify({ type: 'LineString', coordinates })
        // A tracing with no point behind it keeps the column default rather
        // than being filed under 'other', which would read as a real finding.
        const category = line.kind ? mapCategory(line.kind) : 'infrastructure'

        await tx`
          INSERT INTO tracings (title, kind, category, geom, status, source_ref, licence, attribution)
          VALUES (
            ${title.slice(0, 240)}, 'line',
            ${category}::site_category,
            ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
            ${isPublishableLicence(licence) ? 'approved' : 'pending'}::review_status,
            ${`vici.org-line#${line.lineId}`}, ${licence},
            ${line.attribution?.trim() || line.owner?.trim() || 'Vici.org contributors'}
          )
          ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING
        `
        imported += 1
      }
    })

    console.log(`· tracings ${Math.min(offset + BATCH_SIZE, lines.length)}/${lines.length}`)
  }

  return imported
}

/**
 * Vertices arrive as a JSON array of [lat, lng] pairs — the reverse of GeoJSON's
 * axis order, which is the kind of mistake that puts Roman roads in the Indian
 * Ocean, so the swap happens here and nowhere else.
 */
const parseLineVertices = (raw: string | null): [number, number][] => {
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((vertex): vertex is [number, number] => Array.isArray(vertex) && vertex.length >= 2)
    .map(([latitude, longitude]) => [Number(longitude), Number(latitude)] as [number, number])
    .filter(
      ([longitude, latitude]) =>
        Number.isFinite(longitude) &&
        Number.isFinite(latitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180,
    )
}

interface ConcordanceColumn {
  column: string
  scheme: string
}

/** Concordances vici stores as typed columns rather than as rows. */
const CONCORDANCE_COLUMNS: ConcordanceColumn[] = [
  { column: 'pmeta_pleiades', scheme: 'pleiades' },
  { column: 'pmeta_dare', scheme: 'dare' },
  { column: 'pmeta_livius', scheme: 'livius' },
  { column: 'pmeta_romaq', scheme: 'romaq' },
  { column: 'pmeta_mithraeum', scheme: 'mithraeum' },
]

interface ExternalIdentifier {
  scheme: string
  value: string
}

interface IdentifierHost {
  host: string
  scheme: string
  /** Removed from the extracted value so both URL and pair spellings agree. */
  stripPrefix?: RegExp
}

/**
 * Hosts in pmeta_extids that carry an identifier in the last path segment. A
 * link to a county heritage register is a reference, not a concordance, so
 * anything outside this list is counted and dropped rather than stored under a
 * scheme invented from its domain name.
 */
const IDENTIFIER_HOSTS: IdentifierHost[] = [
  { host: 'pleiades.stoa.org', scheme: 'pleiades' },
  { host: 'wikidata.org', scheme: 'wikidata' },
  { host: 'imperium.ahlfeldt.se', scheme: 'dare' },
  { host: 'mithraeum.eu', scheme: 'mithraeum' },
  { host: 'livius.org', scheme: 'livius' },
  // omnesviae.org/#TPPlace1857 — the same identifier the tp:place= form gives,
  // so the prefix comes off and both spellings land on one value.
  { host: 'omnesviae.org', scheme: 'omnesviae', stripPrefix: /^tpplace/i },
]

/** Hand-entered scheme names that mean a scheme already spoken for. */
const SCHEME_ALIASES: Record<string, string> = {
  dareid: 'dare',
  pleiadesid: 'pleiades',
  wikidataid: 'wikidata',
  tpplace: 'omnesviae',
}

const SCHEME_LENGTH_LIMIT = 40
const VALUE_LENGTH_LIMIT = 120

const droppedFragments = new Map<string, number>()

const countDropped = (reason: string): void => {
  droppedFragments.set(reason, (droppedFragments.get(reason) ?? 0) + 1)
}

const normaliseScheme = (raw: string): string => {
  const collapsed = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return SCHEME_ALIASES[collapsed] ?? collapsed
}

const readUrlIdentifier = (fragment: string): ExternalIdentifier | null => {
  let url: URL
  try {
    url = new URL(fragment)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const segments = url.pathname.split('/').filter(Boolean)

  // Wikipedia is language-scoped, so the language is part of the identifier.
  const wikipedia = /^([a-z-]+)\.wikipedia\.org$/.exec(host)
  if (wikipedia) {
    const title = segments.at(-1)
    if (!title) return null
    return {
      scheme: 'wikipedia',
      value: `${wikipedia[1]}:${decodeURIComponent(title)}`.slice(0, VALUE_LENGTH_LIMIT),
    }
  }

  const known = IDENTIFIER_HOSTS.find((entry) => entry.host === host)
  if (!known) {
    countDropped(host)
    return null
  }

  const raw = segments.at(-1) ?? url.hash.replace(/^#/, '')
  const value = known.stripPrefix ? raw.replace(known.stripPrefix, '') : raw
  return value ? { scheme: known.scheme, value: value.slice(0, VALUE_LENGTH_LIMIT) } : null
}

/**
 * The concordance schemes worth keeping. The field also holds photo galleries,
 * national heritage registers and half-typed sentences; storing those under a
 * scheme derived from their own text produced sixty-eight "schemes" on the
 * first run, most of them one-offs like 'austenhenrylayard18171894nineveh'.
 */
const KNOWN_SCHEMES = [
  'pleiades',
  'wikidata',
  'wikipedia',
  'dare',
  'livius',
  'romaq',
  'mithraeum',
  'omnesviae',
  'osmway',
  'osmnode',
  'archis',
  'arachne',
  'pecs',
  'trismegistos',
]

/**
 * Hand entry produced families around each scheme — 'wikidataentity',
 * 'wikidataentiy', 'wikidatentity', 'pleiadesplace', 'liviusconcept' — so a
 * scheme that begins with a known one is folded into it. 'wikipediaes' carries
 * its language in the name, which belongs in the value instead.
 */
const resolveScheme = (scheme: string, value: string): ExternalIdentifier | null => {
  if (!scheme || !value) return null

  const language = /^wikipedia([a-z]{2})$/.exec(scheme)
  if (language) {
    return {
      scheme: 'wikipedia',
      value: `${language[1]}:${value}`.slice(0, VALUE_LENGTH_LIMIT),
    }
  }

  const known = KNOWN_SCHEMES.find((candidate) => scheme.startsWith(candidate))
  if (!known) {
    countDropped(`scheme ${scheme.slice(0, SCHEME_LENGTH_LIMIT)}`)
    return null
  }

  return { scheme: known, value: value.slice(0, VALUE_LENGTH_LIMIT) }
}

/**
 * Splits `scheme = value` on whichever of = or : comes first, so that a scheme
 * written with the other separator cannot be read as the value.
 */
const splitOnFirstSeparator = (text: string): [string, string] | null => {
  const index = text.search(/[=:]/)
  if (index <= 0) return null

  const scheme = text.slice(0, index).trim()
  const value = text.slice(index + 1).trim()
  if (!scheme || !value || !/^[a-z]/i.test(scheme)) return null

  return [scheme, value]
}

/**
 * pmeta_extids is free text spanning thirteen years of hand entry: `wikidata=Q2409236`,
 * `archis: 26284`, `dare id=17247`, `tp:place=18` and bare URLs, wrapped in span
 * tags. Fragments that do not resolve to a known scheme are dropped and counted
 * rather than stored under a scheme read off the wrong side of a separator.
 */
const parseExternalIdentifiers = (raw: string | null): ExternalIdentifier[] => {
  if (!raw) return []

  const identifiers: ExternalIdentifier[] = []

  for (const fragment of raw.split(/<[^>]*>/)) {
    const text = fragment.trim()
    if (!text) continue

    if (/^https?:\/\//i.test(text)) {
      const identifier = readUrlIdentifier(text)
      if (identifier) identifiers.push(identifier)
      continue
    }

    const pair = splitOnFirstSeparator(text)
    if (!pair) {
      countDropped('unparsed fragment')
      continue
    }

    // `tp:place=18` names the scheme on both sides of the colon.
    let [scheme, value] = pair
    const nested = splitOnFirstSeparator(value)
    if (nested?.[0]) {
      scheme = `${scheme}${nested[0]}`
      value = nested[1]
    }

    const resolved = resolveScheme(normaliseScheme(scheme), value)
    if (!resolved) continue

    identifiers.push(resolved)
  }

  return identifiers
}

const importExternalIdentifiers = async (): Promise<number> => {
  const [rows] = await source.query<mysql.RowDataPacket[]>(
    `SELECT pmeta_pnt_id, pmeta_extids,
            ${CONCORDANCE_COLUMNS.map((entry) => entry.column).join(', ')}
     FROM pmetadata`,
  )

  let imported = 0

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)

    await target.begin(async (tx) => {
      for (const row of batch) {
        const identifiers = [...parseExternalIdentifiers(row.pmeta_extids as string | null)]

        for (const entry of CONCORDANCE_COLUMNS) {
          const value = row[entry.column]
          if (value === null || value === undefined || value === '' || value === 0) continue
          identifiers.push({ scheme: entry.scheme, value: String(value).trim().slice(0, 120) })
        }

        for (const identifier of identifiers) {
          const inserted = await tx`
            INSERT INTO external_ids (site_id, scheme, value)
            SELECT s.id, ${identifier.scheme}, ${identifier.value}
            FROM sites s WHERE s.source_ref = ${`vici.org#${row.pmeta_pnt_id}`}
            ON CONFLICT DO NOTHING
            RETURNING id
          `
          imported += inserted.length
        }
      }
    })
  }

  return imported
}

const main = async (): Promise<void> => {
  console.log('Converting vici.org data into PostGIS…\n')
  const points = await importPoints()
  const tracings = await importTracings()
  const concordances = await importExternalIdentifiers()

  await target`ANALYZE sites`
  await target`ANALYZE tracings`

  console.log(
    `\n${points} sites, ${tracings} tracings and ${concordances} external identifiers imported.`,
  )

  if (unmatchedKinds.size > 0) {
    console.warn(`· kinds imported as 'other': ${[...unmatchedKinds].sort().join(', ')}`)
  }

  // Visible rather than silent: a host appearing here in quantity is a
  // concordance scheme worth adding to IDENTIFIER_HOSTS.
  if (droppedFragments.size > 0) {
    const ranked = [...droppedFragments.entries()]
      .sort(([, first], [, second]) => second - first)
      .slice(0, 10)
      .map(([reason, count]) => `${reason} (${count})`)
    console.warn(`· extid fragments dropped, most frequent first: ${ranked.join(', ')}`)
  }

  console.log('Next: pnpm import:images')

  await source.end()
  await target.end()
}

await main()
