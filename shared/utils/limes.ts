// `../types`, not `#shared/types`: this module is imported by
// `scripts/import/06-limes.ts`, which runs under plain tsx with no Nuxt aliases
// — the same reason `pleiades.ts` reaches for a relative path.
import type { BoundingBox, LimesMark, LimesSegmentKind } from '../types'

/**
 * The frontier vocabulary, shared by the import, the tile server and the app —
 * the same reason `scripts/import/vici-licences.ts` is shared. A sector must
 * not be able to mean one thing to the importer that drew it and another to the
 * page that names it.
 *
 * Two things live here: which source terms count as an installation on the
 * frontier, and the gazetteer of named sectors.
 *
 * ## What is authored here, and what is not
 *
 * **No geometry.** Every metre of the frontier is derived from AWMC's extent of
 * the empire and AWMC's wall linework (ODbL 1.0). What this file adds is the
 * names, the dates, the prose and a bounding box per sector, because AWMC's 92
 * wall features carry no name at all (`count(name) = 0`) and the derived runs
 * carry nothing but a length. Without a gazetteer the map could draw the
 * frontier and could not tell you which frontier you were looking at.
 *
 * That makes the bounds editorial, and editorial input is allowed to be wrong.
 * The import therefore **reports every run and wall no sector claimed** rather
 * than dropping it silently — the same posture the `pmeta_extids` allowlist
 * parser takes in `02-mysql-to-postgres.ts`.
 *
 * ## What is deliberately not claimed
 *
 * The 200 CE extent has about 12,000 km of land boundary, and not all of it was
 * a frontier system. The largest unclaimed run is ~2,200 km of southern
 * Egyptian and Cyrenaican desert edge: a provincial boundary drawn across the
 * Sahara, with no garrison, no road and no works. Drawing that in the same red
 * as Hadrian's Wall would assert something no source does. It is left
 * unclaimed, and the import says so. So are the city and isthmus walls in
 * AWMC's `walls` layer — the Hexamilion at Corinth, the Dema wall in Attica,
 * the wall across the Thracian Chersonese — which are fortifications but not
 * frontiers.
 */

/**
 * Pleiades feature types that put a place on the frontier.
 *
 * Wider than {@link PLEIADES_MARKS} on purpose: a stretch of defensive wall or
 * a barracks belongs in a sector's roll and has no business being drawn as a
 * fort-shaped mark on the line it is part of.
 */
export const LIMES_PLEIADES_TYPES = new Set([
  'fort',
  'fortlet',
  'fort-group',
  'castellum',
  'citadel',
  'military-base',
  'military-installation-or-camp-temporary',
  'frontier-system-limes',
  'tower-defensive',
  'tower-single',
  'tower-wall',
  'tower-gate',
  'defensive-wall',
  'city-wall',
  'wall',
  'barracks',
  'hillfort',
  'fortified-settlement',
])

/**
 * The Postgres regular expression behind the `military` property on the atlas
 * `places` tile layer and the roll query. Built from the set above so the tile
 * and the page cannot disagree about what counts.
 *
 * `feature_types` is a comma-separated list, so each term is anchored between a
 * comma or a string edge. Ordinal suffixes (`fort-2`) are matched by the
 * optional trailing group rather than by stripping, because this runs in SQL.
 */
export const buildMilitaryFeatureTypePattern = (): string =>
  `(^|,)\\s*(${[...LIMES_PLEIADES_TYPES].join('|')})(-[0-9]+)?\\s*(,|$)`

/**
 * The marks, in the order a frontier is read down: smallest post to largest.
 * The legend and the icon registry both walk this, so a mark cannot be drawn
 * without also being explained.
 */
export const LIMES_MARKS: readonly LimesMark[] = [
  'watchtower',
  'fortlet',
  'fort',
  'fortress',
  'camp',
] as const

/** Pleiades terms that earn a drawn mark, and which one. */
const PLEIADES_MARKS: Record<string, LimesMark> = {
  'tower-defensive': 'watchtower',
  'tower-single': 'watchtower',
  'tower-wall': 'watchtower',
  'tower-gate': 'watchtower',
  fortlet: 'fortlet',
  fort: 'fort',
  'fort-group': 'fort',
  castellum: 'fort',
  'military-base': 'fortress',
  citadel: 'fortress',
  'military-installation-or-camp-temporary': 'camp',
}

/**
 * Vici's own kind vocabulary, recovered into `sites.subcategory`.
 *
 * Only three of its 25 kinds map onto `fortification`, which is exactly why the
 * column had to exist: collapsing `watchtower` and `fort` into one category
 * threw away the distinction a reader following a frontier most needs.
 */
export const VICI_MARKS: Record<string, LimesMark> = {
  watchtower: 'watchtower',
  fort: 'fort',
  camp: 'camp',
}

const stripOrdinal = (term: string): string => term.replace(/-\d+$/, '')

/**
 * The same mapping as {@link resolveLimesMark}'s Pleiades half, as a SQL CASE.
 *
 * Generated rather than hand-written so the mark a tile draws and the mark a
 * sector's roll lists come from one table. Order is preserved, so the first
 * matching term wins exactly as it does in TypeScript — which is what makes
 * "fort, tower-defensive" a fort rather than a tower.
 *
 * The terms are fixed identifiers containing no quotes; `column` is supplied by
 * this project's own code, never by a request.
 */
export const buildPleiadesMarkSql = (column: string): string => {
  const branches = Object.entries(PLEIADES_MARKS)
    .map(([term, mark]) => `WHEN ${column} ~ '(^|,)\\s*${term}(-[0-9]+)?\\s*(,|$)' THEN '${mark}'`)
    .join(' ')
  return `CASE ${branches} ELSE NULL END`
}

export interface LimesMarkSource {
  /** `sites.subcategory`, vici's original `pnt_kind`. */
  subcategory?: string | null
  /** `antiquity_places.feature_types`, Pleiades' comma-separated list. */
  featureTypes?: string | null
}

/**
 * The mark to draw for one installation, from whichever vocabulary describes it.
 *
 * Null is an ordinary answer and means "on the frontier, but not a thing with a
 * shape" — a length of wall, a barracks, a fort whose source never said what
 * kind. Those keep the generic fortification glyph they already have rather
 * than being promoted to a tower they may not have been.
 */
export const resolveLimesMark = (source: LimesMarkSource): LimesMark | null => {
  const subcategory = source.subcategory?.trim().toLowerCase()
  if (subcategory && VICI_MARKS[subcategory]) return VICI_MARKS[subcategory]

  if (!source.featureTypes) return null
  for (const term of source.featureTypes.split(',')) {
    const match = PLEIADES_MARKS[stripOrdinal(term.trim().toLowerCase())]
    if (match) return match
  }
  return null
}

export interface LimesSectorDefinition {
  slug: string
  name: string
  latinName: string | null
  /**
   * What the frontier physically was here, for stretches derived from the edge
   * of the empire. AWMC's wall linework is always a `barrier` regardless.
   *
   * It is authored rather than measured because there is nothing to measure it
   * against: AWMC's inland water is lakes and marshes, not river courses, so
   * the Rhine and the Danube are simply absent from it. Whether the frontier
   * here was a river is a fact about the sector, and this is the file where
   * facts about sectors live.
   */
  frontierKind: Exclude<LimesSegmentKind, 'barrier'>
  /**
   * Which kinds this sector will claim. A sector that accepts only 'barrier'
   * takes AWMC walls and leaves the derived frontier alone, which is what keeps
   * the Limes Transalutanus — an earthwork north of the river — from swallowing
   * the Danube frontier running through the same rectangle.
   */
  accepts: readonly LimesSegmentKind[]
  bounds: BoundingBox
  minYear: number
  maxYear: number
  pleiadesId: string | null
  summary: string
}

const BARRIER_ONLY = ['barrier'] as const
const FRONTIER_ONLY = ['river', 'notional'] as const
const EVERYTHING = ['barrier', 'river', 'notional'] as const

/**
 * The named sectors, in claiming order: the first definition whose bounds
 * contain a stretch, and whose `accepts` admits its kind, takes it.
 *
 * Order matters where two sectors share ground. The Dacian salient is listed
 * before the Moesian Danube because their rectangles overlap around 45.3 N and
 * the salient is the more specific claim; the barrier-only sectors are listed
 * beside the frontier they belong to rather than gathered at the end, so the
 * list reads north-west to south-east the way the frontier itself runs.
 */
export const LIMES_SECTORS: readonly LimesSectorDefinition[] = [
  {
    slug: 'hadrians-wall',
    name: "Hadrian's Wall",
    latinName: 'Vallum Aelium',
    frontierKind: 'notional',
    accepts: EVERYTHING,
    bounds: { west: -3.9, south: 54.4, east: -1.2, north: 55.5 },
    minYear: 122,
    maxYear: 410,
    pleiadesId: '91358',
    summary:
      'Eighty Roman miles of stone and turf from the Tyne to the Solway, with a milecastle at every mile and two turrets between each pair. It is the most completely surveyed frontier in the empire, which is why the marks along it are dense enough to walk.',
  },
  {
    slug: 'antonine-wall',
    name: 'Antonine Wall',
    latinName: 'Vallum Antonini',
    frontierKind: 'notional',
    accepts: EVERYTHING,
    bounds: { west: -4.9, south: 55.4, east: -3.3, north: 56.4 },
    minYear: 142,
    maxYear: 162,
    pleiadesId: '91357',
    summary:
      'A turf rampart on a stone base across the Forth–Clyde isthmus, held for barely twenty years before the army fell back to the Tyne–Solway line. AWMC still draws the province reaching it at 200 CE, four decades after it was given up, so the frontier here is the one place on the sheet where the extent and the archaeology disagree.',
  },
  {
    slug: 'limes-germanicus-inferior',
    name: 'Lower German Limes',
    latinName: 'Limes Germaniae Inferioris',
    frontierKind: 'river',
    accepts: EVERYTHING,
    bounds: { west: 2.9, south: 50.3, east: 7.35, north: 52.7 },
    minYear: -12,
    maxYear: 410,
    pleiadesId: null,
    summary:
      'The Rhine from the North Sea to the Vinxtbach, held from its left bank by a chain of forts roughly a day’s march apart. Nothing was built across the country here: the river was the line, and the fleet patrolled it.',
  },
  {
    slug: 'limes-germanicus-superior',
    name: 'Upper German Limes',
    latinName: 'Limes Germaniae Superioris',
    frontierKind: 'river',
    accepts: EVERYTHING,
    bounds: { west: 6.2, south: 48.3, east: 9.7, north: 50.5 },
    minYear: 83,
    maxYear: 260,
    pleiadesId: null,
    summary:
      'Where the frontier left the Rhine and struck overland across the Wetterau and the Odenwald — a palisade, then a bank and ditch, with a watchtower in sight of the next one the whole way. Abandoned in the crisis of the 260s.',
  },
  {
    slug: 'limes-raeticus',
    name: 'Raetian Limes',
    latinName: 'Limes Raetiae',
    frontierKind: 'notional',
    accepts: EVERYTHING,
    bounds: { west: 9.7, south: 47.9, east: 12.15, north: 49.5 },
    minYear: 90,
    maxYear: 260,
    pleiadesId: null,
    summary:
      'The Teufelsmauer: a mortared stone wall running almost straight for 160 km from Lorch to the Danube at Eining, the only stretch of the continental frontier built in stone along its whole length.',
  },
  {
    slug: 'limes-sarmatiae',
    name: 'Sarmatian Ramparts',
    latinName: 'Limes Sarmatiae',
    frontierKind: 'notional',
    accepts: BARRIER_ONLY,
    bounds: { west: 18.9, south: 44.6, east: 21.9, north: 48.2 },
    minYear: 324,
    maxYear: 380,
    pleiadesId: null,
    summary:
      'The Csörsz-árok, several hundred kilometres of ditch and bank enclosing the Sarmatian plain beyond the Danube. Roman-engineered but not a Roman border: built to shield a client people, and lying outside the empire it defended.',
  },
  {
    slug: 'limes-daciae',
    name: 'Dacian Limes',
    latinName: 'Limes Daciae',
    frontierKind: 'notional',
    accepts: FRONTIER_ONLY,
    bounds: { west: 20.0, south: 45.3, east: 27.6, north: 48.3 },
    minYear: 106,
    maxYear: 275,
    pleiadesId: '207241',
    summary:
      'The salient north of the Danube taken by Trajan and given up under Aurelian — the only province the empire held on the far bank for long, and the only frontier here that is a loop rather than a line.',
  },
  {
    slug: 'limes-transalutanus',
    name: 'Limes Transalutanus',
    latinName: 'Limes Transalutanus',
    frontierKind: 'notional',
    accepts: BARRIER_ONLY,
    bounds: { west: 22.7, south: 43.6, east: 26.5, north: 45.2 },
    minYear: 106,
    maxYear: 245,
    pleiadesId: '221217',
    summary:
      'An earth rampart running north from the Danube east of the Olt, with the Brazda lui Novac beyond it. Forward of the river line and held for barely a century.',
  },
  {
    slug: 'danube-limes-noricum-pannonia',
    name: 'Danube Limes — Noricum and Pannonia',
    latinName: 'Ripa Danuvii',
    frontierKind: 'river',
    accepts: FRONTIER_ONLY,
    bounds: { west: 12.15, south: 44.4, east: 19.5, north: 49.4 },
    minYear: -15,
    maxYear: 476,
    pleiadesId: null,
    summary:
      'From the Raetian wall’s end at Eining down to the Drava, the longest river frontier the empire held — legionary fortresses at Carnuntum, Vindobona and Aquincum with auxiliary forts strung between them.',
  },
  {
    slug: 'danube-limes-moesia',
    name: 'Danube Limes — Moesia and Scythia',
    latinName: 'Ripa Danuvii',
    frontierKind: 'river',
    accepts: FRONTIER_ONLY,
    bounds: { west: 19.5, south: 43.0, east: 30.2, north: 45.9 },
    minYear: -15,
    maxYear: 602,
    pleiadesId: null,
    summary:
      'The lower river, through the Iron Gates to the delta and the Black Sea. It outlasted every other frontier in Europe, still garrisoned when the Rhine had been gone for two centuries.',
  },
  {
    slug: 'claustra-alpium-iuliarum',
    name: 'Claustra Alpium Iuliarum',
    latinName: 'Claustra Alpium Iuliarum',
    frontierKind: 'notional',
    accepts: BARRIER_ONLY,
    bounds: { west: 13.7, south: 45.2, east: 14.8, north: 46.3 },
    minYear: 270,
    maxYear: 400,
    pleiadesId: '201587',
    summary:
      'Walls and towers barring the passes from Pannonia into Italy. Not an external frontier at all — an interior one, built late and against Roman armies as often as anyone else.',
  },
  {
    slug: 'fossatum-africae',
    name: 'Fossatum Africae',
    latinName: 'Fossatum Africae',
    frontierKind: 'notional',
    accepts: EVERYTHING,
    bounds: { west: 3.5, south: 33.5, east: 9.0, north: 36.5 },
    minYear: 120,
    maxYear: 400,
    pleiadesId: '334546',
    summary:
      'Ditches and banks across the Numidian pre-desert, in several discontinuous stretches rather than one line — a frontier drawn where cultivation stopped, and read as much as a customs boundary as a military one.',
  },
  {
    slug: 'limes-tripolitanus',
    name: 'Limes Tripolitanus',
    latinName: 'Limes Tripolitanus',
    frontierKind: 'notional',
    accepts: EVERYTHING,
    bounds: { west: 8.8, south: 29.5, east: 15.5, north: 34.0 },
    minYear: 200,
    maxYear: 450,
    pleiadesId: null,
    summary:
      'Not a wall but a depth of fortified farms and clausurae blocking the wadis inland of Lepcis Magna and Sabratha, garrisoned increasingly by the farmers themselves.',
  },
  {
    slug: 'limes-mauretaniae',
    name: 'Mauretanian Limes',
    latinName: 'Limes Mauretaniae',
    frontierKind: 'notional',
    accepts: EVERYTHING,
    bounds: { west: -7.5, south: 28.5, east: 3.5, north: 36.0 },
    minYear: 40,
    maxYear: 400,
    pleiadesId: null,
    summary:
      'The western African frontier, from the Atlantic across the Rif and the high plains — the least built and least excavated stretch of the whole circuit, and drawn here largely as the edge of the province.',
  },
  {
    slug: 'limes-arabicus',
    name: 'Limes Arabicus',
    latinName: 'Limes Arabicus',
    frontierKind: 'notional',
    accepts: EVERYTHING,
    bounds: { west: 34.5, south: 27.5, east: 39.6, north: 34.2 },
    minYear: 106,
    maxYear: 630,
    pleiadesId: null,
    summary:
      'The desert edge from the Gulf of Aqaba to the Hauran, anchored on the Via Nova Traiana and a line of forts at the last reliable water. Facing no state, only the steppe.',
  },
  {
    slug: 'limes-syriae',
    name: 'Syrian and Mesopotamian Frontier',
    latinName: 'Limes Syriae',
    frontierKind: 'notional',
    accepts: EVERYTHING,
    bounds: { west: 39.6, south: 34.0, east: 43.5, north: 38.5 },
    minYear: 60,
    maxYear: 630,
    pleiadesId: null,
    summary:
      'The one frontier that faced an equal. Held against Parthia and then Persia, it moved repeatedly with the outcome of wars, which is why a single line here is more of a simplification than anywhere else on the circuit.',
  },
  {
    slug: 'limes-cappadociae',
    name: 'Cappadocian Frontier',
    latinName: 'Limes Cappadociae',
    frontierKind: 'river',
    accepts: EVERYTHING,
    bounds: { west: 37.8, south: 38.0, east: 41.6, north: 41.6 },
    minYear: 70,
    maxYear: 630,
    pleiadesId: null,
    summary:
      'The upper Euphrates through the Armenian highlands, garrisoned by two legions at Melitene and Satala and by forts in the gorges between them.',
  },
] as const

export const findLimesSector = (slug: string): LimesSectorDefinition | undefined =>
  LIMES_SECTORS.find((sector) => sector.slug === slug)

export interface LimesClaim {
  sector: LimesSectorDefinition
  /**
   * The bounds of every earlier sector that accepts the same kind, which this
   * claim must not draw. See {@link claimLimesSectors}.
   */
  excludes: BoundingBox[]
}

const overlaps = (a: BoundingBox, b: BoundingBox): boolean =>
  a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south

/**
 * Which sectors claim a stretch, and what each of them must leave alone.
 *
 * A stretch is clipped into **every** sector whose bounds it overlaps, not just
 * the first: one 1,331 km run of Danube legitimately crosses Noricum, Pannonia
 * and Moesia, and handing it whole to whichever sector happens to be listed
 * first would file the Hungarian plain under Bulgaria.
 *
 * That alone would draw the overlaps twice. Where two sectors that accept the
 * same kind share ground — the Dacian salient and the Moesian Danube meet
 * around 45.3 N, and the Syrian and Cappadocian frontiers around 38 N — the
 * earlier definition wins, and the later one is told to subtract it. Measured
 * before this existed: 209 km of frontier was in the database twice, drawn
 * twice and counted twice in two sectors' lengths.
 *
 * `excludes` is bounds rather than geometry because that is the whole of the
 * conflict: the gazetteer's rectangles are what overlap, and subtracting the
 * rectangle is exact.
 */
export const claimLimesSectors = (input: {
  kind: LimesSegmentKind
  bounds: BoundingBox
}): LimesClaim[] => {
  const claims: LimesClaim[] = []
  const earlier: BoundingBox[] = []

  for (const sector of LIMES_SECTORS) {
    if (!sector.accepts.includes(input.kind)) continue
    if (overlaps(input.bounds, sector.bounds)) {
      claims.push({ sector, excludes: [...earlier] })
    }
    // Recorded whether or not this stretch touched it: a later sector has to
    // subtract every earlier rectangle that could hold the same ground.
    earlier.push(sector.bounds)
  }

  return claims
}
