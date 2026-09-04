import { createHmac } from 'node:crypto'

/**
 * The vici.org dump carries licence strings written by hand over thirteen
 * years, so the same licence appears in a dozen spellings. Normalising on
 * import is what makes correct attribution renderable in the interface.
 */
const LICENCE_ALIASES: Record<string, string> = {
  'cc by-sa': 'CC-BY-SA-3.0',
  'cc-by-sa': 'CC-BY-SA-3.0',
  'cc by sa 3.0': 'CC-BY-SA-3.0',
  'cc-by-sa-3.0': 'CC-BY-SA-3.0',
  'cc by-sa 4.0': 'CC-BY-SA-4.0',
  'cc-by-sa-4.0': 'CC-BY-SA-4.0',
  'cc by': 'CC-BY-4.0',
  'cc-by': 'CC-BY-4.0',
  'cc by 4.0': 'CC-BY-4.0',
  cc0: 'CC0-1.0',
  'cc-zero': 'CC0-1.0',
  'public domain': 'CC0-1.0',
  pd: 'CC0-1.0',
  gfdl: 'GFDL-1.3',
  'all rights reserved': 'ARR',
  copyright: 'ARR',
}

export const UNKNOWN_LICENCE = 'UNKNOWN'

/**
 * Unrecognised strings become UNKNOWN rather than a guess. An image with an
 * unknown licence is imported but not published, so an ambiguous record can
 * never silently appear on the public map under the wrong terms.
 */
export const normaliseLicence = (raw: string | null | undefined): string => {
  if (!raw) return UNKNOWN_LICENCE
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!key) return UNKNOWN_LICENCE
  return LICENCE_ALIASES[key] ?? UNKNOWN_LICENCE
}

export const isPublishableLicence = (licence: string): boolean =>
  licence !== UNKNOWN_LICENCE && licence !== 'ARR'

export interface ImageRendition {
  bucket: string
  storageKey: string
  width: number
  height: number
  fit: 'cover' | 'contain'
}

/**
 * imgproxy path, unsigned. Split out from the signing step so the path format
 * can be asserted in tests without touching the HMAC secret.
 *
 * What imgproxy encodes is a *source URL*, not an object key. Given the bare
 * key it answers `404 Invalid URL` — a plain-text response with an image
 * content type nowhere in sight, which in a gallery looks like a broken
 * picture rather than a malformed request.
 */
export const buildRenditionPath = (rendition: ImageRendition): string => {
  const source = `s3://${rendition.bucket}/${rendition.storageKey}`
  const encoded = Buffer.from(source)
    .toString('base64url')
    .replace(/={1,2}$/, '')
  const resize = rendition.fit === 'cover' ? 'fill' : 'fit'
  return `/rs:${resize}:${rendition.width}:${rendition.height}/g:sm/q:82/${encoded}.webp`
}

/**
 * Signed URLs mean the image server cannot be used as an open resizing proxy
 * for arbitrary third-party URLs, which is how unsigned deployments turn into
 * someone else's bandwidth bill.
 */
export const signRenditionPath = (path: string, key: string, salt: string): string => {
  const digest = createHmac('sha256', Buffer.from(key, 'hex'))
    .update(Buffer.from(salt, 'hex'))
    .update(path)
    .digest('base64url')
    .replace(/={1,2}$/, '')
  return `/${digest}${path}`
}

export const buildImageUrl = (rendition: Omit<ImageRendition, 'bucket'>): string => {
  const { imgproxy, storage } = useRuntimeConfig()
  const path = buildRenditionPath({ ...rendition, bucket: storage.bucket })
  if (!imgproxy.key || !imgproxy.salt) return `${imgproxy.baseUrl}/insecure${path}`
  return `${imgproxy.baseUrl}${signRenditionPath(path, imgproxy.key, imgproxy.salt)}`
}
