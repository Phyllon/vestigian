import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { sites, tracings, users } from '~~/server/database/schema'

export const paramsSchema = z.object({ name: z.string().trim().min(1).max(60) })

/**
 * A contributor's public page — **opt-in, and a strict projection.**
 *
 * What it deliberately does not return is the point of the file. No email. No
 * role, so the moderator list is not enumerable from outside. No trust state,
 * because "this person's edits are queued" is a moderation judgement and
 * publishing it would be a scarlet letter. No visits and no bookmarks ever:
 * those are private under every setting, and `public_profile` is a switch about
 * *attribution for contributions*, not a general visibility control. Anyone
 * adding a field here should assume the person who ticked that box did not
 * expect it.
 *
 * A profile that is switched off answers **404, not 403**. A 403 would confirm
 * that an account holds that display name, which turns this route into an
 * account-enumeration oracle keyed on exactly the string a signup form
 * rejects for being taken.
 *
 * `created_at` is reported as a month. The exact timestamp is a fingerprint —
 * it correlates a pseudonymous contributor with a registration event — and
 * "since March 2026" carries everything the page is actually for.
 */
defineRouteMeta({
  openAPI: {
    tags: ['contributors'],
    summary: 'A contributor’s public profile',
    description:
      'Only for accounts that opted in; others answer 404 so the route cannot be used to enumerate display names. Returns the display name, bio, joining month, accepted count and published work — never email, role, trust state, visits or bookmarks.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'record')
  const { name } = await getValidatedRouterParams(event, paramsSchema.parse)

  const database = useDatabase()

  const [contributor] = await database
    .select({
      id: users.id,
      displayName: users.displayName,
      bio: users.bio,
      approvedContributions: users.approvedContributions,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.displayName, name), eq(users.publicProfile, true)))
    .limit(1)

  if (!contributor) {
    throw createError({ statusCode: 404, message: 'No such contributor.' })
  }

  const [publishedSites, publishedTracings] = await Promise.all([
    database
      .select({ id: sites.id, slug: sites.slug, title: sites.title, category: sites.category })
      .from(sites)
      .where(and(eq(sites.createdBy, contributor.id), eq(sites.status, 'approved')))
      .orderBy(desc(sites.createdAt))
      .limit(100),
    database
      .select({ id: tracings.id, title: tracings.title, category: tracings.category })
      .from(tracings)
      .where(and(eq(tracings.createdBy, contributor.id), eq(tracings.status, 'approved')))
      .orderBy(desc(tracings.createdAt))
      .limit(100),
  ])

  return {
    displayName: contributor.displayName,
    bio: contributor.bio,
    // Month precision. See the note above: the day is a fingerprint and buys
    // the page nothing.
    joinedMonth: contributor.createdAt.toISOString().slice(0, 7),
    approvedContributions: contributor.approvedContributions,
    sites: publishedSites,
    tracings: publishedTracings,
  }
})
