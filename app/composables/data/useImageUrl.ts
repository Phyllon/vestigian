import { IMAGE_PRESETS } from '#shared/types'
import type { ImagePreset, SiteImage } from '#shared/types'

export type { ImagePreset }

/**
 * Derivatives are produced by imgproxy on request, so only one original per
 * image is ever stored. The client asks for a preset rather than arbitrary
 * dimensions, which keeps the imgproxy cache small and predictable.
 *
 * The URL is same-origin and points at `/api/images/:id/:preset`, which
 * redirects to the real rendition. The image server's address, the bucket and
 * the object key are all things the browser has no business knowing, and the
 * signature that keeps imgproxy from being an open proxy can only be made
 * where the key lives.
 */
/** Whatever carries a licence obligation — a `SiteImage` or a
 *  `ColumnReliefPlateSummary` alike — not just the site-photograph shape. */
export interface CreditedImage {
  attribution: string | null
  licence: string
}

export const useImageUrl = () => {
  const buildUrl = (image: SiteImage, preset: ImagePreset): string =>
    `/api/images/${image.id}/${preset}`

  /** Attribution line rendered under every image, as the licences require. */
  const buildCredit = (image: CreditedImage): string => {
    const parts = [image.attribution, image.licence].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : 'Credit unknown'
  }

  return { buildUrl, buildCredit, presets: IMAGE_PRESETS }
}
