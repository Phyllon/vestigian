import { describe, expect, it } from 'vitest'
import { buildSurveySiteFeatureCollection, type SurveySiteFeedRow } from '../survey-sites-feed'

const row = (overrides: Partial<SurveySiteFeedRow> = {}): SurveySiteFeedRow => ({
  survey_id: 'MS-004712',
  name: 'CHYTODDEN - Iron Age round, Romano British',
  source: 'cornwall-her',
  kind: 'enclosed-settlement',
  period_keys: ['early-iron-age', 'romano-british'],
  period_from: -800,
  period_to: 410,
  period_basis: 'source-vocabulary',
  destroyed: true,
  uncertain: true,
  evidence: 'documents',
  lon: -5.1,
  lat: 50.3,
  ...overrides,
})

describe('buildSurveySiteFeatureCollection', () => {
  it('states the collection licence and credit, and the Survey it came through', () => {
    const collection = buildSurveySiteFeatureCollection([row()])
    expect(collection.licence).toBe('ODbL 1.0')
    expect(collection.attribution).toContain(
      'Ancient Sites and Monuments Survey (Jensine Andresen)',
    )
    expect(collection.survey).toMatchObject({ url: 'https://survey.jensineandresen.com' })
  })

  it("puts each row's own upstream source and licence on its feature", () => {
    const [feature] = buildSurveySiteFeatureCollection([
      row({ source: 'villages-to-empires', kind: 'settlement' }),
    ]).features as Array<{ properties: Record<string, unknown> }>
    expect(feature!.properties).toMatchObject({
      source: 'villages-to-empires',
      sourceLicence: 'CC BY 4.0',
      licence: 'ODbL 1.0',
    })
  })

  it('keeps destroyed and uncertain records, and keys a feature by the Survey id', () => {
    const [feature] = buildSurveySiteFeatureCollection([row()]).features as Array<{
      id: string
      geometry: { coordinates: number[] }
      properties: Record<string, unknown>
    }>
    expect(feature!.id).toBe('MS-004712')
    expect(feature!.geometry.coordinates).toEqual([-5.1, 50.3])
    expect(feature!.properties).toMatchObject({
      destroyed: true,
      uncertain: true,
      evidence: 'documents',
    })
  })
})
