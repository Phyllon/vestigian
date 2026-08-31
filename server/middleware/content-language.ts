import { ENRICHMENT_LANGUAGES } from '#shared/types'

/**
 * With i18n's `no_prefix` strategy there is one URL per page regardless of
 * locale, so `hreflang` alternates (which require distinct URLs per language
 * variant) don't apply here — see the comment on the `i18n` block in
 * `nuxt.config.ts`. This header is the honest substitute: it tells a crawler
 * explicitly which language the one indexable variant is in, read from the
 * same `vestigia-locale` cookie `@nuxtjs/i18n` itself reads.
 */
export default defineEventHandler((event) => {
  const cookieLocale = getCookie(event, 'vestigia-locale')
  const locale = ENRICHMENT_LANGUAGES.includes(
    cookieLocale as (typeof ENRICHMENT_LANGUAGES)[number],
  )
    ? cookieLocale!
    : 'en'

  setResponseHeader(event, 'content-language', locale)
})
