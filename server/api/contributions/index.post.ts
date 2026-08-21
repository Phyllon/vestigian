import { z } from 'zod'
import type { SessionUser } from '#shared/types'

const positionSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-85).max(85),
})

const siteDraftSchema = z.object({
  kind: z.literal('site'),
  /** Present when editing an existing site, absent when recording a new one. */
  entityId: z.number().int().positive().optional(),
  title: z.string().trim().min(3).max(240),
  category: z.enum([
    'settlement',
    'fortification',
    'sanctuary',
    'burial',
    'infrastructure',
    'villa',
    'production',
    'findspot',
    'other',
  ]),
  summary: z.string().trim().max(400).optional(),
  description: z.string().trim().max(20000).optional(),
  position: positionSchema,
  periodFrom: z.number().int().min(-1200).max(1500).nullable().default(null),
  periodTo: z.number().int().min(-1200).max(1500).nullable().default(null),
  /** Why the change was made. Meaningful for edits, ignored for creates. */
  editSummary: z.string().trim().max(300).optional(),
})

const tracingDraftSchema = z.object({
  kind: z.literal('tracing'),
  entityId: z.number().int().positive().optional(),
  title: z.string().trim().min(3).max(240),
  category: z.enum(['infrastructure', 'fortification', 'other']),
  description: z.string().trim().max(20000).optional(),
  geometry: z.object({
    type: z.enum(['LineString', 'Polygon']),
    coordinates: z.array(z.any()).min(2).max(10000),
  }),
  editSummary: z.string().trim().max(300).optional(),
})

const contributionSchema = z.discriminatedUnion('kind', [siteDraftSchema, tracingDraftSchema])

/**
 * The single write path for both new records and edits. Whether the result goes
 * live immediately is decided by evaluateTrust — never by the client, and never
 * differently for an edit than for a create.
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const user = session.user as SessionUser
  await enforceRateLimit(event, 'contribute')

  const draft = await readValidatedBody(event, contributionSchema.parse)
  const sql = useSql()

  const [account] = await sql<
    { approved_contributions: number; trust_revoked: boolean; role: SessionUser['role'] }[]
  >`
    SELECT approved_contributions, trust_revoked, role FROM users WHERE id = ${user.id}
  `

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  // An edit must name a record that exists and is published. Allowing edits to
  // pending or rejected rows would let the queue be used to resurrect content a
  // moderator has already removed.
  let previousPayload: Record<string, unknown> | null = null

  if (draft.entityId) {
    previousPayload = await loadCurrentPayload(draft.kind, draft.entityId)
    if (!previousPayload) {
      throw createError({ statusCode: 404, message: 'That record no longer exists.' })
    }
  }

  const changes = diffPayloads(previousPayload, draft as unknown as Record<string, unknown>)

  if (draft.entityId && changes.length === 0) {
    throw createError({ statusCode: 400, message: 'Nothing was changed.' })
  }

  const trust = evaluateTrust({
    approvedContributions: account.approved_contributions,
    trustRevoked: account.trust_revoked,
    role: account.role,
  })

  // Trust earns automatic publishing for ordinary work, but an edit that mostly
  // empties an existing record is queued regardless of who made it. This is the
  // one case where a wrong auto-approval costs far more than a moderator glance.
  const requiresReview = draft.entityId !== undefined && isBlankingEdit(changes)
  const autoApprove = trust.autoApprove && !requiresReview
  const status = autoApprove ? 'approved' : 'pending'

  const [revision] = await sql<{ id: number }[]>`
    INSERT INTO revisions (
      entity_type, entity_id, payload, previous_payload, edit_summary,
      status, author_id, auto_approved, reviewed_at
    )
    VALUES (
      ${draft.kind}, ${draft.entityId ?? null}, ${sql.json(draft)},
      ${previousPayload ? sql.json(previousPayload) : null},
      ${draft.editSummary ?? null}, ${status}, ${user.id},
      ${autoApprove ? 1 : 0}, ${autoApprove ? sql`now()` : null}
    )
    RETURNING id
  `

  let entityId: number | null = draft.entityId ?? null

  if (autoApprove) {
    await applyRevision(revision!.id)
    await bumpDataVersion()

    const [applied] = await sql<{ entity_id: number | null }[]>`
      SELECT entity_id FROM revisions WHERE id = ${revision!.id}
    `
    entityId = applied?.entity_id ?? null
  }

  return {
    revisionId: revision!.id,
    entityId,
    status,
    changeCount: changes.length,
    message: buildOutcomeMessage(status, Boolean(draft.entityId), requiresReview),
  }
})

const buildOutcomeMessage = (status: string, isEdit: boolean, requiresReview: boolean): string => {
  if (status === 'approved') {
    return isEdit ? 'Changes published.' : 'Published. Thank you.'
  }
  if (requiresReview) {
    return 'This edit removes a lot, so a moderator will look at it before it goes live.'
  }
  return isEdit
    ? 'Your changes are queued for review.'
    : 'Submitted for review. It will appear once a moderator accepts it.'
}

/**
 * Reads the live record in the same shape a draft arrives in, so the diff
 * compares like with like rather than database columns against form fields.
 */
const loadCurrentPayload = async (
  kind: 'site' | 'tracing',
  entityId: number,
): Promise<Record<string, unknown> | null> => {
  const sql = useSql()

  if (kind === 'site') {
    const [row] = await sql<
      {
        title: string
        category: string
        summary: string | null
        description: string | null
        lon: number
        lat: number
        period_from: number | null
        period_to: number | null
      }[]
    >`
      SELECT title, category::text AS category, summary, description,
             ST_X(geom) AS lon, ST_Y(geom) AS lat, period_from, period_to
      FROM sites WHERE id = ${entityId} AND status = 'approved' LIMIT 1
    `

    if (!row) return null

    return {
      title: row.title,
      category: row.category,
      summary: row.summary ?? undefined,
      description: row.description ?? undefined,
      position: { lon: row.lon, lat: row.lat },
      periodFrom: row.period_from,
      periodTo: row.period_to,
    }
  }

  const [row] = await sql<
    { title: string; category: string; description: string | null; geometry: string }[]
  >`
    SELECT title, category::text AS category, description,
           ST_AsGeoJSON(geom) AS geometry
    FROM tracings WHERE id = ${entityId} AND status = 'approved' LIMIT 1
  `

  if (!row) return null

  return {
    title: row.title,
    category: row.category,
    description: row.description ?? undefined,
    geometry: JSON.parse(row.geometry),
  }
}
