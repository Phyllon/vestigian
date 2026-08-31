export interface CanonicalUrlOptions {
  path?: string
}

/**
 * Always the bare path, never `route.fullPath` — this app has no filtered or
 * paginated content views today, so a query string reaching here would only
 * ever be tracking noise or map state, and canonicalising it away is safer
 * than inventing a rule for a case that doesn't exist yet.
 */
export const useCanonicalUrl = (options: CanonicalUrlOptions = {}): void => {
  const config = useRuntimeConfig()
  const route = useRoute()
  const base = config.public.siteUrl.replace(/\/$/, '')
  const path = options.path ?? route.path

  useHead({ link: [{ rel: 'canonical', href: `${base}${path}` }] })
}
