import { describe, expect, it } from 'vitest'
import {
  assessImportDelta,
  checksumOfSource,
  isDryRun,
  type ImportDeltaInput,
  type ImportRunRecord,
} from '../guard'

/**
 * The tripwire between twenty-four third-party sources and the atlas.
 *
 * Every case below is a way an upstream can go wrong while still returning
 * HTTP 200 and parsing cleanly — which is the only way this class of failure
 * ever presents, and why none of it was catchable before.
 */

const previous = (overrides: Partial<ImportRunRecord> = {}): ImportRunRecord => ({
  rowCount: 1000,
  checksum: 'a'.repeat(64),
  ...overrides,
})

const assess = (overrides: Partial<ImportDeltaInput> = {}) =>
  assessImportDelta({
    source: 'geonames:cities500',
    previous: previous(),
    incoming: { rowCount: 1000, checksum: 'a'.repeat(64) },
    ...overrides,
  })

describe('assessImportDelta', () => {
  it('accepts a first run, since there is nothing to compare against', () => {
    const verdict = assess({ previous: null, incoming: { rowCount: 42, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: true, note: 'first-run' })
  })

  it('recognises a byte-identical re-run', () => {
    expect(assess()).toMatchObject({ proceed: true, note: 'identical' })
  })

  it('accepts ordinary growth', () => {
    const verdict = assess({ incoming: { rowCount: 1200, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: true, note: 'within-tolerance' })
  })

  it('accepts a small correction downwards', () => {
    const verdict = assess({ incoming: { rowCount: 960, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: true, note: 'within-tolerance' })
  })

  /**
   * The quiet case. Identical row counts with different bytes is what an
   * upstream correcting a field looks like — and equally what a substituted
   * dataset looks like. Nothing here can tell them apart, so it proceeds and
   * says so rather than pretending to a judgement it cannot make.
   */
  it('proceeds but flags a same-size source whose content changed', () => {
    const verdict = assess({ incoming: { rowCount: 1000, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: true, note: 'content-changed' })
  })

  /**
   * The failure this exists for: a truncated download or an upstream that
   * changed its response shape so the parser now recognises a fraction of it.
   * Both import cleanly and leave the map quietly wrong.
   */
  it('refuses an implausible shrink', () => {
    const verdict = assess({ incoming: { rowCount: 120, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: false, refusal: 'implausible-shrink' })
  })

  it('refuses growth that suggests a parser splitting records', () => {
    const verdict = assess({ incoming: { rowCount: 9000, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: false, refusal: 'implausible-growth' })
  })

  /**
   * Checked before any comparison, because it is wrong on its own terms: no
   * source legitimately publishes nothing, so zero means the fetch failed in a
   * way that looked like success. Letting it through would also write a zero
   * baseline, against which every later run looks like enormous growth.
   */
  it('refuses an empty source even on a first run, rather than recording a zero baseline', () => {
    const verdict = assess({ previous: null, incoming: { rowCount: 0, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: false, refusal: 'empty-source' })
  })

  it('treats a negative count as empty rather than trusting it', () => {
    const verdict = assess({ incoming: { rowCount: -5, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: false, refusal: 'empty-source' })
  })

  it('sits exactly on the shrink floor without refusing', () => {
    // 10% of 1000 → floor 900; 900 is not below it.
    const verdict = assess({ incoming: { rowCount: 900, checksum: 'b'.repeat(64) } })

    expect(verdict).toMatchObject({ proceed: true })
  })

  it('honours a tolerance widened on purpose for a source known to fluctuate', () => {
    const verdict = assess({
      incoming: { rowCount: 500, checksum: 'b'.repeat(64) },
      tolerance: { maximumShrinkFraction: 0.6, maximumGrowthFactor: 3 },
    })

    expect(verdict).toMatchObject({ proceed: true })
  })

  it('names the source in every summary, so a failed run says which one', () => {
    const verdict = assess({
      source: 'edh:inscriptions',
      incoming: { rowCount: 1, checksum: 'b'.repeat(64) },
    })

    expect(verdict.summary).toContain('edh:inscriptions')
  })
})

describe('checksumOfSource', () => {
  it('is stable for identical bytes', () => {
    expect(checksumOfSource('abc')).toBe(checksumOfSource(Buffer.from('abc')))
  })

  it('changes when a single byte changes', () => {
    expect(checksumOfSource('abc')).not.toBe(checksumOfSource('abd'))
  })

  it('is a 64-character hex digest, matching the column width', () => {
    expect(checksumOfSource('abc')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('isDryRun', () => {
  it('detects the flag anywhere in the arguments', () => {
    expect(isDryRun(['node', 'script.ts', '--dry-run'])).toBe(true)
  })

  it('is absent by default', () => {
    expect(isDryRun(['node', 'script.ts'])).toBe(false)
  })

  it('does not match a partial flag', () => {
    expect(isDryRun(['node', 'script.ts', '--dry-run-please'])).toBe(false)
  })
})
