import { z } from 'zod'
import type { SessionUser } from '#shared/types'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  imageId: z.coerce.number().int().positive(),
})

const bodySchema = z.object({
  caption: z.string().trim().max(500).nullable().optional(),
  attribution: z.string().trim().max(200).nullable().optional(),
  licence: z.string().trim().max(60).optional(),
})

/** Corrects the metadata around a photograph without re-uploading it. */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const user = session.user as SessionUser

  const { id: siteId, imageId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const patch = await readValidatedBody(event, bodySchema.parse)
  const sql = useSql()

  const [image] = await sql<{ created_by: number | null }[]>`
    SELECT created_by FROM site_images WHERE id = ${imageId} AND site_id = ${siteId} LIMIT 1
  `

  if (!image) throw createError({ statusCode: 404, message: 'No such photograph on this site.' })

  if (!canManageImage(user, image.created_by)) {
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

  await sql`
    UPDATE site_images SET
      caption = ${patch.caption === undefined ? sql`caption` : patch.caption},
      attribution = ${patch.attribution === undefined ? sql`attribution` : patch.attribution},
      licence = ${licence ?? sql`licence`}
    WHERE id = ${imageId}
  `

  return { imageId, status: 'updated' }
})
