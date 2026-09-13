import { describe, expect, it } from 'vitest'
import {
  buildRetractionPayload,
  geometryKindFor,
  planRevert,
  planRevisionWrite,
  shouldCountTowardsTrust,
  type RevertTarget,
} from '../revisions'

/**
 * The governance model's load-bearing decisions, asserted directly.
 *
 * `applyRevision()` is the only place this application writes a live row, and
 * until this file existed none of what it decides was covered — the rules were
 * reachable only through a transaction, a PostGIS geometry and three call
 * sites, which is precisely why they went untested for as long as they did.
 * What is asserted below is the part that would still be wrong if every query
 * in that file were perfect.
 */

const sitePayload = (overrides: Record<string, unknown> = {}) =>
  ({
    kind: 'site' as const,
    title: 'Castra Vetera',
    category: 'fortification',
    position: { lon: 6.45, lat: 51.66 },
    periodFrom: -12,
    periodTo: 70,
    ...overrides,
  }) as Parameters<typeof planRevisionWrite>[0]['payload']

describe('planRevisionWrite', () => {
  it('inserts when neither the row nor the payload names a record', () => {
    const plan = planRevisionWrite({ entityId: null, payload: sitePayload() })

    expect(plan).toEqual({ action: 'insert', kind: 'site' })
  })

  it('updates the record the payload names when the row has not been reconciled yet', () => {
    const plan = planRevisionWrite({ entityId: null, payload: sitePayload({ entityId: 42 }) })

    expect(plan).toEqual({ action: 'update', kind: 'site', targetId: 42 })
  })

  /**
   * `revisions.entity_id` is written by `applyRevision` itself once a create has
   * produced a real row; `payload.entityId` is whatever the submitting client
   * sent. Where they disagree the column is the one already reconciled against
   * a row that exists, so it has to win — the alternative is letting a request
   * body redirect a write at a record nobody reviewed.
   */
  it('lets the row’s entity_id outrank the payload’s when they disagree', () => {
    const plan = planRevisionWrite({ entityId: 7, payload: sitePayload({ entityId: 42 }) })

    expect(plan).toEqual({ action: 'update', kind: 'site', targetId: 7 })
  })

  it('retracts rather than edits when the payload carries the flag', () => {
    const plan = planRevisionWrite({
      entityId: 7,
      payload: sitePayload({ retracted: true }),
    })

    expect(plan).toEqual({ action: 'retract', kind: 'site', targetId: 7 })
  })

  /**
   * The hole this extraction closed. A retraction payload with no resolvable
   * target used to fall past the retraction branch into the insert path, so
   * instead of failing it would have *published a new record* built out of the
   * retraction — credited to the moderator who pressed the button, on an atlas
   * where taking something down is supposed to be the one thing that happened.
   */
  it('refuses a retraction that does not identify a record, rather than inserting one', () => {
    const plan = planRevisionWrite({
      entityId: null,
      payload: sitePayload({ retracted: true }),
    })

    expect(plan).toEqual({ action: 'refuse', reason: 'retraction-without-target' })
  })

  it('treats an explicit `retracted: false` as an ordinary edit', () => {
    const plan = planRevisionWrite({
      entityId: 7,
      payload: sitePayload({ retracted: false }),
    })

    expect(plan).toEqual({ action: 'update', kind: 'site', targetId: 7 })
  })

  it('carries the payload kind through, so a tracing is never written as a site', () => {
    const plan = planRevisionWrite({
      entityId: 3,
      payload: {
        kind: 'tracing',
        title: 'Via Belgica',
        category: 'infrastructure',
        geometry: { type: 'LineString', coordinates: [] },
      } as Parameters<typeof planRevisionWrite>[0]['payload'],
    })

    expect(plan).toEqual({ action: 'update', kind: 'tracing', targetId: 3 })
  })
})

describe('shouldCountTowardsTrust', () => {
  it('credits an ordinary site contribution', () => {
    expect(
      shouldCountTowardsTrust({ authorId: 5, revertsRevisionId: null, entityType: 'site' }),
    ).toBe(true)
  })

  it('credits a tracing too', () => {
    expect(
      shouldCountTowardsTrust({ authorId: 5, revertsRevisionId: null, entityType: 'tracing' }),
    ).toBe(true)
  })

  /**
   * Reverting is moderator housekeeping. Counting it would let a moderator
   * reach the automatic-publishing threshold by undoing other people's work,
   * which is the opposite of the signal the threshold is meant to measure.
   */
  it('never credits a revert, however it was authored', () => {
    expect(
      shouldCountTowardsTrust({ authorId: 5, revertsRevisionId: 88, entityType: 'site' }),
    ).toBe(false)
  })

  /** Uploading two photographs is a weaker signal than two records surviving review. */
  it('never credits a photograph', () => {
    expect(
      shouldCountTowardsTrust({ authorId: 5, revertsRevisionId: null, entityType: 'image' }),
    ).toBe(false)
  })

  it('credits nobody when the author is gone', () => {
    expect(
      shouldCountTowardsTrust({ authorId: null, revertsRevisionId: null, entityType: 'site' }),
    ).toBe(false)
  })
})

describe('planRevert', () => {
  const target = (overrides: Partial<RevertTarget> = {}): RevertTarget => ({
    entityType: 'site',
    entityId: 7,
    payload: { kind: 'site', title: 'After the edit' },
    previousPayload: { kind: 'site', title: 'Before the edit' },
    ...overrides,
  })

  it('restores the state the record had before the revision', () => {
    const plan = planRevert(target())

    expect(plan).toEqual({
      ok: true,
      entityType: 'site',
      entityId: 7,
      payload: { kind: 'site', title: 'Before the edit', entityId: 7 },
    })
  })

  it('refuses an unknown revision with a 404', () => {
    expect(planRevert(undefined)).toMatchObject({ ok: false, status: 404 })
  })

  /**
   * A revision that created a record has no earlier state, so there is nothing
   * to restore. Taking such a record off the atlas is a retraction's job, and
   * the 400 is what tells the caller to use that instead of retrying.
   */
  it('refuses to revert a create, distinctly from an unknown revision', () => {
    expect(planRevert(target({ previousPayload: null }))).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses when the revision was never applied to a record', () => {
    expect(planRevert(target({ entityId: null }))).toMatchObject({ ok: false, status: 400 })
  })

  /**
   * `revisions.entity_type` is a `varchar(20)` with no check constraint, so an
   * unrecognised value is reachable. Left alone it would produce a payload whose
   * `kind` matches neither branch in `applyRevision` — a revert that writes
   * history, logs a success and changes nothing.
   */
  it('refuses an entity type outside the vocabulary rather than no-opping', () => {
    expect(planRevert(target({ entityType: 'monument' }))).toMatchObject({
      ok: false,
      status: 409,
    })
  })

  /**
   * The property that keeps a revert aimed at its own record. `previousPayload`
   * is stored JSON — a corrupt or hand-edited one naming a different record
   * would otherwise send this write at a record the moderator never looked at,
   * and `applyRevision` would apply it without complaint.
   */
  it('forces the record identity from the revision, not from the stored payload', () => {
    const plan = planRevert(
      target({
        entityId: 7,
        previousPayload: { kind: 'tracing', entityId: 999, title: 'Somebody else’s record' },
      }),
    )

    expect(plan).toMatchObject({ ok: true, payload: { entityId: 7, kind: 'site' } })
  })

  /**
   * Reverting a retraction is how a record comes back, and it works precisely
   * because the pre-retraction payload never carried the flag — `applyRevision`
   * sees an ordinary edit and sets the row back to `approved`.
   */
  it('produces an un-retraction when reverting a retraction', () => {
    const plan = planRevert(
      target({
        payload: { kind: 'site', title: 'Castra Vetera', retracted: true },
        previousPayload: { kind: 'site', title: 'Castra Vetera' },
      }),
    )

    expect(plan).toMatchObject({ ok: true })
    expect((plan as { payload: Record<string, unknown> }).payload.retracted).toBeUndefined()
  })
})

describe('buildRetractionPayload', () => {
  it('carries the record across untouched, so reverting restores it exactly', () => {
    const current = { kind: 'site', title: 'Castra Vetera', summary: 'Legionary fortress' }

    expect(buildRetractionPayload({ current, entityType: 'site', entityId: 7 })).toEqual({
      kind: 'site',
      title: 'Castra Vetera',
      summary: 'Legionary fortress',
      entityId: 7,
      retracted: true,
    })
  })

  it('forces the identity from the request rather than trusting the stored payload', () => {
    const current = { kind: 'tracing', entityId: 999, title: 'Stale' }

    expect(buildRetractionPayload({ current, entityType: 'site', entityId: 7 })).toMatchObject({
      kind: 'site',
      entityId: 7,
    })
  })

  /** Retracting twice must describe the same end state, not accumulate flags. */
  it('is idempotent against an already-retracted payload', () => {
    const once = buildRetractionPayload({
      current: { kind: 'site', title: 'Castra Vetera' },
      entityType: 'site',
      entityId: 7,
    })

    expect(buildRetractionPayload({ current: once, entityType: 'site', entityId: 7 })).toEqual(once)
  })
})

describe('geometryKindFor', () => {
  it('files a closed shape as an area', () => {
    expect(geometryKindFor({ type: 'Polygon' })).toBe('area')
  })

  it('files a road or aqueduct as a line', () => {
    expect(geometryKindFor({ type: 'LineString' })).toBe('line')
  })
})
