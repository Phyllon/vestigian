import { and, desc, eq } from 'drizzle-orm'
import { revisions } from '~~/server/database/schema'
import { countsTowardsTrust } from '#shared/utils/authorization'
import type postgres from 'postgres'
import type { ContributionKind } from '#shared/types'

interface SitePayload {
  kind: 'site'
  entityId?: number
  title: string
  category: string
  summary?: string
  description?: string
  position: { lon: number; lat: number }
  periodFrom: number | null
  periodTo: number | null
  retracted?: boolean
}

/**
 * `LineString | Polygon` and nothing else, because that is what
 * `server/api/contributions/index.post.ts` accepts. Typed as the union rather
 * than `string` so `geometryKindFor` below is total: a third geometry type
 * would be a compile error here instead of silently falling through to `line`.
 */
type ContributedGeometryType = 'LineString' | 'Polygon'

interface TracingPayload {
  kind: 'tracing'
  entityId?: number
  title: string
  category: string
  description?: string
  geometry: { type: ContributedGeometryType; coordinates: unknown }
  retracted?: boolean
}

type RevisionPayload = SitePayload | TracingPayload

interface RevisionRow {
  id: number
  entity_type: ContributionKind
  entity_id: number | null
  payload: RevisionPayload
  author_id: number | null
  reverts_revision_id: number | null
  /** 1 when trust published this without a moderator. Drives the drift sample below. */
  auto_approved: number
}

/**
 * The decisions this file makes, separated from the writes that carry them out.
 *
 * Everything below is pure and unit-tested in `__test__/revisions.test.ts`.
 * The pattern is the one `server/utils/retraction.ts` already uses, and for the
 * same reason: these are the governance rules, and asserting them through the
 * database would mean asserting them through a transaction, a live PostGIS
 * geometry and three call sites — which is why they went untested for as long
 * as they did. `applyRevision` keeps the writes; what *decides* is here.
 */

export type RevisionRefusal = 'retraction-without-target'

export type RevisionWritePlan =
  | { action: 'retract'; kind: 'site' | 'tracing'; targetId: number }
  | { action: 'update'; kind: 'site' | 'tracing'; targetId: number }
  | { action: 'insert'; kind: 'site' | 'tracing' }
  | { action: 'refuse'; reason: RevisionRefusal }

export interface RevisionWriteInput {
  /** `revisions.entity_id`, authoritative when set. */
  entityId: number | null
  payload: RevisionPayload
}

/**
 * Which of the four things an approved revision does to the live tables.
 *
 * `entity_id` on the row outranks `entityId` inside the payload. The column is
 * written by this file when a create is applied; the payload field is what the
 * submitting client sent, so where they disagree the column is the one that has
 * already been reconciled against a real row.
 *
 * The `refuse` case is a hole this extraction closed rather than described. A
 * payload carrying `retracted: true` with no resolvable target used to fall
 * straight past the retraction branch into the insert path — so a retraction
 * that had lost its entity id would not fail, it would *publish a brand-new
 * record* built out of the retraction payload, credited to the moderator who
 * pressed the button. Nothing in the app is known to produce that shape, which
 * is exactly why it would have been found late.
 */
export const planRevisionWrite = (input: RevisionWriteInput): RevisionWritePlan => {
  const kind = input.payload.kind
  const targetId = input.entityId ?? input.payload.entityId ?? null

  if (input.payload.retracted === true) {
    if (targetId === null) return { action: 'refuse', reason: 'retraction-without-target' }
    return { action: 'retract', kind, targetId }
  }

  return targetId === null ? { action: 'insert', kind } : { action: 'update', kind, targetId }
}

export interface TrustCreditInput {
  authorId: number | null
  revertsRevisionId: number | null
  entityType: ContributionKind
}

/**
 * Whether applying this revision moves its author towards automatic publishing.
 *
 * Three separate rules meet here, and each one is load-bearing on its own: an
 * anonymous or deleted author has nobody to credit, a revert is moderator
 * housekeeping rather than a contribution, and `countsTowardsTrust` excludes
 * photographs. The threshold itself stays in `shared/utils/authorization.ts` —
 * this only decides whether the counter moves, never what the count implies.
 */
export const shouldCountTowardsTrust = (input: TrustCreditInput): boolean =>
  input.authorId !== null &&
  input.revertsRevisionId === null &&
  countsTowardsTrust(input.entityType)

/** `LineString` becomes a line, `Polygon` an area. The only two that exist. */
export const geometryKindFor = (geometry: { type: ContributedGeometryType }): 'area' | 'line' =>
  geometry.type === 'Polygon' ? 'area' : 'line'

export interface RevertTarget {
  /**
   * Deliberately `string`, not `ContributionKind`: `revisions.entity_type` is a
   * plain `varchar(20)` with no check constraint, so the database can hand back
   * a value outside the union and the compiler would be lying if this said
   * otherwise. `planRevert` narrows it instead — see the refusal below.
   */
  entityType: string
  entityId: number | null
  payload: unknown
  previousPayload: unknown
}

export type RevertPlan =
  | {
      ok: true
      payload: Record<string, unknown>
      /** Resolved here so the caller writes the revision without re-narrowing. */
      entityType: ContributionKind
      entityId: number
    }
  | { ok: false; status: 404 | 400 | 409; message: string }

const isContributionKind = (value: string): value is ContributionKind =>
  value === 'site' || value === 'tracing' || value === 'image'

/**
 * The state a revert has to restore, or the reason there isn't one.
 *
 * `kind` and `entityId` are written *after* the spread deliberately. They are
 * not decoration: a `previousPayload` carrying some other record's `entityId` —
 * corrupt, hand-edited, or written by a bug that no longer exists — would
 * otherwise aim this revert at a record the moderator never looked at, and
 * `applyRevision` would apply it without complaint. Forcing both from the
 * revision row means a revert can only ever touch the record it belongs to.
 *
 * The two refusals are different in kind and keep different statuses: 404 is
 * "no such published revision", 400 is "this revision created the record, so
 * there is no earlier state" — which is a retraction's job, not a revert's.
 */
export const planRevert = (target: RevertTarget | undefined): RevertPlan => {
  if (!target) {
    return { ok: false, status: 404, message: 'No published revision with that id.' }
  }

  if (!target.previousPayload || !target.entityId) {
    return {
      ok: false,
      status: 400,
      message: 'That revision created the record, so there is no earlier state to restore.',
    }
  }

  /**
   * An entity type outside the vocabulary would produce a payload whose `kind`
   * matches neither branch in `applyRevision`, so the revert would write a
   * revision, log "revision applied", and change nothing — a silent no-op
   * reported as a success. Refusing is the honest answer.
   */
  if (!isContributionKind(target.entityType)) {
    return {
      ok: false,
      status: 409,
      message: 'That revision refers to a kind of record this version cannot restore.',
    }
  }

  return {
    ok: true,
    entityType: target.entityType,
    entityId: target.entityId,
    payload: {
      ...(target.previousPayload as Record<string, unknown>),
      kind: target.entityType,
      entityId: target.entityId,
    },
  }
}

export interface RetractionPayloadInput {
  /** The record's latest approved payload — what a revert of this must restore. */
  current: Record<string, unknown>
  entityType: ContributionKind
  entityId: number
}

/**
 * A retraction is the current state plus a flag, not an edit — the fields are
 * carried across untouched so that reverting it returns the record exactly as
 * it was. `entityId` is forced for the same reason it is in `planRevert`.
 */
export const buildRetractionPayload = (input: RetractionPayloadInput): Record<string, unknown> => ({
  ...input.current,
  kind: input.entityType,
  entityId: input.entityId,
  retracted: true,
})

/**
 * Materialises an approved revision into the live tables.
 *
 * This is the only place a live row is written, whether the approval came from
 * the trust threshold, a moderator, or a revert. One path means the rules
 * cannot diverge between them.
 */
export const applyRevision = async (revisionId: number): Promise<void> => {
  const sql = useSql()

  const [revision] = await sql<RevisionRow[]>`
    SELECT id, entity_type, entity_id, payload, author_id, reverts_revision_id, auto_approved
    FROM revisions WHERE id = ${revisionId} LIMIT 1
  `

  if (!revision) throw createError({ statusCode: 404, message: 'Revision not found.' })

  const payload = revision.payload
  const plan = planRevisionWrite({ entityId: revision.entity_id, payload })

  if (plan.action === 'refuse') {
    throw createError({
      statusCode: 409,
      message: 'That revision retracts a record it does not identify.',
    })
  }

  const targetId = plan.action === 'insert' ? null : plan.targetId
  let finalSiteId: number | null = payload.kind === 'site' ? targetId : null

  await sql.begin(async (tx) => {
    /**
     * A retraction takes a published record off the atlas without editing it.
     *
     * This branch exists so that withdrawing a record stays inside the one
     * function allowed to write a live row. There was no withdrawal path for
     * a site or tracing at all before `/admin`'s bulk retraction needed one,
     * and the obvious implementation — an `UPDATE sites SET status` in the
     * endpoint — would have been the second write path this whole design
     * exists to prevent.
     *
     * `'rejected'` rather than a new status value because it is already what
     * every tile query excludes (`mvt.ts`), so the record leaves the map, the
     * sitemap and the GeoJSON feed with nothing else to change. The fields are
     * left exactly as they are: a retraction is not an edit, and the record
     * has to come back unchanged when the retraction is reverted — which needs
     * no new code, because the retraction is itself an ordinary revision and
     * `moderation/revert.post.ts` restores `previousPayload` like any other.
     */
    if (plan.action === 'retract') {
      // Two statements rather than one with an interpolated table name: the
      // identifier is not a parameter, and spelling it out is clearer than
      // composing a fragment to save a line.
      if (plan.kind === 'site') {
        await tx`UPDATE sites SET status = 'rejected' WHERE id = ${plan.targetId}`
      } else {
        await tx`UPDATE tracings SET status = 'rejected' WHERE id = ${plan.targetId}`
      }

      useLogger().info(
        {
          audit: 'revision.retracted',
          revisionId,
          entityType: revision.entity_type,
          entityId: plan.targetId,
        },
        'record retracted',
      )
      return
    }

    if (payload.kind === 'site') {
      if (plan.action === 'update') {
        await updateSite(tx, plan.targetId, payload)
      } else {
        const createdId = await insertSite(tx, payload, revision.author_id)
        finalSiteId = createdId
        await tx`UPDATE revisions SET entity_id = ${createdId} WHERE id = ${revisionId}`
      }
    }

    if (payload.kind === 'tracing') {
      if (plan.action === 'update') {
        await updateTracing(tx, plan.targetId, payload)
      } else {
        const createdId = await insertTracing(tx, payload, revision.author_id)
        await tx`UPDATE revisions SET entity_id = ${createdId} WHERE id = ${revisionId}`
      }
    }

    if (
      shouldCountTowardsTrust({
        authorId: revision.author_id,
        revertsRevisionId: revision.reverts_revision_id,
        entityType: revision.entity_type,
      })
    ) {
      // Only the count is written. The level it implies is `evaluateTrust`'s
      // to decide, and used to be transcribed into this statement with the
      // threshold inline — a second copy of the governance rule, in SQL, where
      // no test could reach it.
      await tx`
        UPDATE users
        SET approved_contributions = approved_contributions + 1
        WHERE id = ${revision.author_id}
      `
    }
  })

  // Fire-and-forget: cross-referencing a site against EDH, iDAI.gazetteer and
  // Historic England costs up to two external requests, and nothing in this
  // path — a contribution's own approval — should wait on them. See
  // `verifySiteConcordances`'s own docstring for why it is never awaited here.
  if (finalSiteId) void verifySiteConcordances(finalSiteId)

  /**
   * The drift spot-check, drawn here rather than at the contribution endpoint
   * for the reason this whole file exists: automatic approval, moderator
   * approval and revert all arrive at this one function, so a rule applied here
   * cannot diverge between them.
   *
   * Only *automatic* publishing is eligible — `auto_approved` distinguishes it
   * from the moderator-approved and revert paths, which already had a reviewer.
   * After the transaction, so the author's count reflects this contribution,
   * and never awaited: the record is already published and correct, and a
   * missing spot-check must not be able to fail a contribution.
   */
  if (revision.auto_approved === 1 && revision.author_id) {
    void sampleAutoApprovedRevision({ revisionId, authorId: revision.author_id })
  }

  // The governance audit line. `applyRevision` is the only path by which a live
  // row is ever written — automatic approval, moderator approval and revert all
  // arrive here — so one line at this point records every change the atlas has
  // ever published, without needing one at each of the three call sites.
  useLogger().info(
    {
      audit: 'revision.applied',
      revisionId,
      entityType: revision.entity_type,
      entityId: targetId,
      authorId: revision.author_id,
      revertsRevisionId: revision.reverts_revision_id,
    },
    'revision applied',
  )
}

export interface RevertRequest {
  revisionId: number
  moderatorId: number
  reason?: string
}

export interface RevertResult {
  revisionId: number
  revertedRevisionId: number
}

/**
 * Restores the state a record had before a given revision.
 *
 * Lives here rather than in `moderation/revert.post.ts` because it now has two
 * callers — that endpoint and the bulk retraction sweep — and a revert that
 * two places implement is a revert two places can get wrong. The endpoint
 * keeps the HTTP concerns (validation, the 404, the metric, the audit line);
 * everything that decides *what a revert is* is here.
 *
 * A revert is written as a new revision rather than by deleting the offending
 * one. History stays append-only, so the record of what was reverted and by
 * whom survives — which is the whole point of keeping revisions at all.
 *
 * Throws rather than returning a failure: both callers need to distinguish
 * "there is nothing to restore" from "this worked", and the sweep catches it
 * per item so one unrevertable revision cannot abandon the rest.
 */
export const revertRevision = async (request: RevertRequest): Promise<RevertResult> => {
  const { revisionId, moderatorId, reason } = request
  const database = useDatabase()

  const [target] = await database
    .select({
      id: revisions.id,
      entityType: revisions.entityType,
      entityId: revisions.entityId,
      payload: revisions.payload,
      previousPayload: revisions.previousPayload,
    })
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.status, 'approved')))
    .limit(1)

  const plan = planRevert(target)

  if (!plan.ok) {
    throw createError({ statusCode: plan.status, message: plan.message })
  }

  const restored = plan.payload

  /**
   * `previousPayload` is what this revert replaces — the state the offending
   * revision put there — so it is that revision's `payload`. It was read above
   * rather than re-selected in a subquery, which is what the raw version did.
   */
  const [revision] = await database
    .insert(revisions)
    .values({
      entityType: plan.entityType,
      entityId: plan.entityId,
      payload: restored,
      previousPayload: target!.payload,
      editSummary: reason ?? `Reverted revision ${revisionId}`,
      status: 'approved',
      authorId: moderatorId,
      reviewerId: moderatorId,
      autoApproved: 0,
      revertsRevisionId: revisionId,
      reviewedAt: new Date(),
    })
    .returning({ id: revisions.id })

  await applyRevision(revision!.id)

  return { revisionId: revision!.id, revertedRevisionId: revisionId }
}

export interface RetractRequest {
  entityType: ContributionKind
  entityId: number
  moderatorId: number
  reason: string
}

/**
 * Takes one published record off the atlas, as a revision.
 *
 * The counterpart to `revertRevision` for a record the person *created* rather
 * than edited: there is no earlier state to restore, so reverting is
 * meaningless and what is wanted is for the record to stop being published.
 *
 * It writes an ordinary approved revision whose payload is the record's
 * current state plus `retracted: true`, and lets `applyRevision`'s retraction
 * branch do the write. Three things fall out of that shape for free: the
 * retraction appears in the record's own history where a reader expects it,
 * `revert.post.ts` un-retracts it with no new code, and no second path to a
 * live row is created.
 */
export const retractRecord = async (request: RetractRequest): Promise<{ revisionId: number }> => {
  const { entityType, entityId, moderatorId, reason } = request
  const database = useDatabase()

  /**
   * The record's latest approved payload is the state a revert of this
   * retraction has to restore, so it is what `previousPayload` must hold.
   * Read from `revisions` rather than reassembled from the live row: the
   * live row has no geometry this code can serialise without PostGIS, and the
   * last approved revision is by definition what produced it.
   */
  const [latest] = await database
    .select({ payload: revisions.payload })
    .from(revisions)
    .where(
      and(
        eq(revisions.entityType, entityType),
        eq(revisions.entityId, entityId),
        eq(revisions.status, 'approved'),
      ),
    )
    .orderBy(desc(revisions.id))
    .limit(1)

  if (!latest) {
    throw createError({
      statusCode: 409,
      message: 'That record has no approved revision, so there is nothing to retract.',
    })
  }

  const current = latest.payload as Record<string, unknown>

  const [revision] = await database
    .insert(revisions)
    .values({
      entityType,
      entityId,
      payload: buildRetractionPayload({ current, entityType, entityId }),
      previousPayload: current,
      editSummary: reason,
      status: 'approved',
      authorId: moderatorId,
      reviewerId: moderatorId,
      autoApproved: 0,
      reviewedAt: new Date(),
    })
    .returning({ id: revisions.id })

  await applyRevision(revision!.id)

  return { revisionId: revision!.id }
}

/**
 * Taken from postgres.js rather than derived from `sql.begin`.
 *
 * `begin` is overloaded — `(cb)` and `(options, cb)` — and `Parameters<T>`
 * resolves to the *last* overload, so the obvious
 * `Parameters<Parameters<...['begin']>[0]>[0]` picked up `options: string` and
 * collapsed the whole alias to `never`. Every helper below then took a
 * parameter nothing could satisfy, and the tagged-template calls inside them
 * reported as "not callable" — nine errors, none of them where the mistake was.
 */
type Transaction = postgres.TransactionSql

/**
 * `country_code` is set here by point-in-polygon against
 * `country_boundaries` (Natural Earth, public domain —
 * `scripts/import/07-country-boundaries.ts`), so a contribution gets a
 * country the moment it publishes rather than needing another bulk pass to
 * catch up — that gap is exactly how every imported site ended up with a
 * null `country_code` in the first place.
 *
 * This was originally a nearest-*point* match against `geo_names`, which is
 * sparse and scoped to wherever vici.org's own `geo.sql` dump happens to
 * cover (five countries: DE, FR, IT, NL, BE) — a site genuinely outside
 * that area still has *a* nearest `geo_names` point, however far away, and
 * an unguarded match confidently mislabelled it with whichever of those
 * five happened to be closest. Measured: 43,479 of 61,274 approved sites,
 * over two thirds, sat outside that area. Real boundary polygons have no
 * such failure mode for almost every site — a point is either inside a
 * country or it is not. The one real exception is the coastline itself:
 * Natural Earth's 1:50m boundary is a simplification, and a genuinely
 * coastal site (a harbour, a villa maritima, a small island) can land just
 * outside it in the gap — measured, 688 sites, mostly Italian coastal and
 * island sites up to 54 km from the nearest mapped boundary, against a
 * 100+ km gap to the next-nearest country in every one of them. So the
 * lookup falls back to the nearest boundary within `COASTAL_TOLERANCE_METRES`
 * only when strict containment finds nothing — `COALESCE` short-circuits in
 * Postgres, so this second, slightly more expensive query only runs for
 * that rare miss, not on every write.
 */
const COASTAL_TOLERANCE_METRES = 60_000

const insertSite = async (
  tx: Transaction,
  payload: SitePayload,
  authorId: number | null,
): Promise<number> => {
  const slug = await reserveSlug(payload.title)

  const [created] = await tx<{ id: number }[]>`
    INSERT INTO sites (
      slug, title, category, summary, description, geom,
      period_from, period_to, country_code, status, created_by
    )
    VALUES (
      ${slug}, ${payload.title}, ${payload.category}::site_category,
      ${payload.summary ?? null}, ${payload.description ?? null},
      ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326),
      ${payload.periodFrom}, ${payload.periodTo},
      COALESCE(
        (
          SELECT b.iso_a2 FROM country_boundaries b
          WHERE ST_Contains(
            b.geom,
            ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326)
          )
          LIMIT 1
        ),
        (
          SELECT n.iso_a2 FROM (
            SELECT iso_a2, geom FROM country_boundaries
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326)
            LIMIT 1
          ) n
          WHERE ST_DWithin(
            n.geom::geography,
            ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326)::geography,
            ${COASTAL_TOLERANCE_METRES}
          )
        )
      ),
      'approved', ${authorId}
    )
    RETURNING id
  `

  return created!.id
}

/**
 * The slug is deliberately not regenerated when a title is edited. Existing
 * links, citations and the sitemap all point at it, and a renamed site that
 * silently breaks every inbound link is worse than a slug that no longer
 * matches its title exactly.
 *
 * `country_code` is recomputed here too, not just on create: a corrected
 * position (see `siteEditPage.position` in the edit form) is exactly the
 * case where the old country_code would otherwise go stale silently.
 */
const updateSite = async (tx: Transaction, siteId: number, payload: SitePayload): Promise<void> => {
  await tx`
    UPDATE sites SET
      title = ${payload.title},
      category = ${payload.category}::site_category,
      summary = ${payload.summary ?? null},
      description = ${payload.description ?? null},
      geom = ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326),
      period_from = ${payload.periodFrom},
      period_to = ${payload.periodTo},
      country_code = COALESCE(
        (
          SELECT b.iso_a2 FROM country_boundaries b
          WHERE ST_Contains(
            b.geom,
            ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326)
          )
          LIMIT 1
        ),
        (
          SELECT n.iso_a2 FROM (
            SELECT iso_a2, geom FROM country_boundaries
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326)
            LIMIT 1
          ) n
          WHERE ST_DWithin(
            n.geom::geography,
            ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326)::geography,
            ${COASTAL_TOLERANCE_METRES}
          )
        )
      ),
      status = 'approved'
    WHERE id = ${siteId}
  `
}

const insertTracing = async (
  tx: Transaction,
  payload: TracingPayload,
  authorId: number | null,
): Promise<number> => {
  const [created] = await tx<{ id: number }[]>`
    INSERT INTO tracings (title, kind, category, geom, description, status, created_by)
    VALUES (
      ${payload.title},
      ${geometryKindFor(payload.geometry)}::geometry_kind,
      ${payload.category}::site_category,
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(payload.geometry)}), 4326),
      ${payload.description ?? null}, 'approved', ${authorId}
    )
    RETURNING id
  `

  return created!.id
}

const updateTracing = async (
  tx: Transaction,
  tracingId: number,
  payload: TracingPayload,
): Promise<void> => {
  await tx`
    UPDATE tracings SET
      title = ${payload.title},
      kind = ${geometryKindFor(payload.geometry)}::geometry_kind,
      category = ${payload.category}::site_category,
      geom = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(payload.geometry)}), 4326),
      description = ${payload.description ?? null},
      status = 'approved'
    WHERE id = ${tracingId}
  `
}

/** Finds a free slug, trying numbered variants rather than failing the insert. */
const reserveSlug = async (title: string): Promise<string> => {
  const sql = useSql()
  const base = slugify(title) || 'site'

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = disambiguateSlug(base, attempt)
    const [taken] = await sql`SELECT 1 FROM sites WHERE slug = ${candidate} LIMIT 1`
    if (!taken) return candidate
  }

  return `${base}-${Date.now().toString(36)}`
}
