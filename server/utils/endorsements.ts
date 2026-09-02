import { count, eq, sql } from 'drizzle-orm'
import { siteEndorsements } from '~~/server/database/schema'

/**
 * The public count plus one viewer's own state, read together so the two
 * numbers a client needs after toggling an endorsement — "how many now" and
 * "did mine take" — come from one query rather than two round trips that
 * could disagree under concurrent writes. An aggregate, not a row fetch: a
 * popular site's endorsement count should cost one index-only scan, not
 * transferring every endorser's id to compute a length.
 */
export interface EndorsementState {
  count: number
  endorsedByMe: boolean
}

export const readEndorsementState = async (
  siteId: number,
  viewerId: number,
): Promise<EndorsementState> => {
  const [row] = await useDatabase()
    .select({
      count: count(siteEndorsements.id),
      endorsedByMe: sql<boolean>`bool_or(${siteEndorsements.userId} = ${viewerId})`,
    })
    .from(siteEndorsements)
    .where(eq(siteEndorsements.siteId, siteId))

  return { count: row?.count ?? 0, endorsedByMe: row?.endorsedByMe ?? false }
}
