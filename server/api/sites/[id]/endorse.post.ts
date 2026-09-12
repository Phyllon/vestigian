import { z } from 'zod'
import { siteEndorsements } from '~~/server/database/schema'

export const paramsSchema = z.object({ id: routeIdentifier })

/**
 * "I found this useful" — one signal per person per site, open to any
 * signed-in reader. See `server/database/schema/endorsements.ts` for why this
 * is not part of the private notebook: the row stays as private as a
 * bookmark, but the count it contributes to is public from the moment this
 * endpoint writes it.
 *
 * Idempotent, like the bookmark toggle it otherwise mirrors — endorsing twice
 * is not a mistake worth a 409, it is a double click.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'Mark a site "found useful"',
    description:
      'Idempotent. Open to any signed-in reader — not gated on having recorded a visit. Returns the new public count.',
  },
})

export default defineEventHandler(async (event) => {
  const userId = (await requireActiveUser(event)).id
  await enforceRateLimit(event, 'contribute')

  const { id: siteId } = await getValidatedRouterParams(event, paramsSchema.parse)
  await requirePublishedSite(siteId)

  await useDatabase()
    .insert(siteEndorsements)
    .values({ userId, siteId })
    .onConflictDoNothing({ target: [siteEndorsements.userId, siteEndorsements.siteId] })

  return { siteId, ...(await readEndorsementState(siteId, userId)) }
})
