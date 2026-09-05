import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { columnReliefPlates } from '~~/server/database/schema'
import { IMAGE_PRESETS } from '#shared/types'

export const paramsSchema = z.object({
  id: routeIdentifier,
  preset: z.enum(['thumb', 'card', 'full', 'og']),
})

/**
 * A dedicated sibling of `/api/images/[id]/[preset]` rather than a widened
 * version of it — this project never mixes licensing regimes behind one
 * query (the `antiquity_*`/`sites` table separation applies to routes too),
 * and there is no `status`/moderation gate here to share in the first
 * place: these rows are imported reference material, not reviewed
 * contributions.
 */
defineRouteMeta({
  openAPI: {
    tags: ['column-reliefs'],
    summary: 'Redirect to a signed imgproxy rendition of a mirrored relief plate',
    description:
      'Same signed-redirect shape as /api/images/[id]/[preset] — only a publishably-licensed plate resolves.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'record')
  const { id, preset } = await getValidatedRouterParams(event, paramsSchema.parse)
  const database = useDatabase()

  const [plate] = await database
    .select({ storageKey: columnReliefPlates.storageKey, licence: columnReliefPlates.licence })
    .from(columnReliefPlates)
    .where(eq(columnReliefPlates.id, id))
    .limit(1)

  if (!plate || !isPublishableLicence(plate.licence)) {
    throw createError({ statusCode: 404, message: 'No published plate with that identifier.' })
  }

  const size = IMAGE_PRESETS[preset]

  setResponseHeader(event, 'cache-control', 'public, max-age=86400')

  return sendRedirect(
    event,
    buildImageUrl({
      storageKey: plate.storageKey,
      width: size.width,
      height: size.height,
      fit: size.fit,
    }),
    302,
  )
})
