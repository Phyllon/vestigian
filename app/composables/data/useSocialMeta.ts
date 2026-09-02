export interface SocialMetaOptions {
  title: string
  description: string
  imageUrl: string
  type?: 'website' | 'article'
}

export const useSocialMeta = (options: SocialMetaOptions): void => {
  const config = useRuntimeConfig()
  const route = useRoute()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useSeoMeta({
    ogTitle: options.title,
    ogDescription: options.description,
    ogType: options.type ?? 'website',
    ogUrl: `${base}${route.path}`,
    ogImage: options.imageUrl,
    ogSiteName: 'Vestigian',
    twitterCard: 'summary_large_image',
    twitterTitle: options.title,
    twitterDescription: options.description,
    twitterImage: options.imageUrl,
  })
}
