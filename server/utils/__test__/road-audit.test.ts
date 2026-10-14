import { describe, expect, it } from 'vitest'
import {
  buildRoadAuditGapsCsv,
  buildRoadAuditSegmentsCsv,
  escapeCsvField,
  type RoadAuditGapRow,
  type RoadAuditSegmentRow,
} from '../road-audit'

const segment = (overrides: Partial<RoadAuditSegmentRow> = {}): RoadAuditSegmentRow => ({
  roadId: 1,
  name: 'Via Aurelia',
  certainty: 'conjectured',
  itinerary: null,
  lengthMetres: 4000,
  longitude: 11.123456,
  latitude: 43.654321,
  edhMilestones: 0,
  viciMilestones: 0,
  viciRoadSites: 0,
  certainEnds: 0,
  steepestGradientPercent: 3.14159,
  terrainCoverage: 1,
  ...overrides,
})

const dataRows = (csv: string): string[] =>
  csv
    .split('\r\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .slice(1)

describe('escapeCsvField', () => {
  it('quotes a comma, a quote and a newline, and doubles the quote', () => {
    expect(escapeCsvField('a, b')).toBe('"a, b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField('one\ntwo')).toBe('"one\ntwo"')
  })

  it('defuses a text that a spreadsheet would run as a formula', () => {
    expect(escapeCsvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(escapeCsvField('@sum')).toBe("'@sum")
  })

  it('leaves a negative number alone — it is not text', () => {
    expect(escapeCsvField(-4)).toBe('-4')
  })

  it('writes null as an empty field', () => {
    expect(escapeCsvField(null)).toBe('')
  })
})

describe('buildRoadAuditSegmentsCsv', () => {
  it('states what the numbers are before the data', () => {
    const csv = buildRoadAuditSegmentsCsv([segment()])
    expect(csv.startsWith('# Evidence beside each conjectured')).toBe(true)
    expect(csv).toContain("Itiner-e's own classification is unchanged")
  })

  it('ranks a road with nothing beside it ahead of one with a milestone', () => {
    const csv = buildRoadAuditSegmentsCsv([
      segment({ roadId: 7, name: 'with', edhMilestones: 2 }),
      segment({ roadId: 9, name: 'without' }),
    ])
    const rows = dataRows(csv)
    expect(rows[0]).toMatch(/^1,9,without,/)
    expect(rows[1]).toMatch(/^2,7,with,/)
  })

  it('rounds coordinates and the gradient, and leaves an unread gradient empty', () => {
    const rows = dataRows(
      buildRoadAuditSegmentsCsv([
        segment({ roadId: 1 }),
        segment({ roadId: 2, steepestGradientPercent: null, terrainCoverage: null }),
      ]),
    )
    expect(rows[0]).toContain('11.12346,43.65432')
    expect(rows[0]).toContain(',3.1,1,')
    expect(rows[1]).toMatch(/,,,false,false$/)
  })

  it('marks the steep stretch and the road with a find', () => {
    const [row] = dataRows(
      buildRoadAuditSegmentsCsv([
        segment({ viciMilestones: 1, steepestGradientPercent: 40, terrainCoverage: 0.9 }),
      ]),
    )
    expect(row).toMatch(/,true,true$/)
  })
})

describe('buildRoadAuditGapsCsv', () => {
  const gap = (overrides: Partial<RoadAuditGapRow> = {}): RoadAuditGapRow => ({
    source: 'edh',
    sourceKey: 'HD000001',
    title: 'Milestone',
    longitude: 1,
    latitude: 2,
    nearestRoadMetres: 1500,
    ...overrides,
  })

  it('lists the farthest first, and a stone with no road in reach before any', () => {
    const rows = dataRows(
      buildRoadAuditGapsCsv([
        gap({ sourceKey: 'near', nearestRoadMetres: 1200 }),
        gap({ sourceKey: 'none', nearestRoadMetres: null }),
        gap({ sourceKey: 'far', nearestRoadMetres: 9000 }),
      ]),
    )
    expect(rows.map((row) => row.split(',')[1])).toEqual(['none', 'far', 'near'])
  })

  it('warns that a findspot is not necessarily the road', () => {
    expect(buildRoadAuditGapsCsv([gap()])).toContain('carried or re-used')
  })
})
