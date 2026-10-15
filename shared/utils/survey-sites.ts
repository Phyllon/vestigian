/**
 * Reading a row of the Ancient Sites and Monuments Survey for the one thing it does not carry in
 * a column: **when**. The survey has no period field — dating lives in each source's own prose,
 * in a grammar that differs per source — so this file is a set of small per-source readers and the
 * vocabularies they resolve against, not a generic date guesser. A row whose source is not listed
 * here, or whose prose names no period from Hellenistic to Byzantine, yields `null` and is left
 * out; a regular expression over the whole note was tried first and matched bibliography titles
 * ("Journal of Roman Archaeology"), a Colombian surname ("Francisco Romano") and the Baltic
 * "Pre-Roman Iron Age".
 *
 * **Where each vocabulary's dates come from** (all fetched 15 Oct 2026, not recalled):
 * - `levant` — the Villages to Empires dataset's own `Period`/`StartDate`/`EndDate` columns
 *   (Zenodo 17285091, CC BY 4.0): Hellenistic −333…−63, Early Roman −63…70, Roman −63…324, Late
 *   Roman 70…324, Byzantine 324…638. Gwiazda's chamber tombs carry explicit years and are read as
 *   given.
 * - `britain` — Historic England's period vocabulary (`purl.org/heritagedata/schemes/eh_period`,
 *   OGL v3): Early Iron Age −800…−300, Middle −300…−100, Late −100…43, Iron Age −800…43,
 *   Roman (= "Romano-British") 43…410.
 * - `convention` — Marmarica (Laguna-Palma 2022, Zenodo 7678852) names periods but gives no
 *   years in the survey's prose. The numbers here are ordinary conventions for Egypt and
 *   Cyrenaica (Ptolemaic end −30, Diocletian 284) and the row is marked as such, not as sourced.
 *
 * - Canmore, Historic England (scheduled monuments), Sardinia PPR and the LuwianSiteAtlas were added
 *   once their licences were read from the Survey's own credits page (survey.jensineandresen.com,
 *   fetched 15 Oct 2026); none of them gives years, so they are `convention`, except Historic
 *   England, whose "Roman" is the vocabulary above.
 *
 * The span is **clipped to the window the atlas draws** (−800…640): a Cornwall round recorded as
 * "Palaeolithic to Romano British" is stored from −800, because a million-year lower bound would
 * be true and useless.
 */

export const SURVEY_SITE_SOURCES = [
  'villages-to-empires',
  'cornwall-her',
  'gwiazda-chamber-tombs',
  'marmarica',
  'canmore',
  'historic-england',
  'sardinia-ppr',
  'luwian-studies',
] as const

export type SurveySiteSource = (typeof SURVEY_SITE_SOURCES)[number]

export interface SurveySourceMeta {
  name: string
  url: string
  /** As the source states it, 15 Oct 2026 — see the table in `scripts/import/27-survey-sites.ts`. */
  licence: string
}

/** The compilation every row came through. A proper name, so never translated. */
export const SURVEY_PROJECT = {
  name: 'Ancient Sites and Monuments Survey',
  author: 'Jensine Andresen',
  url: 'https://survey.jensineandresen.com',
  licence: 'ODbL 1.0',
} as const

export const SURVEY_SITE_SOURCE_META: Readonly<Record<SurveySiteSource, SurveySourceMeta>> = {
  'villages-to-empires': {
    name: 'Villages to Empires, South Levant (Titolo, University of Turin)',
    url: 'https://zenodo.org/records/17285091',
    licence: 'CC BY 4.0',
  },
  'cornwall-her': {
    name: 'Cornwall and Scilly Historic Environment Record (Cornwall Council)',
    url: 'https://www.data.gov.uk/dataset/historic-buildings-sites-and-monuments-record',
    licence: 'OGL v3',
  },
  'gwiazda-chamber-tombs': {
    name: 'Syro-Palestinian chamber tombs (Gwiazda)',
    url: 'https://zenodo.org/records/4156221',
    licence: 'CC BY 4.0',
  },
  marmarica: {
    name: 'Marmarica sites database (Laguna-Palma)',
    url: 'https://zenodo.org/records/7678852',
    licence: 'CC BY 4.0',
  },
  canmore: {
    name: 'Canmore (Historic Environment Scotland)',
    url: 'https://canmore.org.uk/',
    licence: 'OGL',
  },
  'historic-england': {
    name: 'National Heritage List for England (Historic England)',
    url: 'https://historicengland.org.uk/listing/the-list/',
    licence: 'OGL v3',
  },
  'sardinia-ppr': {
    name: 'Piano Paesaggistico Regionale (Regione Autonoma della Sardegna)',
    url: 'https://www.sardegnageoportale.it/',
    licence: 'CC BY 4.0',
  },
  'luwian-studies': {
    name: 'LuwianSiteAtlas (Aşınmaz, Mutlu and Zangger; Luwian Studies)',
    url: 'https://doi.org/10.5281/zenodo.17128262',
    licence: 'CC BY 4.0',
  },
}

export const SURVEY_PERIOD_KEYS = [
  'early-iron-age',
  'middle-iron-age',
  'late-iron-age',
  'iron-age',
  'punic',
  'hellenistic',
  'early-roman',
  'roman',
  'late-roman',
  'romano-british',
  'byzantine',
] as const

export type SurveyPeriodKey = (typeof SURVEY_PERIOD_KEYS)[number]

export type SurveyPeriodBasis = 'source-vocabulary' | 'source-dates' | 'convention'

export const SURVEY_SITE_KINDS = [
  'settlement',
  'enclosed-settlement',
  'hut-circle',
  'courtyard-house',
  'fogou',
  'hillfort',
  'fortification',
  'burial',
  'building',
  'harbour',
  'site',
] as const

export type SurveySiteKind = (typeof SURVEY_SITE_KINDS)[number]

export type SurveyEvidence = 'cropmarks' | 'documents' | 'place-names' | 'demolished-structure'

export const ANTIQUITY_WINDOW_FROM = -800
export const ANTIQUITY_WINDOW_TO = 640

export interface SurveyRecord {
  surveyId: string
  name: string
  typeInSource: string
  note: string
  sources: string
  lat: number
  lon: number
}

export interface SurveyPeriods {
  keys: SurveyPeriodKey[]
  from: number
  to: number
  basis: SurveyPeriodBasis
}

export interface SurveySite {
  surveyId: string
  source: SurveySiteSource
  name: string
  kind: SurveySiteKind
  periods: SurveyPeriods
  destroyed: boolean
  uncertain: boolean
  evidence: SurveyEvidence | null
  lat: number
  lon: number
}

interface Atom {
  key: SurveyPeriodKey
  from: number
  to: number
}

const LEVANT: Readonly<Record<string, Atom>> = {
  hellenistic: { key: 'hellenistic', from: -333, to: -63 },
  'early roman': { key: 'early-roman', from: -63, to: 70 },
  'late roman': { key: 'late-roman', from: 70, to: 324 },
  roman: { key: 'roman', from: -63, to: 324 },
  byzantine: { key: 'byzantine', from: 324, to: 638 },
}

const CONVENTION: Readonly<Record<string, Atom>> = {
  hellenistic: { key: 'hellenistic', from: -323, to: -30 },
  roman: { key: 'roman', from: -30, to: 284 },
  'late roman': { key: 'late-roman', from: 284, to: ANTIQUITY_WINDOW_TO },
  byzantine: { key: 'byzantine', from: 395, to: ANTIQUITY_WINDOW_TO },
}

/** Canmore says "(roman)" and no years; England's vocabulary is borrowed for them, as a convention. */
const CANMORE_ROMAN: Atom = { key: 'roman', from: 43, to: 410 }

/** Sardinia PPR's Italian labels. Rome took the island from Carthage in 238 BCE. */
const SARDINIA: Readonly<Record<string, Atom>> = {
  punico: { key: 'punic', from: -750, to: -238 },
  'fenicio punico': { key: 'punic', from: -750, to: -238 },
  romano: { key: 'roman', from: -238, to: 476 },
}

/** Historic England's labels. Non-window periods are listed so a range's far end resolves. */
const AFTER_WINDOW = 'after-window'

const BRITAIN: Readonly<Record<string, Atom | null | typeof AFTER_WINDOW>> = {
  'early iron age': { key: 'early-iron-age', from: -800, to: -300 },
  'middle iron age': { key: 'middle-iron-age', from: -300, to: -100 },
  'late iron age': { key: 'late-iron-age', from: -100, to: 43 },
  'iron age': { key: 'iron-age', from: -800, to: 43 },
  'romano british': { key: 'romano-british', from: 43, to: 410 },
  roman: { key: 'romano-british', from: 43, to: 410 },
  // Out of the window on the near side. Resolved only so "Bronze Age to Romano British" parses.
  palaeolithic: null,
  mesolithic: null,
  neolithic: null,
  'early neolithic': null,
  'bronze age': null,
  'early bronze age': null,
  'late bronze age': null,
  // Begins where Roman ends (410, verified). As the far end of a range it only extends the span
  // to the window's edge; on its own it is not antiquity.
  'early medieval': AFTER_WINDOW,
  medieval: AFTER_WINDOW,
}

const clipToWindow = (from: number, to: number): { from: number; to: number } | null => {
  const clippedFrom = Math.max(from, ANTIQUITY_WINDOW_FROM)
  const clippedTo = Math.min(to, ANTIQUITY_WINDOW_TO)
  return clippedFrom <= clippedTo ? { from: clippedFrom, to: clippedTo } : null
}

const periodsFromAtoms = (atoms: Atom[], basis: SurveyPeriodBasis): SurveyPeriods | null => {
  if (atoms.length === 0) return null
  const span = clipToWindow(
    Math.min(...atoms.map((atom) => atom.from)),
    Math.max(...atoms.map((atom) => atom.to)),
  )
  if (!span) return null
  const keys = [...new Set(atoms.map((atom) => atom.key))]
  return { keys, ...span, basis }
}

const LEVANT_PATTERN = /\b(early roman|late roman|roman|hellenistic|byzantine)\b/gi
const CONVENTION_PATTERN = /\b(late roman|roman|hellenistic|byzantine)\b/gi

/**
 * Alternation lists the longer label first, so "Early Roman" is read as one atom and not as
 * "Roman". A compound such as "Late Roman-Byzantine" yields both atoms; the span is the first
 * atom's start to the last atom's end.
 */
const atomsInLabel = (
  label: string,
  pattern: RegExp,
  vocabulary: Readonly<Record<string, Atom>>,
): Atom[] => {
  const atoms: Atom[] = []
  for (const match of label.matchAll(pattern)) {
    const atom = vocabulary[match[1]!.toLowerCase()]
    if (atom) atoms.push(atom)
  }
  return atoms
}

/** The text between `opening` and the first `closing` after it, without a backtracking regex. */
const between = (note: string, opening: string, closing: RegExp | string): string | null => {
  const start = note.indexOf(opening)
  if (start === -1) return null
  const rest = note.slice(start + opening.length)
  const end = typeof closing === 'string' ? rest.indexOf(closing) : rest.search(closing)
  return end === -1 ? rest : rest.slice(0, end)
}

/** "Villages to Empires … periods A; B; Roman-Byzantine (-2500 to 638.0); Surveyed; …" */
export const readLevantSurveyPeriods = (note: string): SurveyPeriods | null => {
  const listed = between(note, '; periods ', / \(-?[\d.]+ to -?[\d.]+\);/)
  if (listed === null) return null
  const atoms = listed.split('; ').flatMap((label) => {
    const found = atomsInLabel(
      label.replace(/\bHasmonean Period\b/i, 'Hellenistic'),
      LEVANT_PATTERN,
      LEVANT,
    )
    const first = found[0]
    const last = found[found.length - 1]
    return first && last ? [{ key: first.key, from: first.from, to: last.to }, ...found] : []
  })
  return periodsFromAtoms(atoms, 'source-vocabulary')
}

/**
 * Gwiazda's `dated` field, one or several `;`-separated spans: "BCE 332-201", "BCE 63-700 CE",
 * "100–1 BCE", "401-750 CE", "321 CE", "not given". A trailing BCE puts both numbers before the
 * era; a leading BCE with a trailing CE spans it; a leading BCE alone puts both numbers BCE.
 * Both hyphen and en dash occur in the source.
 */
/** One `dated` item as `[from, to]`, or null for "not given" and anything unfamiliar. */
const gwiazdaYears = (item: string): [number, number] | null => {
  let rest = item.trim()
  const leadingBce = rest.startsWith('BCE ')
  if (leadingBce) rest = rest.slice(4)
  let era: 'BCE' | 'CE' | null = null
  if (rest.endsWith(' BCE')) era = 'BCE'
  else if (rest.endsWith(' CE')) era = 'CE'
  if (era) rest = rest.slice(0, rest.lastIndexOf(' '))

  const numbers = rest.split(/[-–]/).map(Number)
  const from = numbers[0]
  const to = numbers[1] ?? from
  const valid = numbers.length <= 2 && numbers.every((n) => Number.isInteger(n) && n >= 0)
  if (!valid || from === undefined || to === undefined) return null

  const firstNegative = leadingBce || era === 'BCE'
  const secondNegative = era === 'BCE' || (leadingBce && era !== 'CE')
  return [firstNegative ? -from : from, secondNegative ? -to : to]
}

export const readGwiazdaSurveyPeriods = (note: string): SurveyPeriods | null => {
  const dated = between(note, '; dated ', '; reference:')?.replace(/\.$/, '')
  if (!dated) return null

  const years = dated.split('; ').flatMap((item) => gwiazdaYears(item) ?? [])
  if (years.length === 0) return null

  const span = clipToWindow(Math.min(...years), Math.max(...years))
  if (!span) return null

  const keys = Object.values(LEVANT)
    .filter((atom) => atom.key !== 'roman' && atom.key !== 'early-roman')
    .filter((atom) => atom.from <= span.to && atom.to >= span.from)
    .map((atom) => atom.key)
  const roman = span.from < LEVANT.roman!.to && span.to > LEVANT.roman!.from
  return { keys: roman ? [...keys, 'roman'] : keys, ...span, basis: 'source-dates' }
}

/** "Marmarica … record PE_02011: harbor; period Late Bronze Age, Hellenistic, Roman, Late Roman; …" */
export const readMarmaricaSurveyPeriods = (note: string): SurveyPeriods | null => {
  const listed = between(note, '; period ', ';')
  if (listed === null) return null
  const atoms = listed
    .split(',')
    .flatMap((label) => atomsInLabel(label, CONVENTION_PATTERN, CONVENTION))
  return periodsFromAtoms(atoms, 'convention')
}

const britainAtom = (label: string): Atom | null | typeof AFTER_WINDOW | undefined =>
  BRITAIN[label.trim().toLowerCase().replace(/-/g, ' ')]

/**
 * "…: round (enclosed settlement); Early Iron Age to Romano British." The label is the last
 * `;`-separated clause. A record with none falls back to the title ("… Iron Age round, Romano
 * British"), which the HER writes for the same sites.
 */
export const readBritainSurveyPeriods = (note: string, name: string): SurveyPeriods | null => {
  const lastClause = note
    .slice(note.lastIndexOf(';') + 1)
    .trim()
    .replace(/\.$/, '')
  const ends = lastClause.split(' to ').map(britainAtom)
  const resolved = ends.filter(
    (end): end is Atom => end !== null && end !== undefined && end !== AFTER_WINDOW,
  )

  if (ends.every((end) => end !== undefined) && resolved.length > 0) {
    // A far end before the window opens the span at its edge; one after it closes it there.
    const first = ends[0]
    const last = ends[ends.length - 1]
    if (first === AFTER_WINDOW) return null
    const from = first ? first.from : ANTIQUITY_WINDOW_FROM
    const to = last === AFTER_WINDOW ? ANTIQUITY_WINDOW_TO : Math.max(...resolved.map((a) => a.to))
    const span = clipToWindow(from, to)
    if (!span) return null
    return {
      keys: [...new Set(resolved.map((atom) => atom.key))],
      ...span,
      basis: 'source-vocabulary',
    }
  }

  const atoms: Atom[] = []
  if (/romano[- ]british/i.test(name)) atoms.push(BRITAIN['romano british'] as Atom)
  if (/iron age/i.test(name)) atoms.push(BRITAIN['iron age'] as Atom)
  return periodsFromAtoms(atoms, 'source-vocabulary')
}

const CANMORE_FIND_WORDS = new Set([
  'coin',
  'coins',
  'pottery',
  'pot',
  'pots',
  'sherd',
  'sherds',
  'vessel',
  'vessels',
  'brooch',
  'glass',
  'hoard',
  'quern',
  'bead',
  'armlet',
  'bracelet',
  'find',
  'finds',
  'artefact',
  'artefacts',
  'fibula',
  'jar',
  'mortarium',
  'samian',
  'amphora',
  'lamp',
  'spindle',
])

const isCanmoreFind = (feature: string): boolean =>
  feature
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => CANMORE_FIND_WORDS.has(word))

/**
 * "Canmore 41106 (NS24SW 14.00): settlement (period unassigned), road (roman)(possible)."
 * A record is a list of components, each with its own period, and most Scottish ones are
 * prehistoric with a Roman coin or pot found in them ("Linlithgow Palace" has one). A Roman
 * *find* does not date the place, so only a Roman structure, road or fort counts.
 */
export const readCanmoreSurveyPeriods = (note: string): SurveyPeriods | null => {
  const body = between(note.slice(note.indexOf('Canmore ')), '): ', '\u0000') ?? ''
  const romanStructure = body.split(', ').some((component) => {
    const feature = component.slice(0, component.indexOf('(')).trim()
    const periods = [...component.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]!.toLowerCase())
    return periods.includes('roman') && !isCanmoreFind(feature)
  })
  return romanStructure ? periodsFromAtoms([CANMORE_ROMAN], 'convention') : null
}

/**
 * Historic England's scheduled monuments carry no period field in the survey; the title names it
 * ("Roman fort", "Romano-British enclosed settlement"). "Roman Catholic" is not a period.
 */
export const readHistoricEnglandSurveyPeriods = (name: string): SurveyPeriods | null => {
  const named = /\bromano[- ]british\b/i.test(name) || /\broman\b(?! catholic)/i.test(name)
  return named ? periodsFromAtoms([BRITAIN['romano british'] as Atom], 'source-vocabulary') : null
}

/** "…art. 143), dated nuragico - romano; recorded by …" */
export const readSardiniaSurveyPeriods = (note: string): SurveyPeriods | null => {
  const listed = between(note, ', dated ', /[;.]/)
  if (listed === null) return null
  const atoms = listed.split(' - ').flatMap((label) => SARDINIA[label.trim().toLowerCase()] ?? [])
  return periodsFromAtoms(atoms, 'convention')
}

/**
 * "…; periods: Early Bronze Age, Hellenistic, Roman. Point: …". The Atlas's one- and two-letter
 * abbreviations (H, HLL, Byz) are not read: its legend was not found, so they would be guessed at.
 */
export const readLuwianSurveyPeriods = (note: string): SurveyPeriods | null => {
  const listed = between(note, '; periods: ', '. Point:')
  if (listed === null) return null
  const atoms = listed
    .split(', ')
    .flatMap((label) => atomsInLabel(label, CONVENTION_PATTERN, CONVENTION))
  return periodsFromAtoms(atoms, 'convention')
}

export const detectSurveySource = (record: SurveyRecord): SurveySiteSource | null => {
  const { note } = record
  if (note.startsWith('Villages to Empires, South Levant sites')) return 'villages-to-empires'
  if (/\bCornwall HER MCO\d+/.test(note)) return 'cornwall-her'
  if (note.startsWith('Gwiazda (2020)')) return 'gwiazda-chamber-tombs'
  if (note.startsWith('Marmarica (')) return 'marmarica'
  if (/\bCanmore \d+ \(/.test(note)) return 'canmore'
  if (note.startsWith('Historic England, scheduled monument')) return 'historic-england'
  if (note.startsWith('Sardinia, Piano Paesaggistico')) return 'sardinia-ppr'
  if (note.startsWith('LuwianSiteAtlas site')) return 'luwian-studies'
  return null
}

/**
 * Survey labels that name a map reference, not a place: spot-height points ("Elevation Point 577"),
 * placeholders and bare numbers. The record is a real find; the label is not worth a pin's name.
 */
export const isGenericSurveyLabel = (name: string): boolean => {
  const trimmed = name.trim()
  if (trimmed === '' || /^[\d\s[\]().,#/-]+$/.test(trimmed)) return true
  if (/^elevation point\b/i.test(trimmed)) return true
  if (/^(unnamed|unknown|no name|n\/?a|false)$/i.test(trimmed)) return true
  return /^(site|spot height|point|survey site|ruin|ruins|tell|khirbet|khirbeh|kh\.|horbat|hirbet)\s*#?\d+[a-z]?$/i.test(
    trimmed,
  )
}

/** The survey's running index in square brackets ("Wadi Inzar [8] 1") is not part of the name. */
export const cleanSurveyName = (name: string): string =>
  name
    .replace(/\[\d+\]/g, ' ')
    .split(' ')
    .filter((word) => word !== '')
    .join(' ')

const KIND_RULES: ReadonlyArray<readonly [RegExp, SurveySiteKind]> = [
  [/enclosed settlement|\bround\b/i, 'enclosed-settlement'],
  [/hut circle/i, 'hut-circle'],
  [/courtyard house/i, 'courtyard-house'],
  [/fogou/i, 'fogou'],
  [/hillfort|cliff castle/i, 'hillfort'],
  [/\b(fort|fortified|fortress|fortification)\b/i, 'fortification'],
  [/\b(tomb|burial|necropolis|cemetery|barrow|grave|cist)\b/i, 'burial'],
  [/\b(harbou?r|port)\b/i, 'harbour'],
  [/\b(settlement|village|town|city|tell|mound)\b/i, 'settlement'],
  [/\b(building|house|structure|farm|villa|temple|church)\b/i, 'building'],
]

export const surveyKindOf = (typeInSource: string): SurveySiteKind =>
  KIND_RULES.find(([pattern]) => pattern.test(typeInSource))?.[1] ?? 'site'

const EVIDENCE_RULES: ReadonlyArray<readonly [RegExp, SurveyEvidence]> = [
  [/rests on cropmarks/i, 'cropmarks'],
  [/rests on documents/i, 'documents'],
  [/rests on place names/i, 'place-names'],
  [/rests on a demolished structure/i, 'demolished-structure'],
]

const periodsOf = (source: SurveySiteSource, record: SurveyRecord): SurveyPeriods | null => {
  if (source === 'villages-to-empires') return readLevantSurveyPeriods(record.note)
  if (source === 'gwiazda-chamber-tombs') return readGwiazdaSurveyPeriods(record.note)
  if (source === 'marmarica') return readMarmaricaSurveyPeriods(record.note)
  if (source === 'canmore') return readCanmoreSurveyPeriods(record.note)
  if (source === 'historic-england') return readHistoricEnglandSurveyPeriods(record.name)
  if (source === 'sardinia-ppr') return readSardiniaSurveyPeriods(record.note)
  if (source === 'luwian-studies') return readLuwianSurveyPeriods(record.note)
  return readBritainSurveyPeriods(record.note, record.name)
}

export type SurveySkipReason = 'unsupported-source' | 'vici' | 'generic-label' | 'no-period'

export const readSurveyRecord = (
  record: SurveyRecord,
): { site: SurveySite } | { skipped: SurveySkipReason } => {
  if (/Vici\.org/.test(record.sources) || /^Vici\.org place \d+/.test(record.note)) {
    return { skipped: 'vici' }
  }
  const source = detectSurveySource(record)
  if (!source) return { skipped: 'unsupported-source' }

  const name = cleanSurveyName(record.name)
  if (isGenericSurveyLabel(name)) return { skipped: 'generic-label' }

  const periods = periodsOf(source, record)
  if (!periods) return { skipped: 'no-period' }
  // The HER's Iron-Age-only and prehistoric records are a different layer's business.
  if (source === 'cornwall-her' && !periods.keys.includes('romano-british')) {
    return { skipped: 'no-period' }
  }

  return {
    site: {
      surveyId: record.surveyId,
      source,
      name,
      kind: surveyKindOf(record.typeInSource),
      periods,
      destroyed: /Destroyed or known from records/i.test(record.note),
      uncertain: /Uncertain in the register/i.test(record.note),
      evidence: EVIDENCE_RULES.find(([pattern]) => pattern.test(record.note))?.[1] ?? null,
      lat: record.lat,
      lon: record.lon,
    },
  }
}
