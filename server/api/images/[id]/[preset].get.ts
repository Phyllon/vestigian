import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { siteImages } from '~~/server/database/schema'
import { IMAGE_PRESETS } from '#shared/types'

export const paramsSchema = z.object({
  id: routeIdentifier,
  preset: z.enum(['thumb', 'card', 'full', 'og']),
})

/**
 * Redirects to an imgproxy rendition rather than letting the browser assemble
 * the URL itself. Two structural reasons, not conveniences:
 *
 * The signing key is a server secret. A URL built in the client can only ever
 * be an unsigned one, which means production would have to run imgproxy
 * unsigned — an open resizing proxy pointed at someone else's bandwidth.
 *
 * And the bucket name and object key never reach the wire, so the set of
 * images that can be asked for is exactly the set this route agrees to serve:
 * approved, with a licence that permits publication.
 */
defineRouteMeta({
  openAPI: {
    tags: ['images'],
    summary: 'Redirect to a signed imgproxy rendition of a photograph',
    description:
      'The signing key never reaches the client and the bucket/object key never reaches the wire — only an approved, publishably-licensed image resolves.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'record')
  const { id, preset } = await getValidatedRouterParams(event, paramsSchema.parse)
  const database = useDatabase()

  const [image] = await database
    .select({ storageKey: siteImages.storageKey, licence: siteImages.licence })
    .from(siteImages)
    .where(and(eq(siteImages.id, id), eq(siteImages.status, 'approved')))
    .limit(1)

  if (!image || !isPublishableLicence(image.licence)) {
    throw createError({ statusCode: 404, message: 'No published image with that identifier.' })
  }

  const size = IMAGE_PRESETS[preset]

  /**
   * A day, not a year. The redirect target is stable, but withdrawal has to be
   * able to take effect — an image returned to `pending` should stop resolving
   * without waiting out a cache that nothing in this project can purge.
   */
  setResponseHeader(event, 'cache-control', 'public, max-age=86400')

  return sendRedirect(
    event,
    buildImageUrl({
      storageKey: image.storageKey,
      width: size.width,
      height: size.height,
      fit: size.fit,
    }),
    302,
  )
})
