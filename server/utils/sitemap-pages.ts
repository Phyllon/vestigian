/**
 * Which pages the sitemap carries, and which it leaves out and why.
 *
 * Kept as data so `sitemap-pages.test.ts` can compare it with `app/pages/`: a page
 * added without a decision here fails the build, which is how "the sitemap forgot
 * the new page" stops being something a person has to notice.
 */

/** The hand-written pages, listed in `sitemap-static.xml`. */
export const SITEMAP_STATIC_PATHS = [
  '/',
  '/about',
  '/partners',
  '/licence',
  '/privacy',
  '/impressum',
  '/columns',
  '/tabula-peutingeriana',
  '/limes',
  '/inscriptions',
  '/inscriptions/attic',
] as const

/**
 * A page that has one URL per record, and the sitemap that lists them. `static`
 * means they ride `sitemap-static.xml` because there are only a handful (the
 * limes sectors).
 */
export const SITEMAP_DYNAMIC_ROUTES: Record<string, string> = {
  '/site/[slug]': 'sites',
  '/tracing/[id]': 'tracings',
  '/inscriptions/[edhId]': 'inscriptions',
  '/inscriptions/attic/[aioKey]': 'attic-inscriptions',
  '/inscriptions/sicily/[isicilyId]': 'isicily-inscriptions',
  '/limes/[slug]': 'static',
}

/**
 * Pages that are public and not `noindex`, left out on purpose. A page that
 * carries `useNoIndex()` needs no entry: the page says so itself, and the test
 * insists it is *not* listed.
 */
export const SITEMAP_LEFT_OUT: Record<string, string> = {
  '/contributor/[name]':
    "A person's profile. Reached from the record they contributed to, not enumerated for a crawler; whether people should be indexed at all is a privacy decision, not a default.",
}
