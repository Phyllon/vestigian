/**
 * Numbers for the terrain sections, in the reader's own decimal convention.
 * `formatLength` (useSiteQuery) writes a full stop whatever the language; a
 * German or French reader expects "1,5 km", and a gradient of "0,09 %" is not
 * "0.09%".
 */
export const useTerrainFormat = () => {
  const { locale } = useI18n()

  const number = (value: number, decimals: number): string =>
    new Intl.NumberFormat(locale.value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)

  /** Up to `decimals`, without trailing zeros: "2", "1.5", "0.25". */
  const plain = (value: number, decimals: number): string =>
    new Intl.NumberFormat(locale.value, { maximumFractionDigits: decimals }).format(value)

  /** A share as a whole per cent, in the reader's convention: "9 %", "9 %" (French puts a space before). */
  const percent = (fraction: number): string =>
    new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(
      fraction,
    )

  /** "640 m" below a kilometre, "1.5 km" above; ten kilometres and over drop the decimal. */
  const distance = (metres: number): string => {
    if (metres < 1000) return `${number(Math.round(metres), 0)} m`
    return `${plain(metres / 1000, metres < 10_000 ? 1 : 0)} km`
  }

  const metres = (value: number, decimals = 0): string => `${number(value, decimals)} m`

  /** One decimal for a small area, whole kilometres once it is hundreds: "1,202 km²", not "1,202.0". */
  const squareKilometres = (value: number): string => `${plain(value, value < 100 ? 1 : 0)} km²`

  /** A signed slope, "+2.4 %" or "−0.1 %" (a true minus, not a hyphen). */
  const gradient = (percent: number): string => {
    const decimals = Math.abs(percent) < 1 ? 2 : 1
    let sign = ''
    if (percent > 0) sign = '+'
    if (percent < 0) sign = '−'
    return `${sign}${number(Math.abs(percent), decimals)} %`
  }

  return { number, plain, percent, distance, metres, squareKilometres, gradient }
}
