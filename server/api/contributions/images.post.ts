import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
// `Metadata` is imported by name rather than reached for as `sharp.Metadata`:
// 0.35 stopped publishing the types as a namespace alongside the default
// export, so the old form resolves to a value with no type side and fails as
// "Cannot find namespace 'sharp'".
import sharp, { type Metadata } from 'sharp'
import { and, eq } from 'drizzle-orm'
import { siteImages, sites, users } from '~~/server/database/schema'
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
defineRouteMeta({
  openAPI: {
    tags: ['contributions'],
    summary: 'Upload a photograph for a site',
    description:
      'multipart/form-data. The declared content type is a hint only — format is read from magic bytes and every image is re-encoded through sharp, which strips EXIF.',
  },
})

export default defineEventHandler(async (event) => {
  const user = await requireActiveUser(event)
  await enforceRateLimit(event, 'upload')

  /**
   * `nuxt-security`'s `requestSizeLimiter` reads this same header and stops
   * being a limiter at all the moment it is absent: a request sent with
   * `Transfer-Encoding: chunked` and no `Content-Length` sails through that
   * check unbounded, and `readMultipartFormData` below buffers the entire
   * body into memory with nothing left to cap it. A real browser upload
   * always sends `Content-Length` for a `File`/`Blob` body — its size is
   * known before the request is sent — so requiring it here costs no
   * legitimate uploader anything.
   */
  const declaredLength = Number(getRequestHeader(event, 'content-length'))
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
    throw createError({ statusCode: 411, message: 'A Content-Length header is required.' })
  }
  if (declaredLength > MAX_UPLOAD_BYTES + UPLOAD_FORM_FIELD_OVERHEAD_BYTES) {
    throw createError({ statusCode: 413, message: describeRejection('too-large') })
  }

  const form = await readMultipartFormData(event)
  if (!form) throw createError({ statusCode: 400, message: 'Attach an image to upload.' })

  const file = form.find((part) => part.name === 'file' && part.filename)
  const siteIdRaw = form.find((part) => part.name === 'siteId')?.data.toString()
  // Stripped the same way a site or tracing description is (server/utils/sanitize.ts):
  // this is free text a contributor typed, and the only thing standing between
  // markup stored here and a script tag is that nothing today renders it through
  // `v-html`. Stripping on the way in means that stays true even if it stops
  // being true, or the value leaves through a surface that isn't Vue at all.
  const caption = stripHtml(
    form.find((part) => part.name === 'caption')?.data.toString() ?? '',
  ).slice(0, 500)
  const licence = form.find((part) => part.name === 'licence')?.data.toString() ?? ''
  const attribution = stripHtml(
    form.find((part) => part.name === 'attribution')?.data.toString() ?? '',
  ).slice(0, 200)

  const siteId = Number(siteIdRaw)
  if (!file || !Number.isInteger(siteId) || siteId <= 0) {
    throw createError({ statusCode: 400, message: 'Choose a site and an image file.' })
  }

  const normalisedLicence = normaliseLicence(licence)
  if (!isPublishableLicence(normalisedLicence)) {
    uploadEventsTotal().inc({ outcome: 'licence-refused' })
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
    uploadEventsTotal().inc({ outcome: verdict.reason! })
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

  let metadata: Metadata
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
    uploadEventsTotal().inc({ outcome: 'pipeline-failed' })
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
      caption: caption || null,
      licence: normalisedLicence,
      attribution: attribution || null,
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
  uploadEventsTotal().inc({ outcome: status === 'approved' ? 'published' : 'queued' })

  return {
    imageId: image!.id,
    status,
    message:
      status === 'approved'
        ? 'Photograph published.'
        : 'Photograph submitted. A moderator will review it shortly.',
  }
})
