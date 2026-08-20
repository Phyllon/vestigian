import { countsTowardsTrust } from './trust'
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
}

interface TracingPayload {
  kind: 'tracing'
  entityId?: number
  title: string
  category: string
  description?: string
  geometry: { type: string; coordinates: unknown }
}

type RevisionPayload = SitePayload | TracingPayload

interface RevisionRow {
  id: number
  entity_type: ContributionKind
  entity_id: number | null
  payload: RevisionPayload
  author_id: number | null
  reverts_revision_id: number | null
}

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
    SELECT id, entity_type, entity_id, payload, author_id, reverts_revision_id
    FROM revisions WHERE id = ${revisionId} LIMIT 1
  `

  if (!revision) throw createError({ statusCode: 404, message: 'Revision not found.' })

  const payload = revision.payload
  const targetId = revision.entity_id ?? payload.entityId ?? null

  await sql.begin(async (tx) => {
    if (payload.kind === 'site') {
      if (targetId) {
        await updateSite(tx, targetId, payload)
      } else {
        const createdId = await insertSite(tx, payload, revision.author_id)
        await tx`UPDATE revisions SET entity_id = ${createdId} WHERE id = ${revisionId}`
      }
    }

    if (payload.kind === 'tracing') {
      if (targetId) {
        await updateTracing(tx, targetId, payload)
      } else {
        const createdId = await insertTracing(tx, payload, revision.author_id)
        await tx`UPDATE revisions SET entity_id = ${createdId} WHERE id = ${revisionId}`
      }
    }

    // A revert is moderator housekeeping, not a contribution, so it does not
    // move anyone towards automatic publishing.
    const isRevert = revision.reverts_revision_id !== null

    if (revision.author_id && !isRevert && countsTowardsTrust(revision.entity_type)) {
      await tx`
        UPDATE users
        SET approved_contributions = approved_contributions + 1,
            trust_level = CASE
              WHEN trust_revoked THEN 0
              WHEN approved_contributions + 1 >= 2 THEN 1
              ELSE 0
            END
        WHERE id = ${revision.author_id}
      `
    }
  })
}

type Transaction = Parameters<Parameters<ReturnType<typeof useSql>['begin']>[0]>[0]

const insertSite = async (
  tx: Transaction,
  payload: SitePayload,
  authorId: number | null,
): Promise<number> => {
  const slug = await reserveSlug(payload.title)

  const [created] = await tx<{ id: number }[]>`
    INSERT INTO sites (
      slug, title, category, summary, description, geom,
      period_from, period_to, status, created_by
    )
    VALUES (
      ${slug}, ${payload.title}, ${payload.category}::site_category,
      ${payload.summary ?? null}, ${payload.description ?? null},
      ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326),
      ${payload.periodFrom}, ${payload.periodTo}, 'approved', ${authorId}
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
 */
const updateSite = async (
  tx: Transaction,
  siteId: number,
  payload: SitePayload,
): Promise<void> => {
  await tx`
    UPDATE sites SET
      title = ${payload.title},
      category = ${payload.category}::site_category,
      summary = ${payload.summary ?? null},
      description = ${payload.description ?? null},
      geom = ST_SetSRID(ST_MakePoint(${payload.position.lon}, ${payload.position.lat}), 4326),
      period_from = ${payload.periodFrom},
      period_to = ${payload.periodTo},
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
      ${payload.geometry.type === 'Polygon' ? 'area' : 'line'}::geometry_kind,
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
      kind = ${payload.geometry.type === 'Polygon' ? 'area' : 'line'}::geometry_kind,
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
