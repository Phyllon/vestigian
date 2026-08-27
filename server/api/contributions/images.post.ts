import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { and, eq } from 'drizzle-orm'
import { siteImages, sites, users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'
import { evaluateTrust } from '#shared/utils/authorization'

/**
 * The ceiling on decoded pixels, well above what a 2400px output needs and well
 * below what the machine can be hurt by. sharp's own default is ~268 MP, which
 * a compressible PNG under the 8 MB body limit can reach — roughly a gigabyte
 * of resident memory per request.
 */
const MAX_DECODED_PIXELS = 50 * 1_000_000

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

  /**
   * `limitInputPixels` is set rather than left at sharp's ~268 megapixel
   * default, which is the difference between rejecting a decompression bomb and
   * decoding one. A well-formed PNG comfortably under the 8 MB body limit can
   * expand to roughly a gigabyte of resident memory, and `.rotate()` forces the
   * full-resolution decode before `.resize()` ever runs. 50 MP is far more than
   * a 2400px output needs and far less than the machine can be hurt by.
   */
  const database = useDatabase()

  // Checked before the re-encode, not after. Without this a bad id still paid
  // for the full decode and then surfaced as an unhandled foreign-key violation
  // — a 500 for what is plainly a bad request. A pending or rejected site is
  // refused too: an unpublished record is not somewhere to attach photographs.
  const [site] = await database
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.status, 'approved')))
    .limit(1)

  if (!site) {
    throw createError({ statusCode: 404, message: 'No approved site with that identifier.' })
  }

  let metadata: sharp.Metadata
  let body: Buffer

  try {
    const pipeline = sharp(file.data, {
      failOn: 'error',
      limitInputPixels: MAX_DECODED_PIXELS,
    }).rotate()

    metadata = await pipeline.metadata()
    body = await pipeline
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer()
  } catch (error) {
    // Exceeding `limitInputPixels` throws, and so does a file that passed the
    // magic-byte check but is malformed further in. Both are the uploader's
    // problem, not the server's, so neither should read as a 500.
    event.context.log.warn(
      { siteId, bytes: file.data.length, err: { message: (error as Error).message } },
      'upload rejected by the image pipeline',
    )
    throw createError({
      statusCode: 400,
      message: 'That image could not be processed. It may be corrupt or far too large.',
    })
  }

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
