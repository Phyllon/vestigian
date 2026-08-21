import type { SiteImage } from '#shared/types'

export type ImagePreset = 'thumb' | 'card' | 'full'

const PRESET_SIZES: Record<
  ImagePreset,
  { width: number; height: number; fit: 'cover' | 'contain' }
> = {
  thumb: { width: 160, height: 160, fit: 'cover' },
  card: { width: 720, height: 480, fit: 'cover' },
  full: { width: 1600, height: 1600, fit: 'contain' },
}

/**
 * Derivatives are produced by imgproxy on request, so only one original per
 * image is ever stored. The client asks for a preset rather than arbitrary
 * dimensions, which keeps the imgproxy cache small and predictable.
 */
export const useImageUrl = () => {
  const config = useRuntimeConfig()

  const buildUrl = (image: SiteImage, preset: ImagePreset): string => {
    const size = PRESET_SIZES[preset]
    const key = encodeURIComponent(image.storageKey)
    return `${config.public.imageBaseUrl}/r/${preset}/${size.width}x${size.height}/${key}`
  }

  /** Attribution line rendered under every image, as the licences require. */
  const buildCredit = (image: SiteImage): string => {
    const parts = [image.attribution, image.licence].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : 'Credit unknown'
  }

  return { buildUrl, buildCredit, presets: PRESET_SIZES }
}
