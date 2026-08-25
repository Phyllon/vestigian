import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { siteImages, users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

let storage: S3Client | undefined

const useStorage = (): S3Client => {
  if (!storage) {
    const config = useRuntimeConfig()
    storage = new S3Client({
      region: 'auto',
      endpoint: config.storage.endpoint,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
      forcePathStyle: true,
    })
  }
  return storage
}

/**
 * Accepts one photograph for a site. Everything the browser claims about the
 * file is treated as a hint: the format is read from the bytes, and the image
 * is fully re-encoded through sharp rather than stored as received. That
 * re-encode is what strips EXIF and guarantees the stored file is a plain
 * image and nothing else.
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const user = session.user as SessionUser
  await enforceRateLimit(event, 'upload')

  const form = await readMultipartFormData(event)
  if (!form) throw createError({ statusCode: 400, message: 'Attach an image to upload.' })

  const file = form.find((part) => part.name === 'file' && part.filename)
  const siteIdRaw = form.find((part) => part.name === 'siteId')?.data.toString()
  const caption = form
    .find((part) => part.name === 'caption')
    ?.data.toString()
    .slice(0, 500)
  const licence = form.find((part) => part.name === 'licence')?.data.toString() ?? ''
  const attribution = form
    .find((part) => part.name === 'attribution')
    ?.data.toString()
    .slice(0, 200)

  const siteId = Number(siteIdRaw)
  if (!file || !Number.isInteger(siteId) || siteId <= 0) {
    throw createError({ statusCode: 400, message: 'Choose a site and an image file.' })
  }

  const normalisedLicence = normaliseLicence(licence)
  if (!isPublishableLicence(normalisedLicence)) {
    throw createError({
      statusCode: 400,
      message: 'Pick a licence that allows the photograph to be shown here.',
    })
  }

  const verdict = inspectUpload({
    bytes: file.data,
    declaredType: file.type,
    filename: file.filename,
  })

  if (!verdict.accepted) {
    throw createError({ statusCode: 400, message: describeRejection(verdict.reason!) })
  }

  const pipeline = sharp(file.data, { failOn: 'error' }).rotate()
  const metadata = await pipeline.metadata()
  const body = await pipeline
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()

  const database = useDatabase()

  // Trust is re-read rather than taken from the session: a moderator may have
  // revoked it since the visitor signed in.
  const [trust] = await database
    .select({
      approvedContributions: users.approvedContributions,
      trustRevoked: users.trustRevoked,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  const status = evaluateTrust({
    approvedContributions: trust?.approvedContributions ?? 0,
    trustRevoked: trust?.trustRevoked ?? true,
    role: trust?.role ?? 'contributor',
  }).autoApprove
    ? 'approved'
    : 'pending'

  // Inserted with an empty key, because the key is derived from the row id the
  // insert is about to hand back.
  const [image] = await database
    .insert(siteImages)
    .values({
      siteId,
      storageKey: '',
      caption: caption ?? null,
      licence: normalisedLicence,
      attribution: attribution ?? null,
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      status,
      createdBy: user.id,
    })
    .returning({ id: siteImages.id })

  const storageKey = buildStorageKey(siteId, image!.id)
  const config = useRuntimeConfig()

  await useStorage().send(
    new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: storageKey,
      Body: body,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  )

  await database.update(siteImages).set({ storageKey }).where(eq(siteImages.id, image!.id))

  return {
    imageId: image!.id,
    status,
    message:
      status === 'approved'
        ? 'Photograph published.'
        : 'Photograph submitted. A moderator will review it shortly.',
  }
})
