/**
 * What may follow `/iiif/2/` in a request proxied to Heidelberg University
 * Library (`server/api/columns/marcus-aurelius/tile/[...path].get.ts`).
 *
 * The prefix pins the host, so this was never a way to reach another server —
 * but the path was appended as received, and `fetch` resolves `..` segments, so
 * `../../anything` read any URL on that one host through our origin, on our
 * bandwidth. An image-service request is an identifier (`petersen1896tafeln1:0013`,
 * possibly percent-encoded) followed by `info.json` or region/size/rotation/
 * quality.format; nothing in it needs a dot-segment, a backslash, a query or an
 * `@`. Anything outside that alphabet is refused rather than cleaned.
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9._~%:,!*-]+$/
const MAX_SEGMENTS = 8
const MAX_LENGTH = 300

const isDotSegment = (segment: string): boolean => {
  try {
    // Twice: `%252e%252e` is a dot-segment to a server that decodes once more.
    const decoded = decodeURIComponent(decodeURIComponent(segment))
    return decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')
  } catch {
    // An escape that does not decode is not one we can vouch for.
    return true
  }
}

export const isSafeIiifPath = (path: string): boolean => {
  if (path.length === 0 || path.length > MAX_LENGTH) return false
  const segments = path.split('/')
  if (segments.length > MAX_SEGMENTS) return false
  return segments.every(
    (segment) => segment.length > 0 && SEGMENT_PATTERN.test(segment) && !isDotSegment(segment),
  )
}
