import { and, count, countDistinct, eq, min, sql } from 'drizzle-orm'
import { siteBookmarks, siteVisits, sites, users } from '~~/server/database/schema'
import { evaluateMilestones } from '#shared/utils/milestones'
import type { Milestone } from '#shared/types'

/**
 * What a notebook holds — the counts behind `/api/me` and the milestone marks
 * derived from them.
 *
 * Kept out of the route handler because two things need it: the summary
 * endpoint, and the GDPR export, which must report the same numbers the person
 * was shown. Two hand-written copies of "distinct countries visited" is exactly
 * the drift `evaluateTrust` was consolidated to prevent.
 *
 * Everything here is counted on read. Nothing is denormalised onto `users` —
 * see the note on `evaluateMilestones` and migration `0002`.
 */

export interface NotebookStanding {
  visitCount: number
  bookmarkCount: number
  /** Distinct `sites.country_code` among visited sites; nulls do not count. */
  countriesVisited: number
  /** Sites this account both recorded and later stood on. */
  recordedAndVisitedCount: number
  firstVisitAt: string | null
  milestones: Milestone[]
}

export const readNotebookStanding = async (userId: number): Promise<NotebookStanding> => {
  const database = useDatabase()

  const [[visitTotals], [bookmarkTotals], [recordedAndVisited], [account], [firstAccepted]] =
    await Promise.all([
      /**
       * One pass over this user's visits. `country_code` is nullable on `sites`
       * — a findspot with no country is a real row — and `countDistinct` ignores
       * nulls, which is the wanted behaviour: an unplaced visit is a visit but
       * not a country.
       */
      database
        .select({
          visits: count(siteVisits.id),
          countries: countDistinct(sites.countryCode),
          firstVisitAt: min(siteVisits.createdAt),
        })
        .from(siteVisits)
        .innerJoin(sites, eq(sites.id, siteVisits.siteId))
        .where(eq(siteVisits.userId, userId)),

      database
        .select({ bookmarks: count(siteBookmarks.id) })
        .from(siteBookmarks)
        .where(eq(siteBookmarks.userId, userId)),

      database
        .select({ total: count(siteVisits.id) })
        .from(siteVisits)
        .innerJoin(sites, eq(sites.id, siteVisits.siteId))
        .where(and(eq(siteVisits.userId, userId), eq(sites.createdBy, userId))),

      database
        .select({
          role: users.role,
          trustRevoked: users.trustRevoked,
          approvedContributions: users.approvedContributions,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),

      /**
       * When the first contribution landed. `approvedContributions` counts
       * tracings too, so this is the earliest published *site* rather than
       * strictly the first accepted thing — the mark it dates is
       * `first-accepted`, and a tracing-first contributor would see a slightly
       * late date rather than none. One indexed `min()`, and not worth a union
       * over two tables to be exact about an ornament.
       */
      database
        .select({ at: min(sites.createdAt) })
        .from(sites)
        .where(and(eq(sites.createdBy, userId), eq(sites.status, 'approved'))),
    ])

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  const visitCount = visitTotals?.visits ?? 0
  const countriesVisited = visitTotals?.countries ?? 0
  const recordedAndVisitedCount = recordedAndVisited?.total ?? 0
  const firstVisitAt = visitTotals?.firstVisitAt?.toISOString() ?? null

  return {
    visitCount,
    bookmarkCount: bookmarkTotals?.bookmarks ?? 0,
    countriesVisited,
    recordedAndVisitedCount,
    firstVisitAt,
    milestones: evaluateMilestones({
      ...account,
      visitCount,
      countriesVisited,
      recordedAndVisitedCount,
      firstVisitAt,
      firstAcceptedAt: firstAccepted?.at?.toISOString() ?? null,
    }),
  }
}

/**
 * The visited and bookmarked sites, with coordinates, for the map overlay and
 * the GPX field kit.
 *
 * `ST_X`/`ST_Y` are raw expressions inside an otherwise ordinary Drizzle
 * `.select()`, exactly as `sites/[id]/enrichment.get.ts` does it. `useSql()` is
 * for statements whose *shape* is beyond the builder — `ST_AsMVT` and its
 * aggregates, geometry on write — not for two accessors in a select list. The
 * table, the columns and the join stay compile-checked against the schema.
 */
export interface NotebookPlace {
  siteId: number
  slug: string
  title: string
  category: string
  countryCode: string | null
  /** The nearest modern settlement, which is how someone finds it on the ground. */
  modernPlace: string | null
  latitude: number
  longitude: number
  /**
   * Explicit, not inferred from `visitedOn`. An undated visit is a real entry
   * — see `site_visits.visited_on` — so "has a date" and "has been stood on"
   * are different questions and only one of them has a column.
   */
  visited: boolean
  visitedOn: string | null
  note: string | null
  bookmarked: boolean
}

export const readNotebookPlaces = async (userId: number): Promise<NotebookPlace[]> => {
  const database = useDatabase()

  const [visitedSites, bookmarked] = await Promise.all([
    database
      .select({
        siteId: sites.id,
        slug: sites.slug,
        title: sites.title,
        category: sites.category,
        countryCode: sites.countryCode,
        modernPlace: sites.modernPlace,
        latitude: sql<number>`ST_Y(${sites.geom})`,
        longitude: sql<number>`ST_X(${sites.geom})`,
        visitedOn: siteVisits.visitedOn,
        note: siteVisits.note,
      })
      .from(siteVisits)
      .innerJoin(sites, eq(sites.id, siteVisits.siteId))
      .where(eq(siteVisits.userId, userId)),

    database
      .select({
        siteId: sites.id,
        slug: sites.slug,
        title: sites.title,
        category: sites.category,
        countryCode: sites.countryCode,
        modernPlace: sites.modernPlace,
        latitude: sql<number>`ST_Y(${sites.geom})`,
        longitude: sql<number>`ST_X(${sites.geom})`,
      })
      .from(siteBookmarks)
      .innerJoin(sites, eq(sites.id, siteBookmarks.siteId))
      .where(eq(siteBookmarks.userId, userId)),
  ])

  /**
   * A site can be both bookmarked and visited — someone marks a place to go,
   * goes, and records it without clearing the bookmark. Merged into one entry
   * so the map draws one glyph per place rather than stacking two, which is the
   * same mistake the limes layers had to fix between contributed and Pleiades
   * fortifications.
   */
  const places = new Map<number, NotebookPlace>()

  for (const place of visitedSites) {
    places.set(place.siteId, { ...place, visited: true, bookmarked: false })
  }

  for (const place of bookmarked) {
    const existing = places.get(place.siteId)
    if (existing) {
      existing.bookmarked = true
      continue
    }
    places.set(place.siteId, {
      ...place,
      visited: false,
      visitedOn: null,
      note: null,
      bookmarked: true,
    })
  }

  return [...places.values()]
}

/** Whether a site exists and is published, before a visit or bookmark names it. */
export const requirePublishedSite = async (siteId: number): Promise<void> => {
  const [site] = await useDatabase()
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.status, 'approved')))
    .limit(1)

  if (!site) throw createError({ statusCode: 404, message: 'No published site at that id.' })
}
