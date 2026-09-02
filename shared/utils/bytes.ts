/**
 * A byte count as MB or GB, using `Intl.NumberFormat`'s unit style rather than
 * a hand-rolled `toFixed` — the six languages this app ships get a correctly
 * localised unit and decimal separator for free, the way `formatDate` already
 * leans on `toLocaleDateString` instead of assembling a string itself.
 */
export const formatBytes = (bytes: number, locale: string): string => {
  const megabytes = bytes / 1_000_000
  const unit = megabytes >= 1000 ? 'gigabyte' : 'megabyte'
  const value = unit === 'gigabyte' ? megabytes / 1000 : megabytes

  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value)
}
