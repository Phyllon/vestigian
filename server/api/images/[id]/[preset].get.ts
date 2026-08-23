import { z } from 'zod'
import { IMAGE_PRESETS } from '#shared/types'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  preset: z.enum(['thumb', 'card', 'full']),
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
export default defineEventHandler(async (event) => {
  const { id, preset } = await getValidatedRouterParams(event, paramsSchema.parse)
  const sql = useSql()

  const [image] = await sql<{ storage_key: string; licence: string }[]>`
    SELECT storage_key, licence
    FROM site_images
    WHERE id = ${id} AND status = 'approved'
    LIMIT 1
  `

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
      storageKey: image.storage_key,
      width: size.width,
      height: size.height,
      fit: size.fit,
    }),
    302,
  )
})
