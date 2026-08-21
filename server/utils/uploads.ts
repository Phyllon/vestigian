export type AcceptedImageFormat = 'jpeg' | 'png' | 'webp'

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const MIN_UPLOAD_BYTES = 1024

/**
 * The declared content type is client-supplied and worthless as a check, so the
 * format is read from the file's own leading bytes. A .jpg that is actually an
 * SVG is the classic way to smuggle script into an image pipeline.
 */
export const detectImageFormat = (bytes: Buffer): AcceptedImageFormat | null => {
  if (bytes.length < 12) return null

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (pngSignature.every((byte, index) => bytes[index] === byte)) return 'png'

  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }

  return null
}

export interface UploadCandidate {
  bytes: Buffer
  declaredType: string | undefined
  filename: string | undefined
}

export type UploadRejection = 'too-small' | 'too-large' | 'unsupported-format' | 'type-mismatch'

export interface UploadVerdict {
  accepted: boolean
  format: AcceptedImageFormat | null
  reason: UploadRejection | null
}

const DECLARED_TYPE_MAP: Record<string, AcceptedImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const inspectUpload = (candidate: UploadCandidate): UploadVerdict => {
  const size = candidate.bytes.length

  if (size < MIN_UPLOAD_BYTES) return { accepted: false, format: null, reason: 'too-small' }
  if (size > MAX_UPLOAD_BYTES) return { accepted: false, format: null, reason: 'too-large' }

  const format = detectImageFormat(candidate.bytes)
  if (!format) return { accepted: false, format: null, reason: 'unsupported-format' }

  // A mismatch between the declared type and the real one is not necessarily an
  // attack, but it is never something to accept silently.
  const declared = candidate.declaredType
    ? DECLARED_TYPE_MAP[candidate.declaredType.toLowerCase()]
    : undefined

  if (declared && declared !== format) {
    return { accepted: false, format, reason: 'type-mismatch' }
  }

  return { accepted: true, format, reason: null }
}

export const describeRejection = (reason: UploadRejection): string => {
  const messages: Record<UploadRejection, string> = {
    'too-small': 'That file is too small to be a photograph.',
    'too-large': 'Images must be under 15 MB. Resize it and try again.',
    'unsupported-format': 'Upload a JPEG, PNG or WebP.',
    'type-mismatch': 'That file is not the format its name claims. Re-export it and try again.',
  }
  return messages[reason]
}

/** Object key for a stored original. Never derived from the uploaded filename. */
export const buildStorageKey = (siteId: number, imageId: number): string =>
  `sites/${siteId}/${imageId}.jpg`
