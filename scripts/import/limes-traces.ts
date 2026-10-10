/**
 * The traced half of the frontier: lines that follow mapped or surveyed
 * remains, as opposed to AWMC's generalised ones.
 *
 * ## Why this exists
 *
 * AWMC's wall linework is digitised from the Barrington Atlas and its extent
 * is a hand-generalised polygon. Measured against Historic England's and
 * Historic Environment Scotland's scheduled-monument polygons (survey-grade,
 * OGL), the AWMC lines sit a median 335–413 m off the wall, with 1–5 km
 * excursions (Hadrian's 114 km section has 34 vertices); OpenStreetMap, OpenHistoricalMap and
 * vici.org's own tracings sit 22–42 m off the same polygons, and agree with
 * each other to a median 5–27 m. Where one of them exists it is the line.
 *
 * ## What each source is, and what is deliberately not used
 *
 * - **OpenStreetMap** (ODbL): the surveyed-remains relations — Hadrian's Wall
 *   `wall`/`wall-route` ways, the Antonine Wall, the ORL, Csörsz-árok — and the
 *   main-stream centrelines of the Rhine and Danube. Closed ways are skipped:
 *   in these relations they are fort enclosures, not the frontier.
 * - **OpenHistoricalMap** (CC0): the Lower Germanic Limes relation (the only
 *   one that follows the Oude Rijn), and wall ways as a gap-filler.
 * - **vici.org** (CC0 / CC BY-SA 3.0 per row), read from the `tracings` table by
 *   `source_ref`, which is stable across the dev and production imports.
 *   Hadrian's Wall is *not* read from vici: its tracings there are labelled as
 *   Vallum segments and several are double-traced, which would draw the ditch
 *   beside the wall.
 * - **Not used:** Wikidata (points only), Pleiades (one 1.9 km-accuracy label
 *   line), Natural Earth rivers (1–5 km off the real channel).
 *
 * Priority between sources is `priority` below: a lower source is only drawn
 * where no higher one lies within `TRACE_DEDUPE_METRES`, so two traces of one
 * wall never draw as two lines.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sql } from 'postgres'
import type { LimesSegmentKind, LimesSource } from '../../shared/types'

const CACHE_DIR = join(process.cwd(), '.import', 'atlas')
const OSM_OVERPASS = 'https://overpass-api.de/api/interpreter'
const OHM_OVERPASS = 'https://overpass-api.openhistoricalmap.org/api/interpreter'
const USER_AGENT = 'vestigian-import/0.1 (https://vestigian.org)'

export interface TraceClip {
  west: number
  south: number
  east: number
  north: number
}

export interface TraceStretch {
  label: string
  source: Exclude<LimesSource, 'awmc' | 'extent'>
  /** Lower wins where two sources trace the same ground. */
  priority: number
  kind: LimesSegmentKind
  /** Gazetteer slugs, in claiming order. Explicit rather than by bounds: a trace belongs to the sector it was chosen for. */
  sectors: readonly string[]
  /** A MultiLineString. */
  geojson: string
  /** Keep only what lies within reach of the derived frontier — see `refineTraces` in 06-limes.ts. */
  maskToFrontier: boolean
  /** Keep only what lies inside this box. For a trace that is only frontier along part of its length. */
  clip?: TraceClip
  /**
   * Skip the cut-back against higher-priority traces. For a trace whose box is
   * disjoint from every other trace of its sector by construction: cutting it
   * back anyway only opens a gap (up to the dedupe reach) at the join.
   */
  exclusive?: boolean
}

interface OverpassMember {
  type: string
  role?: string
  geometry?: { lat: number; lon: number }[]
}

interface OverpassElement {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: OverpassMember[]
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Cached, and retried with a growing pause: the public Overpass instances
 * answer 429/504 under load, which is a reason to wait, not to fail an import
 * whose other inputs are already on disk.
 */
const overpassCached = async (
  endpoint: string,
  query: string,
  fileName: string,
): Promise<OverpassElement[]> => {
  const path = join(CACHE_DIR, fileName)
  const cached = await readFile(path, 'utf8').catch(() => null)
  if (cached) return (JSON.parse(cached) as { elements: OverpassElement[] }).elements

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: `data=${encodeURIComponent(query)}`,
    })
    if (response.ok) {
      const text = await response.text()
      try {
        const parsed = JSON.parse(text) as { elements: OverpassElement[] }
        await writeFile(path, text)
        return parsed.elements
      } catch {
        // An HTML error page with a 200 status is what a busy Overpass sends.
      }
    }
    await sleep(attempt * 20_000)
  }
  throw new Error(`${endpoint} did not answer ${fileName} after 6 attempts`)
}

type Line = [number, number][]

const toLine = (geometry: { lat: number; lon: number }[] | undefined): Line =>
  (geometry ?? []).map((point) => [point.lon, point.lat])

const isClosed = (line: Line): boolean => {
  const first = line[0]
  const last = line[line.length - 1]
  return (
    line.length > 3 &&
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1]
  )
}

/** The open ways of a relation, optionally only those with one of `roles`. */
const relationLines = (
  elements: OverpassElement[],
  relationId: number,
  roles?: readonly string[],
): Line[] => {
  const relation = elements.find(
    (element) => element.type === 'relation' && element.id === relationId,
  )
  if (!relation) return []
  return (relation.members ?? [])
    .filter((member) => member.type === 'way' && (!roles || roles.includes(member.role ?? '')))
    .map((member) => toLine(member.geometry))
    .filter((line) => line.length > 1 && !isClosed(line))
}

const multiLine = (lines: Line[]): string =>
  JSON.stringify({ type: 'MultiLineString', coordinates: lines })

interface ViciSpec {
  label: string
  kind: LimesSegmentKind
  sectors: readonly string[]
  refs: readonly number[]
}

/**
 * vici.org line ids by sector. Ids, not titles: a title regex catches roads and
 * the Vallum, an id is a decision.
 */
const VICI_SPECS: readonly ViciSpec[] = [
  {
    label: 'ORL',
    kind: 'barrier',
    sectors: ['limes-germanicus-superior', 'limes-raeticus'],
    refs: [90, 91, 92],
  },
  {
    label: 'Antonine Wall',
    kind: 'barrier',
    sectors: ['antonine-wall'],
    refs: [2523, 2524, 2541, 2542, 2543, 2544, 6215],
  },
  // The Dacian salient is drawn from what was traced on the ground — the eastern limes along the
  // Carpathian foothills — not from the province outline the 200 CE extent gives.
  {
    label: 'Dacian limes',
    kind: 'notional',
    sectors: ['limes-daciae'],
    refs: [8758, 30774, 16641],
  },
  {
    label: 'Transalutanus and Alutanus',
    kind: 'barrier',
    sectors: ['limes-transalutanus'],
    refs: [20494, 36057, 36069],
  },
]

const fetchVici = async (sql: Sql): Promise<TraceStretch[]> => {
  const stretches: TraceStretch[] = []
  for (const spec of VICI_SPECS) {
    const refs = spec.refs.map((id) => `vici.org-line#${id}`)
    const rows = await sql<{ source_ref: string; geojson: string }[]>`
      SELECT source_ref, ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(geom, 2))) AS geojson
      FROM tracings
      WHERE source_ref = ANY(${refs}) AND status = 'approved'
    `
    const missing = refs.filter((ref) => !rows.some((row) => row.source_ref === ref))
    if (missing.length > 0)
      console.log(`  vici ${spec.label}: not found here — ${missing.join(', ')}`)
    for (const row of rows) {
      stretches.push({
        label: `vici ${spec.label} ${row.source_ref}`,
        source: 'vici',
        priority: 2,
        kind: spec.kind,
        sectors: spec.sectors,
        geojson: row.geojson,
        maskToFrontier: false,
      })
    }
  }
  return stretches
}

const OSM_WALL_RELATIONS = {
  hadrian: 5538074,
  antonine: 3156625,
  orl: 955148,
  limesGermanicus: 933495,
  csorsz: 11217745,
} as const

/** Danube, Rhine, and the Main, which is the frontier between Großkrotzenburg and Miltenberg. */
const OSM_RIVER_RELATIONS = { danube: 89652, rhine: 123924, main: 412876 } as const

/**
 * Where a river is the frontier, as boxes. Found by scoring against the
 * Deutsche Limes-Straße's published course of the Limes (2026-10-09, not used as
 * a source — no licence stated): the OSM Rhine main stream follows it to a median
 * 23 m between the Dutch border and Rheinbrohl (99% within 100 m), and the ORL's
 * Main section (the Mainlinie, Großkrotzenburg to Miltenberg) was the 55 km
 * stretch no source here had.
 */
/**
 * The Rhine upstream of Rheinbrohl (Koblenz and above) is inside the empire, so
 * it is deliberately not drawn: an earlier build kept 30 km of it because the
 * generalised edge happened to run beside it.
 */
const GERMAN_RHINE_FRONTIER: TraceClip = { west: 6.03, south: 50.45, east: 7.35, north: 51.95 }
const MAIN_FRONTIER: TraceClip = { west: 8.95, south: 49.66, east: 9.33, north: 50.12 }

/**
 * OpenHistoricalMap's Lower Germanic relation is kept only west of the German
 * border. East of it OHM leaves the Rhine in places (up to ~12 km off the
 * Limes-Straße's course near Xanten and Moers); the Rhine's own centreline is
 * what the frontier followed there.
 */
const OHM_LOWER_GERMANIC_CLIP: TraceClip = { west: -1, south: 50, east: 6.03, north: 53 }

const fetchOsm = async (): Promise<TraceStretch[]> => {
  const ids = [...Object.values(OSM_WALL_RELATIONS), ...Object.values(OSM_RIVER_RELATIONS)]
  // The cache is keyed by file name, so the name carries the relation list: adding
  // a relation must not silently keep serving the response without it.
  const elements = await overpassCached(
    OSM_OVERPASS,
    `[out:json][timeout:280];rel(id:${ids.join(',')});out geom;`,
    `limes-osm-${ids.join('-')}.json`,
  )

  const wall = (label: string, relationId: number, sectors: readonly string[]): TraceStretch => ({
    label: `OSM ${label}`,
    source: 'osm',
    priority: 1,
    kind: 'barrier',
    sectors,
    geojson: multiLine(relationLines(elements, relationId)),
    maskToFrontier: false,
  })

  interface RiverOptions {
    label: string
    relationId: number
    sectors: readonly string[]
    /** Follow the derived frontier (true), or a box where the river is known to be it (false). */
    clip?: TraceClip
  }

  const river = ({ label, relationId, sectors, clip }: RiverOptions): TraceStretch => ({
    label: `OSM ${label}`,
    source: 'osm',
    priority: 1,
    kind: 'river',
    sectors,
    // The main channel only: the side streams are braids and distributaries the frontier did not follow.
    geojson: multiLine(relationLines(elements, relationId, ['main_stream'])),
    maskToFrontier: clip === undefined,
    clip,
  })

  const upperGerman = ['limes-germanicus-superior', 'limes-raeticus']
  return [
    wall("Hadrian's Wall", OSM_WALL_RELATIONS.hadrian, ['hadrians-wall']),
    wall('Antonine Wall', OSM_WALL_RELATIONS.antonine, ['antonine-wall']),
    wall('ORL', OSM_WALL_RELATIONS.orl, upperGerman),
    wall('Limes Germanicus', OSM_WALL_RELATIONS.limesGermanicus, upperGerman),
    wall('Csörsz-árok', OSM_WALL_RELATIONS.csorsz, ['limes-sarmatiae']),
    river({
      label: 'Danube',
      relationId: OSM_RIVER_RELATIONS.danube,
      sectors: ['limes-raeticus', 'danube-limes-noricum-pannonia', 'danube-limes-moesia'],
    }),
    river({
      label: 'Rhine (lower, German reach)',
      relationId: OSM_RIVER_RELATIONS.rhine,
      sectors: ['limes-germanicus-inferior'],
      clip: GERMAN_RHINE_FRONTIER,
    }),
    river({
      label: 'Main (Mainlinie)',
      relationId: OSM_RIVER_RELATIONS.main,
      sectors: ['limes-germanicus-superior'],
      clip: MAIN_FRONTIER,
    }),
  ]
}

const OHM_LOWER_GERMANIC_RELATION = 2681972

const fetchOhm = async (): Promise<TraceStretch[]> => {
  const relation = await overpassCached(
    OHM_OVERPASS,
    `[out:json][timeout:180];rel(${OHM_LOWER_GERMANIC_RELATION});out geom;`,
    'limes-ohm-inferior.json',
  )
  // Ways dated to the frontier's use. Named ways only: OHM also holds modern streets called "Limes".
  const ways = await overpassCached(
    OHM_OVERPASS,
    `[out:json][timeout:180];(
      way["name"~"^(Vallum Hadriani|Vallum)$"]["start_date"~"^0?1[0-9][0-9]$|^122$"](54.8,-3.8,55.2,-1.3);
      way["name"="Antonine Wall"](55.8,-4.8,56.2,-3.2);
      way["name"~"^(Limes|Limes Germanicus)$"]["start_date"~"^0?(83|120)$"](47.4,6.3,51.0,12.9);
    );out geom;`,
    'limes-ohm-ways.json',
  )

  const wayStretch = (
    label: string,
    pick: (element: OverpassElement) => boolean,
    sectors: readonly string[],
  ): TraceStretch => ({
    label: `OHM ${label}`,
    source: 'ohm',
    priority: 3,
    kind: 'barrier',
    sectors,
    geojson: multiLine(
      ways
        .filter((element) => element.type === 'way' && pick(element))
        .map((element) => toLine(element.geometry))
        .filter((line) => line.length > 1 && !isClosed(line)),
    ),
    maskToFrontier: false,
  })

  const named = (names: readonly string[]) => (element: OverpassElement) =>
    names.includes(element.tags?.name ?? '')

  return [
    {
      label: 'OHM Limes Germanicus inferior',
      source: 'ohm',
      priority: 3,
      kind: 'river',
      sectors: ['limes-germanicus-inferior'],
      geojson: multiLine(relationLines(relation, OHM_LOWER_GERMANIC_RELATION)),
      maskToFrontier: false,
      clip: OHM_LOWER_GERMANIC_CLIP,
      exclusive: true,
    },
    wayStretch("Hadrian's Wall", named(['Vallum Hadriani', 'Vallum']), ['hadrians-wall']),
    wayStretch('Antonine Wall', named(['Antonine Wall']), ['antonine-wall']),
    wayStretch('ORL', named(['Limes', 'Limes Germanicus']), [
      'limes-germanicus-superior',
      'limes-raeticus',
    ]),
  ]
}

/** Every traced stretch the import knows how to read, empty ones dropped. */
export const readTracedStretches = async (sql: Sql): Promise<TraceStretch[]> => {
  await mkdir(CACHE_DIR, { recursive: true })
  const stretches = [...(await fetchOsm()), ...(await fetchOhm()), ...(await fetchVici(sql))]
  const usable = stretches.filter((stretch) => {
    const lines = (JSON.parse(stretch.geojson) as { coordinates: unknown[] }).coordinates
    if (lines.length === 0) console.log(`  ${stretch.label}: nothing read — skipped`)
    return lines.length > 0
  })
  return usable
}
