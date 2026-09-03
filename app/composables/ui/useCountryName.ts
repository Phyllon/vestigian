/**
 * Resolves an ISO 3166-1 alpha-2 code to a country name in the reader's own
 * interface language, via `Intl.DisplayNames` rather than a translated
 * lookup table — it already ships with the runtime and tracks
 * `useI18n().locale`, so "DE" reads as "Germany" or "Deutschland" with no
 * per-country translation key to add or keep in sync across six locales.
 *
 * `Intl.DisplayNames` throws on a code it does not recognise (not every
 * `sites.country_code`/`cities.country_code` value is guaranteed to be a
 * real ISO region — see the nine sites in CLAUDE.md's backfill notes that
 * resolve to nothing at all), so a caught failure falls back to the bare
 * code rather than surfacing an error for what is, at worst, a slightly
 * less friendly label.
 */
export const useCountryName = () => {
  const { locale } = useI18n()

  const countryName = (countryCode: string | null): string | null => {
    if (!countryCode) return null
    try {
      return (
        new Intl.DisplayNames([locale.value], { type: 'region' }).of(countryCode) ?? countryCode
      )
    } catch {
      return countryCode
    }
  }

  return { countryName }
}
