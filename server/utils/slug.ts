/**
 * Slugs are generated from titles that are frequently Latin, German, Croatian
 * or Turkish, so the transliteration has to survive diacritics rather than
 * strip the characters and leave gaps.
 */
export const slugify = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[đĐ]/g, 'd')
    .replace(/[øØ]/g, 'o')
    .replace(/[ßẞ]/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)

/** Appends a discriminator when a slug is already taken. */
export const disambiguateSlug = (slug: string, attempt: number): string =>
  attempt === 0 ? slug : `${slug}-${attempt + 1}`
