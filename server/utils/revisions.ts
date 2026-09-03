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
