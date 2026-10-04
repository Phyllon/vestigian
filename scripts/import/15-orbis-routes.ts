/**
 * The Roman-era transport network from ORBIS v2 (Meeks, Scheidel, Weiland,
 * Arcenas, Stanford University, 2014).
 *
 * Licence, resolved from a real discrepancy: the GitHub mirror
 * (`github.com/emeeks/orbis_v2`) genuinely carries an MIT `LICENSE` file
 * (fetched and read, copyright Elijah Meeks 2013) — but that covers
 * Meeks's D3.js viewer application, not the data files the repo also
 * happens to hold. The data's own licence comes from its authoritative
 * deposit, the Stanford Digital Repository
 * (`purl.stanford.edu/mn425tz9757`, "ORBIS (v2) Network Edge and Node
 * Tables"), which states: "This work is licensed under a Creative Commons
 * Attribution 3.0 Unported license." `orbis.stanford.edu` itself states no
 * data licence at all — its only rights line covers AWMC's basemap tiles
 * (CC BY-NC 3.0), which this import does not touch or need.
 *
 * The network itself was downloaded and inspected before this import was
 * written, not assumed from documentation: `base_routes.geojson` holds
 * 1,215 edges with properties `gid, sid, tid, t, e, s` — 1,206
 * `LineString`, plus 9 `MultiLineString` (8 fragmented coastal hops and one
 * 36-piece overseas edge), each of whose components becomes its own row
 * (1,328 rows imported in total; see `parseRoutes`). `sid`/`tid` are node
 * ids resolved here against `sites_extended.csv` (751 named sites) for
 * display labels; `t` is one of six route kinds (`road` 627, `coastal`
 * 411, `overseas` 69, `upstream` 54, `downstream` 49, `ferry` 5). `e`/`s`
 * are undocumented cost or duration figures with no verified meaning and
 * are deliberately not imported — better absent than mislabelled.
 *
 * A sibling file, `new_routes.geojson`, covers nearly the same edges with
 * a seasonal `m` (months) field replacing `upstream` — importing both
 * would double-draw the same connections on the map, so only
 * `base_routes.geojson` is used.
 *
 *   pnpm import:orbis-routes
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parse } from 'csv-parse/sync'
import postgres from 'postgres'
import { refreshAtlasCache } from './atlas-cache'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'orbis-routes')
const REPO_RAW = 'https://raw.githubusercontent.com/emeeks/orbis_v2/master'

const ROUTE_TYPES = ['road', 'coastal', 'overseas', 'upstream', 'downstream', 'ferry'] as const
type RouteType = (typeof ROUTE_TYPES)[number]

const isRouteType = (value: string): value is RouteType =>
  (ROUTE_TYPES as readonly string[]).includes(value)

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Same shape as `13-battles.ts`'s `fetchCached` — kept local for the same
 *  reason: `scripts/` has no shared-utility module either script can
 *  import from without pulling in Nitro auto-imports. */
const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url, {
    headers: { 'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)' },
  })
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  const sink = createWriteStream(target)
  await pipeline(source, sink)

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024)} KB`)
  return target
}

type LineStringGeometry = { type: 'LineString'; coordinates: [number, number][] }
type MultiLineStringGeometry = { type: 'MultiLineString'; coordinates: [number, number][][] }

interface RouteFeature {
  properties: { sid: number; tid: number; t: string }
  geometry: LineStringGeometry | MultiLineStringGeometry | { type: string }
}

const isLineString = (geometry: RouteFeature['geometry']): geometry is LineStringGeometry =>
  geometry.type === 'LineString'

const isMultiLineString = (
  geometry: RouteFeature['geometry'],
): geometry is MultiLineStringGeometry => geometry.type === 'MultiLineString'

interface RouteCollection {
  features: RouteFeature[]
}

interface RouteRow {
  sourceNodeId: number
  targetNodeId: number
  sourceTitle: string | null
  targetTitle: string | null
  routeType: RouteType
  coordinates: [number, number][]
}

/** `id,label,rank,x,y,cost,target,province,modern` — only `id`/`label` are
 *  needed here, to name a route's two endpoints in its popup. */
const loadNodeLabels = async (path: string): Promise<Map<number, string>> => {
  const records = parse(await readFile(path, 'utf8'), { columns: true }) as Record<string, string>[]
  const labels = new Map<number, string>()
  for (const record of records) {
    const id = Number(record.id)
    if (Number.isFinite(id) && record.label) labels.set(id, record.label)
  }
  return labels
}

/**
 * A `MultiLineString` (9 of the 1,215 edges) becomes one row per component
 * line rather than being skipped or forced into a single `LineString` —
 * `ST_AsMVTGeom` draws one geometry per row, and a route's two endpoint
 * labels apply equally to every disconnected piece of the same edge.
 */
const parseRoutes = (geojson: RouteCollection, nodeLabels: Map<number, string>): RouteRow[] => {
  const rows: RouteRow[] = []
  for (const feature of geojson.features) {
    const { sid, tid, t } = feature.properties
    if (!isRouteType(t)) continue

    let lines: [number, number][][] = []
    if (isLineString(feature.geometry)) lines = [feature.geometry.coordinates]
    if (isMultiLineString(feature.geometry)) lines = feature.geometry.coordinates

    for (const coordinates of lines) {
      rows.push({
        sourceNodeId: sid,
        targetNodeId: tid,
        sourceTitle: nodeLabels.get(sid) ?? null,
        targetTitle: nodeLabels.get(tid) ?? null,
        routeType: t,
        coordinates,
      })
    }
  }
  return rows
}

const lineStringWkt = (coordinates: [number, number][]): string => {
  const points = coordinates.map(([lon, lat]) => `${lon} ${lat}`).join(', ')
  return `LINESTRING(${points})`
}

const insertRoutes = async (rows: RouteRow[]): Promise<void> => {
  for (let start = 0; start < rows.length; start += 250) {
    const batch = rows.slice(start, start + 250)
    await sql`
      INSERT INTO antiquity_routes
        (source_node_id, target_node_id, source_title, target_title, route_type, geom)
      SELECT
        v.source_node_id::int, v.target_node_id::int, v.source_title, v.target_title,
        v.route_type::antiquity_route_kind, ST_SetSRID(ST_GeomFromText(v.wkt), 4326)
      FROM unnest(
        ${batch.map((row) => String(row.sourceNodeId))}::text[],
        ${batch.map((row) => String(row.targetNodeId))}::text[],
        ${batch.map((row) => row.sourceTitle)}::text[],
        ${batch.map((row) => row.targetTitle)}::text[],
        ${batch.map((row) => row.routeType)}::text[],
        ${batch.map((row) => lineStringWkt(row.coordinates))}::text[]
      ) AS v(source_node_id, target_node_id, source_title, target_title, route_type, wkt)
    `
  }
}

const importRoutes = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_routes RESTART IDENTITY`

  const sitesPath = await fetchCached(`${REPO_RAW}/sites_extended.csv`, 'sites_extended.csv')
  const nodeLabels = await loadNodeLabels(sitesPath)

  const routesPath = await fetchCached(`${REPO_RAW}/base_routes.geojson`, 'base_routes.geojson')
  const geojson = JSON.parse(await readFile(routesPath, 'utf8')) as RouteCollection
  const rows = parseRoutes(geojson, nodeLabels)

  await insertRoutes(rows)
  return rows.length
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('ORBIS routes — Meeks/Scheidel/Weiland/Arcenas, Stanford (CC BY 3.0)\n')

  const total = await importRoutes()
  console.log(`${total} route segments imported.`)

  await sql`ANALYZE antiquity_routes`

  // Rides the atlas cache generation, same as every other antiquity_* import.
  await refreshAtlasCache(['route:v*'])

  await sql.end()
}

await main()
