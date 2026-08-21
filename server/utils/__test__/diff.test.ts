import { describe, expect, it } from 'vitest'
import {
  diffPayloads,
  isBlankingEdit,
  isSubstantialEdit,
  measureChangeWeight,
  SUBSTANTIAL_CHANGE_WEIGHT,
} from '../diff'

describe('diffPayloads', () => {
  it('reports only the fields that actually differ', () => {
    const changes = diffPayloads(
      { title: 'Fectio', category: 'fortification', summary: 'A fort' },
      { title: 'Fectio', category: 'fortification', summary: 'An auxiliary fort' },
    )
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'summary', kind: 'changed' })
  })

  it('classifies additions and removals distinctly from changes', () => {
    const changes = diffPayloads(
      { title: 'Fectio', summary: 'A fort' },
      { title: 'Fectio', summary: null, description: 'New text' },
    )
    const byField = Object.fromEntries(changes.map((change) => [change.field, change.kind]))
    expect(byField.summary).toBe('removed')
    expect(byField.description).toBe('added')
  })

  it('treats an empty string as absent rather than as a value', () => {
    expect(diffPayloads({ summary: '' }, { summary: null })).toHaveLength(0)
  })

  it('handles a first revision with nothing before it', () => {
    const changes = diffPayloads(null, { title: 'Fectio' })
    expect(changes).toEqual([{ field: 'title', kind: 'added', before: null, after: 'Fectio' }])
  })

  it('ignores structural fields that carry no editorial meaning', () => {
    expect(diffPayloads({ kind: 'site' }, { kind: 'tracing' })).toHaveLength(0)
  })

  it('compares nested values by their serialised form', () => {
    const changes = diffPayloads(
      { position: { lon: 5.1, lat: 52.0 } },
      { position: { lon: 5.2, lat: 52.0 } },
    )
    expect(changes).toHaveLength(1)
  })

  it('returns fields in a stable order regardless of key order', () => {
    const first = diffPayloads({ b: 1, a: 1 }, { b: 2, a: 2 }).map((c) => c.field)
    const second = diffPayloads({ a: 1, b: 1 }, { a: 2, b: 2 }).map((c) => c.field)
    expect(first).toEqual(second)
  })
})

describe('measureChangeWeight', () => {
  it('weighs a long rewrite above a short correction', () => {
    const correction = diffPayloads({ periodFrom: -27 }, { periodFrom: -25 })
    const rewrite = diffPayloads({ description: 'x' }, { description: 'y'.repeat(2000) })
    expect(measureChangeWeight(rewrite)).toBeGreaterThan(measureChangeWeight(correction))
  })

  it('flags edits above the threshold as substantial', () => {
    const rewrite = diffPayloads(
      { description: 'a' },
      { description: 'b'.repeat(SUBSTANTIAL_CHANGE_WEIGHT) },
    )
    expect(isSubstantialEdit(rewrite)).toBe(true)
    expect(isSubstantialEdit(diffPayloads({ title: 'a' }, { title: 'ab' }))).toBe(false)
  })
})

describe('isBlankingEdit', () => {
  it('catches an edit that empties fields without replacing them', () => {
    const changes = diffPayloads(
      { title: 'Fectio', summary: 'A fort', description: 'Long text' },
      { title: 'Fectio', summary: null, description: null },
    )
    expect(isBlankingEdit(changes)).toBe(true)
  })

  it('does not flag a normal rewrite', () => {
    const changes = diffPayloads(
      { summary: 'A fort', description: 'Long text' },
      { summary: 'An auxiliary fort', description: 'Longer text' },
    )
    expect(isBlankingEdit(changes)).toBe(false)
  })

  it('does not flag an edit that adds without removing', () => {
    expect(isBlankingEdit(diffPayloads({ title: 'a' }, { title: 'a', summary: 'new' }))).toBe(false)
  })
})
