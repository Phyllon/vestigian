import { describe, expect, it } from 'vitest'
import {
  cleanSurveyName,
  isGenericSurveyLabel,
  readBritainSurveyPeriods,
  readCanmoreSurveyPeriods,
  readHistoricEnglandSurveyPeriods,
  readLuwianSurveyPeriods,
  readSardiniaSurveyPeriods,
  readGwiazdaSurveyPeriods,
  readLevantSurveyPeriods,
  readMarmaricaSurveyPeriods,
  readSurveyRecord,
  surveyKindOf,
  type SurveyRecord,
} from '../survey-sites'

const record = (overrides: Partial<SurveyRecord>): SurveyRecord => ({
  surveyId: 'MS-000001',
  name: 'Khirbet Test',
  typeInSource: 'settlement (Villages to Empires)',
  note: '',
  sources: '',
  lat: 32,
  lon: 35,
  ...overrides,
})

const LEVANT_NOTE = (periods: string): string =>
  `Villages to Empires, South Levant sites (University of Turin 2025, Zenodo 17285091, CC BY 4.0): site 4204, Judah; Settlement; periods ${periods} (-2500 to 638.0); Surveyed; source Dagan 2013.`

describe('readLevantSurveyPeriods', () => {
  it('keeps only the Hellenistic-to-Byzantine part of a multi-period site', () => {
    const periods = readLevantSurveyPeriods(
      LEVANT_NOTE(
        'Early Bronze Age IV/Middle Bronze Age I/Int. Bronze; Iron Age II; Roman-Byzantine',
      ),
    )
    expect(periods).toMatchObject({ from: -63, to: 638, basis: 'source-vocabulary' })
    expect(periods?.keys).toEqual(['roman', 'byzantine'])
  })

  it('reads "Early Roman" as one period, not as "Roman"', () => {
    const periods = readLevantSurveyPeriods(LEVANT_NOTE('Hellenistic; Early Roman'))
    expect(periods).toMatchObject({ from: -333, to: 70 })
    expect(periods?.keys).toEqual(['hellenistic', 'early-roman'])
  })

  it('reads a compound label as a span from its first period to its last', () => {
    expect(readLevantSurveyPeriods(LEVANT_NOTE('Late Roman-Byzantine'))).toMatchObject({
      from: 70,
      to: 638,
    })
  })

  it('has nothing to say about a site with no period in the window', () => {
    expect(readLevantSurveyPeriods(LEVANT_NOTE('Iron Age II; Iron Age III (Persian)'))).toBeNull()
  })
})

describe('readGwiazdaSurveyPeriods', () => {
  const dated = (value: string): string =>
    `Gwiazda (2020), Syro-Palestinian chamber tombs (CC BY 4.0): no. 1, Israel; dated ${value}; reference: X.`

  it('reads BCE ranges, mixed ranges and single CE years', () => {
    expect(readGwiazdaSurveyPeriods(dated('BCE 332-201'))).toMatchObject({ from: -332, to: -201 })
    expect(readGwiazdaSurveyPeriods(dated('BCE 63-700 CE'))).toMatchObject({ from: -63, to: 640 })
    expect(readGwiazdaSurveyPeriods(dated('321 CE'))).toMatchObject({ from: 321, to: 321 })
  })

  it('reads an en dash, a trailing BCE and several spans for tombs sharing a point', () => {
    expect(
      readGwiazdaSurveyPeriods(dated('100–1 BCE; BCE 100–100 CE; BCE 100–300 CE')),
    ).toMatchObject({ from: -100, to: 300 })
    expect(readGwiazdaSurveyPeriods(dated('BCE 1000-901'))).toBeNull()
  })

  it('declines "not given"', () => {
    expect(readGwiazdaSurveyPeriods(dated('not given'))).toBeNull()
  })
})

describe('readMarmaricaSurveyPeriods', () => {
  it('marks its numbers as a convention, not as sourced', () => {
    const periods = readMarmaricaSurveyPeriods(
      'Marmarica (NE Libya and NW Egypt) record PE_02011: harbor; period Late Bronze Age, Hellenistic, Roman, Late Roman; location accuracy high;',
    )
    expect(periods).toMatchObject({ basis: 'convention', from: -323, to: 640 })
  })
})

describe('readBritainSurveyPeriods', () => {
  const cornwall = (label: string): string =>
    `Cornwall HER MCO7777: round (enclosed settlement); ${label}.`

  it('reads Historic England period ranges', () => {
    expect(
      readBritainSurveyPeriods(cornwall('Early Iron Age to Romano British'), ''),
    ).toMatchObject({
      from: -800,
      to: 410,
      keys: ['early-iron-age', 'romano-british'],
    })
  })

  it('opens at the window edge when the range starts before it', () => {
    expect(readBritainSurveyPeriods(cornwall('Palaeolithic to Romano British'), '')).toMatchObject({
      from: -800,
      to: 410,
      keys: ['romano-british'],
    })
  })

  it('clips a range that runs on past the window', () => {
    expect(
      readBritainSurveyPeriods(cornwall('Romano British to Early Medieval'), ''),
    ).toMatchObject({
      from: 43,
      to: 640,
    })
  })

  it('does not call an Early-Medieval-only record antiquity', () => {
    expect(readBritainSurveyPeriods(cornwall('Early Medieval'), '')).toBeNull()
  })

  it('falls back to the title when the record carries no period clause', () => {
    expect(
      readBritainSurveyPeriods('Cornwall HER MCO1: fogou', 'CARN - Iron Age round, Romano British'),
    ).toMatchObject({ keys: ['romano-british', 'iron-age'] })
  })
})

describe('isGenericSurveyLabel / cleanSurveyName', () => {
  it('drops spot-height and placeholder labels but not real names', () => {
    expect(isGenericSurveyLabel('Elevation Point 577')).toBe(true)
    expect(isGenericSurveyLabel('Elevation Point 708 (South)')).toBe(true)
    expect(isGenericSurveyLabel('-')).toBe(true)
    expect(isGenericSurveyLabel('[32]')).toBe(true)
    expect(isGenericSurveyLabel('Khirbet 12')).toBe(true)
    expect(isGenericSurveyLabel('Khirbet et-Tell')).toBe(false)
    expect(isGenericSurveyLabel('Wadi Inzar')).toBe(false)
  })

  it("removes the survey's bracketed running index", () => {
    expect(cleanSurveyName('Wadi Inzar [8] 1')).toBe('Wadi Inzar 1')
  })
})

describe('surveyKindOf', () => {
  it('names the Cornwall HER types the survey files under "Hillfort"', () => {
    expect(surveyKindOf('round (enclosed settlement)')).toBe('enclosed-settlement')
    expect(surveyKindOf('hut circle (stone house foundation)')).toBe('hut-circle')
    expect(surveyKindOf('hillfort')).toBe('hillfort')
  })

  it('does not read "Villages" as a villa, nor a fortified settlement as a hillfort', () => {
    expect(surveyKindOf('settlement (Villages to Empires)')).toBe('settlement')
    expect(surveyKindOf('fortified settlement (Villages to Empires)')).toBe('fortification')
  })
})

describe('readSurveyRecord', () => {
  it('leaves out vici.org data', () => {
    const result = readSurveyRecord(
      record({
        note: 'Vici.org place 64413 (industry; 199 BC to later): Roman farm.',
        sources: 'Vici.org, archaeological atlas of antiquity',
      }),
    )
    expect(result).toEqual({ skipped: 'vici' })
  })

  it('leaves out a bibliography that merely mentions Rome', () => {
    const result = readSurveyRecord(
      record({
        note: 'Site known only to within a few square kilometers in the atlas. References: Journal of Roman Archaeology 19. Kwok and Peters 2020, CC0.',
      }),
    )
    expect(result).toEqual({ skipped: 'unsupported-source' })
  })

  it('keeps a destroyed and uncertain record, and says so', () => {
    const result = readSurveyRecord(
      record({
        name: 'CHYTODDEN - Iron Age round, Romano British',
        typeInSource: 'round (enclosed settlement)',
        note: 'Destroyed or known from records: the record rests on cropmarks (levelled, seen from the air). Uncertain in the register: the HER marks this type with a question mark. Cornwall HER MCO7861: round (enclosed settlement); Early Iron Age to Romano British.',
      }),
    )
    expect(result).toMatchObject({
      site: { source: 'cornwall-her', destroyed: true, uncertain: true, evidence: 'cropmarks' },
    })
  })

  it('leaves out a Cornwall record that is Iron Age without being Romano-British', () => {
    const result = readSurveyRecord(
      record({
        name: 'TREWEN - Iron Age round',
        typeInSource: 'round (enclosed settlement)',
        note: 'Cornwall HER MCO5: round (enclosed settlement); Early Iron Age.',
      }),
    )
    expect(result).toEqual({ skipped: 'no-period' })
  })

  it('skips a spot-height label', () => {
    expect(
      readSurveyRecord(record({ name: 'Elevation Point 577', note: LEVANT_NOTE('Roman') })),
    ).toEqual({
      skipped: 'generic-label',
    })
  })
})

describe("the sources added after the Survey's credits page was read", () => {
  it('reads a Roman component out of a Canmore record and ignores unassigned ones', () => {
    expect(
      readCanmoreSurveyPeriods(
        'Canmore 41106 (NS24SW 14.00): settlement (period unassigned), fort (roman).',
      ),
    ).toMatchObject({ keys: ['roman'], from: 43, to: 410, basis: 'convention' })
    // A Roman coin in a medieval palace does not make the palace Roman.
    expect(
      readCanmoreSurveyPeriods('Canmore 1 (NS97NE 1.00): PALACE (MEDIEVAL), COIN (ROMAN).'),
    ).toBeNull()
    expect(
      readCanmoreSurveyPeriods('Canmore 87471 (NJ23SE 11.00): building(s) (period unassigned).'),
    ).toBeNull()
  })

  it('reads the period out of a scheduled monument\'s title, and not "Roman Catholic"', () => {
    expect(readHistoricEnglandSurveyPeriods('Hardknott Roman fort, bath-house')).toMatchObject({
      keys: ['romano-british'],
    })
    expect(
      readHistoricEnglandSurveyPeriods('Skirsgill Romano-British enclosed settlement'),
    ).not.toBeNull()
    expect(readHistoricEnglandSurveyPeriods('Roman Catholic chapel ruins')).toBeNull()
    expect(readHistoricEnglandSurveyPeriods('Motte and bailey castle')).toBeNull()
  })

  it("reads Sardinia's Italian labels, and has nothing for a purely Nuragic record", () => {
    const note = (dated: string): string =>
      `Sardinia, Piano Paesaggistico Regionale (2006), repertorio of landscape heritage (art. 143), dated ${dated}; recorded by the Region.`
    expect(readSardiniaSurveyPeriods(note('nuragico - romano'))).toMatchObject({
      keys: ['roman'],
      from: -238,
      to: 476,
    })
    expect(readSardiniaSurveyPeriods(note('fenicio punico'))?.keys).toEqual(['punic'])
    expect(readSardiniaSurveyPeriods(note('nuragico - prenuragico'))).toBeNull()
  })

  it('reads spelt-out Luwian periods and ignores its abbreviations', () => {
    const note = (periods: string): string =>
      `LuwianSiteAtlas site 1 (Luwian Studies); recorded as: settlement; periods: ${periods}. Point: the atlas's approximate site center.`
    expect(readLuwianSurveyPeriods(note('Late Bronze Age, Hellenistic, Roman'))?.keys).toEqual([
      'hellenistic',
      'roman',
    ])
    expect(readLuwianSurveyPeriods(note('EBA 2-3, HLL, Byz'))).toBeNull()
  })
})
