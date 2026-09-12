import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { siteImages } from '~~/server/database/schema'
import { canManageImage } from '#shared/utils/authorization'

export const paramsSchema = z.object({
  id: routeIdentifier,
  imageId: routeIdentifier,
})

/** Stripped the same way the upload path strips them (server/utils/sanitize.ts) — an
 * edit is exactly as much a chance to store markup as the original upload was. */
const optionalStrippedText = (maxLength: number) =>
  z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (typeof value === 'string' ? stripHtml(value) : value))
    .pipe(z.string().max(maxLength).nullable().optional())

export const bodySchema = z.object({
  caption: optionalStrippedText(500),
  attribution: optionalStrippedText(200),
  licence: z.string().trim().max(60).optional(),
})

/** Corrects the metadata around a photograph without re-uploading it. */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: "Correct a photograph's caption, attribution or licence",
  },
})

export default defineEventHandler(async (event) => {
  const user = await requireActiveUser(event)
  await enforceRateLimit(event, 'contribute')

  const { id: siteId, imageId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const patch = await readValidatedBody(event, bodySchema.parse)
  const database = useDatabase()

  const [image] = await database
    .select({ createdBy: siteImages.createdBy })
    .from(siteImages)
    .where(and(eq(siteImages.id, imageId), eq(siteImages.siteId, siteId)))
    .limit(1)

  if (!image) throw createError({ statusCode: 404, message: 'No such photograph on this site.' })

  if (!canManageImage(user, image.createdBy)) {
    throw createError({ statusCode: 403, message: 'That photograph is not yours to edit.' })
  }

  // A licence can be corrected, but never to one that would hide the image —
  // that is what withdrawing it is for.
  const licence = patch.licence ? normaliseLicence(patch.licence) : undefined
  if (licence && !isPublishableLicence(licence)) {
    throw createError({
      statusCode: 400,
      message: 'Choose a licence that permits publication, or withdraw the photograph instead.',
    })
  }

  /**
   * Only the fields that were sent. The raw version had to write
   * `caption = caption` to mean "leave this one alone", which reads as a typo
   * and hid the actual intent; an absent key says it directly. Drizzle refuses
   * an empty `set`, so a request that changes nothing returns without a write
   * rather than issuing `UPDATE ... SET` with no assignments.
   */
  const fields = {
    ...(patch.caption !== undefined && { caption: patch.caption }),
    ...(patch.attribution !== undefined && { attribution: patch.attribution }),
    ...(licence !== undefined && { licence }),
  }

  if (Object.keys(fields).length === 0) return { imageId, status: 'unchanged' }

  await database.update(siteImages).set(fields).where(eq(siteImages.id, imageId))

  return { imageId, status: 'updated' }
})
